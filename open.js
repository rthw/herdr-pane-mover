#!/usr/bin/env node
// Action entrypoint. Captures which pane should be moved (the pane focused at
// invocation time), stashes it for the overlay UI, then opens the overlay.
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const herdr = process.env.HERDR_BIN_PATH ?? "herdr";
const stateDir = process.env.HERDR_PLUGIN_STATE_DIR ?? "/tmp/herdr-pane-mover";
const pluginId = process.env.HERDR_PLUGIN_ID ?? "osamahbeig.pane-mover";

let target = null;
try {
  const ctx = JSON.parse(process.env.HERDR_PLUGIN_CONTEXT_JSON ?? "{}");
  // Context JSON shape varies by invocation source; try the plausible spots.
  target =
    ctx.pane_id ??
    ctx.focused_pane_id ??
    (ctx.pane && ctx.pane.pane_id) ??
    (ctx.focused_pane && ctx.focused_pane.pane_id) ??
    null;
} catch {
  /* fall through */
}
if (!target) target = process.env.HERDR_PANE_ID || null;

fs.mkdirSync(stateDir, { recursive: true });
fs.writeFileSync(
  path.join(stateDir, "target.json"),
  JSON.stringify({ target, at: Date.now() })
);

const res = spawnSync(
  herdr,
  ["plugin", "pane", "open", "--plugin", pluginId, "--entrypoint", "mover"],
  { encoding: "utf8" }
);
if (res.stderr) process.stderr.write(res.stderr);
process.exit(res.status ?? 0);
