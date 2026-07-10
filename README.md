# herdr-pane-mover

A clickable overlay menu for [herdr](https://herdr.dev) that moves the current
pane — re-split it side-by-side or stacked, swap it with a neighbor, or send it
to another tab, another workspace, a new tab, or a new workspace. Mouse and
keyboard both work.

Herdr plugin v1 has no native context-menu extension point, so this ships as an
overlay pane bound to a key: press the binding, the menu pops over the active
pane, click (or arrow + Enter) what you want, done.

## Why

Herdr has no in-place re-split: turning a stacked layout into a side-by-side
one requires bouncing the pane out to a temporary tab and moving it back with
the other split direction. This plugin hides that dance behind one click.

## Install

```bash
herdr plugin install osamahbeig/herdr-pane-mover
```

Or link a local checkout while developing:

```bash
herdr plugin link /path/to/herdr-pane-mover
```

Requires Node (any recent version; the plugin is dependency-free).

## Bind a key

```toml
[[keys.command]]
key = "prefix+m"
type = "plugin_action"
command = "osamahbeig.pane-mover.open"
description = "move this pane"
```

## Use

- Press the binding in the pane you want to move.
- Click an entry, or navigate with `↑`/`↓`/`j`/`k` + `Enter`, or press the
  number shown.
- `q` / `Esc` cancels.

Menu:

```
This tab
 [1] Re-split → side by side
 [2] Re-split → stacked
 [3-6] Swap ← → ↑ ↓
Elsewhere
 [7] Move to another tab…
 [8] Move to another workspace…
 [9] Move to a new tab (this workspace)
 [0] Move to a new workspace
```

## How it works

The action entrypoint (`open.js`) records the pane that was focused when the
key fired, then opens the overlay pane (`mover.js`), which reads the live
topology over the herdr CLI (`pane list`, `workspace list`, `tab list`) and
executes moves with `pane move` / `pane swap`. Re-splits use the
temp-tab bounce described above. Everything goes through `HERDR_BIN_PATH`, so
there is no raw socket handling.

## License

MIT
