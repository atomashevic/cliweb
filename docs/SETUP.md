# Set up the shared terminal browser

The intended workspace is Codex in one tmux pane and cliweb in the pane to its right, rendered by a
local Ghostty or Kitty window. Both panes remain directly usable by the human, while Codex controls
the browser through `cliwebctl`.

## Requirements

- Linux or macOS
- Node.js 22.11 or newer
- Ghostty or Kitty with Kitty graphics-protocol support
- tmux 3.3 or newer; tmux 3.6 or newer is recommended
- Codex running inside the tmux pane that should own the browser sidecar

The terminal emulator, tmux server, and cliweb process must run on the same machine. cliweb passes
rendered frames through POSIX shared memory, so a cliweb process on the far side of SSH cannot yet
paint into a local tmux client.

## Install

Install the prebuilt npm package:

```bash
npm install --global @atomashevic/cliweb
cliweb --version
cliwebctl --help
```

For repository development instead:

```bash
git clone https://github.com/atomashevic/cliweb.git
cd cliweb
./setup.sh
```

On Linux, the package checks Chromium's sandbox helper during installation and again at launch. See
[npm packaging](NPM_PACKAGING.md#linux-chromium-sandbox) for the packaging boundary.

## Configure tmux

Add the following to `~/.tmux.conf`:

```tmux
set -g mouse on
set -g focus-events on
set -g allow-passthrough all
```

`allow-passthrough all` lets cliweb render and remove terminal image placements. Mouse mode lets a
human click the browser pane; cliweb converts tmux's pane-relative cell coordinates into the pixel
coordinates used by Electron.

These hooks stop background cliweb windows from painting over the selected tmux window and repaint
them when they become visible again:

```tmux
set-hook -g session-window-changed 'run-shell -b "cliwebctl tmux sync --session \"#{session_name}\" --window \"#{window_id}\" >/dev/null 2>&1"'
set-hook -g client-session-changed 'run-shell -b "cliwebctl tmux sync --session \"#{session_name}\" --window \"#{window_id}\" >/dev/null 2>&1"'
```

Reload the live server:

```bash
tmux source-file ~/.tmux.conf
```

## Start the side-by-side workspace

Start or attach to a session in Ghostty or Kitty:

```bash
tmux new-session -A -s work
```

Run Codex in the pane that should remain on the left. From that pane, open or reuse cliweb:

```bash
cliwebctl tmux ensure https://example.com --pretty
```

The adapter:

1. identifies the invoking Codex pane;
2. brings that tmux window forward when necessary;
3. reuses a controlled cliweb in the closest right-hand pane;
4. otherwise starts cliweb in an idle pane or creates a vertical split;
5. waits for terminal capability detection and the authenticated control socket; and
6. returns focus to the Codex pane.

The result contains an `instanceId` and `tmuxPane`. Either can target later commands:

```bash
cliwebctl --instance INSTANCE_ID status
cliwebctl --pane %N snapshot --pretty
```

If more than one controlled browser is running, an explicit target is required.

## Install the Codex skill

From a repository checkout:

```bash
./install-control-cliweb-skill
```

This creates a `control-cliweb` skill under `${CODEX_HOME:-$HOME/.codex}/skills`. The skill tells
Codex to use semantic snapshots and typed control commands, verify meaningful actions, respect
document-scoped refs, and leave the human-visible browser running.

Example request:

```text
Use $control-cliweb to open http://127.0.0.1:8888/lab in the right pane and inspect the notebook.
```

## Terminal-specific notes

### Ghostty

Ghostty supports the Kitty graphics protocol directly. Use the tmux workflow above; no Ghostty
remote-control socket is required.

### Kitty with tmux

Use the same tmux workflow. tmux owns the layout and cliweb uses Kitty only as the graphics surface.

### Native Kitty splits

When tmux is not desired, cliweb can instead create a native 50/50 Kitty split. Configure a local
control socket:

```conf
allow_remote_control socket-only
listen_on unix:${XDG_RUNTIME_DIR}/kitty-{kitty_pid}
enabled_layouts splits
```

Restart Kitty after changing `listen_on`, then run inside the target Kitty window:

```bash
cliwebctl kitty ensure https://example.com
```

The adapter records the new Kitty window ID in the instance descriptor. Close it gracefully with:

```bash
cliwebctl kitty close --window ID
```

## Smoke test

```bash
cliwebctl instances --pretty
cliwebctl --pane %N status
cliwebctl --pane %N snapshot --pretty
cliwebctl --pane %N screenshot --output /tmp/cliweb.png
```

Then click a link in the browser pane with the mouse, return to Codex, and run `status` or `snapshot`
again. The URL and document state should reflect the human action.

## Closing and recovery

Close a tmux browser through the adapter so cliweb removes its image placements before the pane is
destroyed:

```bash
cliwebctl tmux close --pane %N
```

If an earlier raw `tmux kill-pane` left a stale browser image:

```bash
cliwebctl tmux clear-images
```

Common failure boundaries:

- **No image:** confirm a local Ghostty/Kitty window and `allow-passthrough all`.
- **No controlled instance:** ensure cliweb was started with `--control`, preferably through the
  adapter.
- **Wrong browser selected:** target `--pane`, `--instance`, or `--kitty-window` explicitly.
- **Image disappears after changing windows:** install the visibility hooks above and verify
  `cliwebctl tmux sync` can reach the instance.
- **Startup works in a shell but not a generic PTY:** terminal capability detection requires a real
  supported terminal emulator.
