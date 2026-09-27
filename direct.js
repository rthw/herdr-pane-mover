#!/usr/bin/env node
// Direct, no-overlay actions for Pane Mover.
// Invoked by Herdr plugin actions with the focused pane in plugin context.
"use strict";

const { spawnSync } = require("node:child_process");

const herdr = process.env.HERDR_BIN_PATH ?? "herdr";
const operation = process.argv[2];

function cli(args) {
  const res = spawnSync(herdr, args, { encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error((res.stderr || res.stdout || `herdr ${args.join(" ")} failed`).trim());
  }
  return res.stdout;
}

function cliJson(args) {
  return JSON.parse(cli(args)).result;
}

function targetPaneId() {
  try {
    const ctx = JSON.parse(process.env.HERDR_PLUGIN_CONTEXT_JSON ?? "{}");
    const target =
      ctx.pane_id ??
      ctx.focused_pane_id ??
      ctx.pane?.pane_id ??
      ctx.focused_pane?.pane_id;
    if (target) return target;
  } catch {
    // Fall through to the pane injected for the action process.
  }
  return process.env.HERDR_PANE_ID ?? null;
}

function adjacent(items, currentId, idKey, direction) {
  const index = items.findIndex((item) => item[idKey] === currentId);
  if (index < 0) throw new Error(`current ${idKey} is not in the live session`);
  const result = items[index + direction];
  if (!result) throw new Error(direction < 0 ? "there is no previous destination" : "there is no next destination");
  return result;
}

function main() {
  const paneId = targetPaneId();
  if (!paneId) throw new Error("could not resolve the pane to move");

  const panes = cliJson(["pane", "list"]).panes;
  const pane = panes.find((item) => item.pane_id === paneId);
  if (!pane) throw new Error("the target pane no longer exists");

  switch (operation) {
    case "swap-previous":
    case "swap-next": {
      const peers = panes.filter((item) => item.tab_id === pane.tab_id);
      const target = adjacent(peers, paneId, "pane_id", operation.endsWith("previous") ? -1 : 1);
      cli(["pane", "swap", "--source-pane", paneId, "--target-pane", target.pane_id]);
      return;
    }
    case "move-tab-previous":
    case "move-tab-next": {
      const tabs = cliJson(["tab", "list", "--workspace", pane.workspace_id]).tabs;
      const target = adjacent(tabs, pane.tab_id, "tab_id", operation.endsWith("previous") ? -1 : 1);
      // Without --target-pane Herdr chooses the target tab's existing pane.
      cli(["pane", "move", paneId, "--tab", target.tab_id, "--split", "right", "--focus"]);
      return;
    }
    case "move-workspace-previous":
    case "move-workspace-next": {
      const workspaces = cliJson(["workspace", "list"]).workspaces;
      const target = adjacent(workspaces, pane.workspace_id, "workspace_id", operation.endsWith("previous") ? -1 : 1);
      // A pane must belong to a tab: create one in the adjacent workspace.
      cli(["pane", "move", paneId, "--new-tab", "--workspace", target.workspace_id, "--focus"]);
      return;
    }
    default:
      throw new Error(`unknown operation: ${operation ?? "(none)"}`);
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`pane-mover: ${error.message}\n`);
  process.exitCode = 1;
}
