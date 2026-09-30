#!/usr/bin/env node
// Pane Mover overlay UI. Mouse-clickable and keyboard-driven, zero deps.
// Runs inside a herdr plugin pane (placement: overlay). Moves the pane that
// was focused when the action fired: re-split within its tab, swap with a
// neighbor, or move it to another tab / workspace.
"use strict";

const { spawnSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

// --exec mode: run scheduled herdr commands after the overlay has closed.
// The overlay restores the pre-overlay layout when it closes, which would
// revert any move made while it was open — so moves run here, detached.
if (process.argv[2] === "--exec") {
  const cmds = JSON.parse(process.argv[3]);
  const bin = process.env.HERDR_BIN_PATH ?? "herdr";
  setTimeout(() => {
    for (const args of cmds) spawnSync(bin, args, { encoding: "utf8" });
    process.exit(0);
  }, 400);
  return;
}

const herdr = process.env.HERDR_BIN_PATH ?? "herdr";
const stateDir = process.env.HERDR_PLUGIN_STATE_DIR ?? "/tmp/herdr-pane-mover";
const pluginId = process.env.HERDR_PLUGIN_ID ?? "osamahbeig.pane-mover";
const selfPane = process.env.HERDR_PANE_ID ?? null; // the overlay's own pane

// ---------- herdr CLI helpers ----------

// ЙЦУКЕН -> QWERTY по физической клавише, чтобы меню работало в русской раскладке
const RU_KEYS = {"й": "q", "Й": "Q", "ц": "w", "Ц": "W", "у": "e", "У": "E", "к": "r", "К": "R", "е": "t", "Е": "T", "н": "y", "Н": "Y", "г": "u", "Г": "U", "ш": "i", "Ш": "I", "щ": "o", "Щ": "O", "з": "p", "З": "P", "ф": "a", "Ф": "A", "ы": "s", "Ы": "S", "в": "d", "В": "D", "а": "f", "А": "F", "п": "g", "П": "G", "р": "h", "Р": "H", "о": "j", "О": "J", "л": "k", "Л": "K", "д": "l", "Д": "L", "я": "z", "Я": "Z", "ч": "x", "Ч": "X", "с": "c", "С": "C", "м": "v", "М": "V", "и": "b", "И": "B", "т": "n", "Т": "N", "ь": "m", "Ь": "M"};

function cli(args) {
  const res = spawnSync(herdr, args, { encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error(
      `herdr ${args.join(" ")} failed: ${(res.stderr || res.stdout || "").trim()}`
    );
  }
  return res.stdout;
}

function cliJson(args) {
  return JSON.parse(cli(args)).result;
}

// ---------- resolve the pane to move ----------

function resolveTarget(panes) {
  try {
    const state = JSON.parse(
      fs.readFileSync(path.join(stateDir, "target.json"), "utf8")
    );
    // Only trust a fresh stash (written by open.js just before the overlay).
    if (state.target && Date.now() - state.at < 15000) return state.target;
  } catch {
    /* fall through */
  }
  try {
    const ctx = JSON.parse(process.env.HERDR_PLUGIN_CONTEXT_JSON ?? "{}");
    const fromCtx =
      ctx.pane_id ??
      ctx.focused_pane_id ??
      (ctx.pane && ctx.pane.pane_id) ??
      (ctx.focused_pane && ctx.focused_pane.pane_id) ??
      null;
    if (fromCtx && fromCtx !== selfPane) return fromCtx;
  } catch {
    /* fall through */
  }
  // Last resort: the focused pane that isn't this overlay.
  const focused = panes.find((p) => p.focused && p.pane_id !== selfPane);
  return focused ? focused.pane_id : null;
}

// ---------- gather topology ----------

function gather() {
  const panes = cliJson(["pane", "list"]).panes;
  const workspaces = cliJson(["workspace", "list"]).workspaces;
  const target = resolveTarget(panes);
  const targetPane = panes.find((p) => p.pane_id === target) || null;
  const tabs = [];
  for (const ws of workspaces) {
    try {
      for (const t of cliJson(["tab", "list", "--workspace", ws.workspace_id])
        .tabs) {
        tabs.push({ ...t, workspace_label: ws.label ?? ws.workspace_id });
      }
    } catch {
      /* workspace may have vanished mid-read */
    }
  }
  return { panes, workspaces, tabs, target, targetPane };
}

// ---------- move operations ----------

function paneLabel(p) {
  return p.label || p.agent || path.basename(p.cwd || "") || p.pane_id;
}

function siblingIn(tabId, panes, target) {
  return panes.find(
    (p) => p.tab_id === tabId && p.pane_id !== target && p.pane_id !== selfPane
  );
}

// Each operation returns the list of herdr CLI commands to run. They are NOT
// executed here: the overlay restores the pre-overlay layout when it closes,
// which would revert any move made while it is open. Selections are handed to
// a detached --exec child that fires after the overlay has closed.

// Re-split within the same tab: herdr has no in-place re-split, so bounce the
// pane out to a temp tab and bring it back with the new direction.
// herdr's --split only knows right|down; left|up are done as split + swap.
function baseDir(dir) {
  return dir === "left" ? "right" : dir === "up" ? "down" : dir;
}

function resplit(state, dir) {
  const { target, targetPane, panes } = state;
  const sib = siblingIn(targetPane.tab_id, panes, target);
  if (!sib) throw new Error("no sibling pane to split against");
  const cmds = [
    ["pane", "move", target, "--new-tab", "--workspace", targetPane.workspace_id, "--no-focus"],
    ["pane", "move", target, "--tab", targetPane.tab_id, "--split", baseDir(dir), "--target-pane", sib.pane_id, "--focus"],
  ];
  if (dir === "left" || dir === "up")
    cmds.push(["pane", "swap", "--direction", dir, "--pane", target]);
  return cmds;
}

function swap(state, dir) {
  return [["pane", "swap", "--direction", dir, "--pane", state.target]];
}

function moveToTab(state, tabId, dir) {
  const cmds = [
    ["pane", "move", state.target, "--tab", tabId, "--split", baseDir(dir), "--focus"],
  ];
  if (dir === "left" || dir === "up")
    cmds.push(["pane", "swap", "--direction", dir, "--pane", state.target]);
  return cmds;
}

function moveToWorkspace(state, wsId) {
  return [["pane", "move", state.target, "--new-tab", "--workspace", wsId, "--focus"]];
}

function moveToNewTab(state) {
  return moveToWorkspace(state, state.targetPane.workspace_id);
}

function moveToNewWorkspace(state) {
  return [["pane", "move", state.target, "--new-workspace", "--focus"]];
}

function scheduleAfterClose(cmds) {
  spawn(process.execPath, [__filename, "--exec", JSON.stringify(cmds)], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  }).unref();
}

// ---------- terminal UI ----------

const out = process.stdout;
let rows = [];
let cursor = 0;
let status = "";

function enterUi() {
  out.write("\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1006h");
  process.stdin.setRawMode(true);
  process.stdin.resume();
}

function leaveUi() {
  out.write("\x1b[?1006l\x1b[?1000l\x1b[?25h\x1b[?1049l");
  try {
    process.stdin.setRawMode(false);
  } catch {
    /* stdin may already be gone */
  }
}

function closeOverlay() {
  // Ask herdr to close the plugin pane; if unsupported, process exit suffices.
  spawnSync(herdr, [
    "plugin",
    "pane",
    "close",
    "--plugin",
    pluginId,
    "--entrypoint",
    "mover",
  ]);
}

function quit(code) {
  leaveUi();
  closeOverlay();
  process.exit(code);
}

const B = "\x1b[1m";
const D = "\x1b[2m";
const I = "\x1b[7m";
const R = "\x1b[0m";

function render(title) {
  out.write("\x1b[2J\x1b[H");
  out.write(`${B}${title}${R}\r\n`);
  out.write(`${D}click or ↑↓ + Enter · q/Esc cancels${R}\r\n\r\n`);
  // Menu items start at terminal row 4 (1-based).
  rows.forEach((item, i) => {
    if (item.header) {
      out.write(`${D}── ${item.header} ──${R}\r\n`);
    } else {
      const line = ` ${item.label} `;
      out.write((i === cursor ? `${I}${line}${R}` : line) + "\r\n");
    }
  });
  if (status) out.write(`\r\n${D}${status}${R}\r\n`);
}

function firstSelectable(from, step) {
  let i = from;
  while (i >= 0 && i < rows.length && rows[i].header) i += step;
  return Math.max(0, Math.min(rows.length - 1, i));
}

function runMenu(title, items) {
  return new Promise((resolve) => {
    rows = items;
    cursor = firstSelectable(0, 1);
    render(title);
    const onData = (buf) => {
      const raw = buf.toString("utf8");
      const s = RU_KEYS[raw] ?? raw; // хоткеи в русской раскладке
      // SGR mouse press: ESC [ < b ; x ; y M
      const m = s.match(/\x1b\[<(\d+);(\d+);(\d+)M/);
      if (m && (Number(m[1]) & 3) !== 3) {
        const y = Number(m[3]);
        const idx = y - 4; // menu items start at row 4
        if (idx >= 0 && idx < rows.length && !rows[idx].header) {
          cursor = idx;
          render(title);
          cleanup();
          return resolve(rows[idx]);
        }
        return;
      }
      if (s === "q" || s === "\x1b" || s === "\x03") {
        cleanup();
        return resolve(null);
      }
      if (s === "\x1b[A" || s === "k") {
        cursor = firstSelectable(Math.max(0, cursor - 1), -1);
        return render(title);
      }
      if (s === "\x1b[B" || s === "j") {
        cursor = firstSelectable(Math.min(rows.length - 1, cursor + 1), 1);
        return render(title);
      }
      if (s === "\r" || s === "\n") {
        if (!rows[cursor].header) {
          cleanup();
          return resolve(rows[cursor]);
        }
      }
      if (/^[0-9a-zA-Z]$/.test(s)) {
        const hit = rows.find((r) => r.key === s);
        if (hit) {
          cleanup();
          return resolve(hit);
        }
      }
    };
    const cleanup = () => process.stdin.off("data", onData);
    process.stdin.on("data", onData);
  });
}

// ---------- menu construction ----------

function mainMenu(state) {
  const { targetPane, panes, tabs } = state;
  const items = [];
  const sib = siblingIn(targetPane.tab_id, panes, state.target);
  if (sib) {
    items.push({ header: "This tab" });
    items.push({ key: "1", label: `[1] Re-split ← left of ${paneLabel(sib)}`, act: () => resplit(state, "left") });
    items.push({ key: "2", label: `[2] Re-split → right of ${paneLabel(sib)}`, act: () => resplit(state, "right") });
    items.push({ key: "3", label: `[3] Re-split ↑ above ${paneLabel(sib)}`, act: () => resplit(state, "up") });
    items.push({ key: "4", label: `[4] Re-split ↓ below ${paneLabel(sib)}`, act: () => resplit(state, "down") });
    items.push({ key: "5", label: "[5] Swap ← left", act: () => swap(state, "left") });
    items.push({ key: "6", label: "[6] Swap → right", act: () => swap(state, "right") });
    items.push({ key: "7", label: "[7] Swap ↑ up", act: () => swap(state, "up") });
    items.push({ key: "8", label: "[8] Swap ↓ down", act: () => swap(state, "down") });
  }
  items.push({ header: "Elsewhere" });
  if (tabs.length > 1)
    items.push({ key: "t", label: "[t] Move to another tab…", submenu: "tab" });
  items.push({ key: "w", label: "[w] Move to another workspace…", submenu: "workspace" });
  items.push({ key: "n", label: "[n] Move to a new tab (this workspace)", act: () => moveToNewTab(state) });
  items.push({ key: "N", label: "[N] Move to a new workspace", act: () => moveToNewWorkspace(state) });
  return items;
}

function tabMenu(state) {
  return state.tabs
    .filter((t) => t.tab_id !== state.targetPane.tab_id)
    .map((t) => ({
      label: ` ${t.workspace_label} / ${t.label ?? "tab " + (t.number ?? t.tab_id)}`,
      tabId: t.tab_id,
    }));
}

function workspaceMenu(state) {
  return state.workspaces.map((w) => ({
    label: ` ${w.label ?? w.workspace_id}${w.workspace_id === state.targetPane.workspace_id ? " (current)" : ""}`,
    wsId: w.workspace_id,
  }));
}

// ---------- main ----------

(async function main() {
  let state;
  try {
    state = gather();
  } catch (e) {
    process.stderr.write(`pane-mover: ${e.message}\n`);
    return quit(1);
  }
  if (!state.targetPane) {
    process.stderr.write("pane-mover: could not resolve which pane to move\n");
    return quit(1);
  }

  enterUi();
  try {
    const title = `Move pane: ${paneLabel(state.targetPane)} (${state.target})`;
    let choice = await runMenu(title, mainMenu(state));
    if (choice && choice.submenu === "tab") {
      const t = await runMenu("Move to which tab?", tabMenu(state));
      if (t) {
        const d = await runMenu("Where in that tab?", [
          { key: "1", label: "[1] ← left (side by side)", dir: "left" },
          { key: "2", label: "[2] → right (side by side)", dir: "right" },
          { key: "3", label: "[3] ↑ top (stacked)", dir: "up" },
          { key: "4", label: "[4] ↓ bottom (stacked)", dir: "down" },
        ]);
        if (d) choice = { act: () => moveToTab(state, t.tabId, d.dir) };
        else choice = null;
      } else choice = null;
    } else if (choice && choice.submenu === "workspace") {
      const w = await runMenu("Move to which workspace?", workspaceMenu(state));
      choice = w ? { act: () => moveToWorkspace(state, w.wsId) } : null;
    }
    if (choice && choice.act) scheduleAfterClose(choice.act());
    quit(0);
  } catch (e) {
    status = `error: ${e.message}`;
    render("Pane Mover — error (any key to close)");
    process.stdin.once("data", () => quit(1));
  }
})();
