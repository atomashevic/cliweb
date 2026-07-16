# CLI Web Browser

Or just `cliweb`.

Actual Chromium being rendered in your favorite terminal that supports the [Kitty terminal graphics protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/).

**`cliweb` works best in [Kitty v0.31 or newer](https://github.com/kovidgoyal/kitty/releases)**

## Why?

- Display documentation from [DevDocs](https://devdocs.io)
- Watch the changes from [Vite](https://vitejs.dev) come to life
- Tiled layout without a tiling window manager using [Kitty's layouts](https://sw.kovidgoyal.net/kitty/layouts/)
- Add fancy UI using web technologies, so NeoVim can pretend it is Emacs instead of the other way around

## Installation

Install the published command globally with npm:

```bash
npm install --global @atomashevic/cliweb
```

The npm package contains prebuilt application and toolbar assets. It does not
build the TypeScript application on first launch.

See [npm packaging](docs/NPM_PACKAGING.md) for the package layout and release
workflow.

## Usage

```bash
cliweb [url]

# temporary cookies/storage and no recorded history
cliweb --private [url]

# if url is not provided, it will go to the cliweb homepage (this is temporary, promise)
# the URL protocol can be http:, https:, or data:
# if the URL protocol is not included, https: is used by default
```

For more options look at the help:

```bash
cliweb --help
```

### Kitty

For local side-by-side Codex and cliweb work, native Kitty windows avoid tmux graphics
passthrough entirely. Enable the `splits` layout and remote control for the Kitty window running
Codex:

```conf
allow_remote_control yes
enabled_layouts splits
```

For Codex tool subprocesses, a Kitty control socket is the most reliable transport:

```bash
kitty -o allow_remote_control=yes -o enabled_layouts=splits \
  --listen-on "unix:${XDG_RUNTIME_DIR}/kitty-cliweb"
```

Kitty exports that address as `KITTY_LISTEN_ON` to child processes; the adapter also accepts
`CLIWEB_KITTY_TO` and `CLIWEB_KITTY_WINDOW_ID` as explicit overrides.

Then launch or reuse cliweb beside the current Kitty window while retaining focus:

```bash
cliwebctl kitty ensure https://example.com
```

The adapter switches the current tab to the `splits` layout when necessary and creates a 50/50
vertical native window. `kitten @ launch` reports the new Kitty window ID, which cliweb records in
its authenticated instance descriptor. Close it with `cliwebctl kitty close --window ID`.

Global Kitty remote control is powerful. It can instead be restricted with Kitty passwords or by
launching only the Codex window with `--allow-remote-control`.

### tmux

`cliweb` can render in a local tmux pane when passthrough is enabled:

```tmux
set -g allow-passthrough all
```

tmux 3.3 or newer is required for configurable passthrough, and tmux 3.6 or newer is recommended
for reliable pane pixel dimensions. The tmux server and terminal emulator must run on the same
machine because `cliweb` transfers frames through POSIX shared memory; tmux over SSH is not yet
supported. The `all` setting lets cliweb remove placements after its tmux window becomes hidden.

### Codex control

Start an explicitly controllable browser with:

```bash
cliweb --control https://example.com
```

`cliwebctl` discovers opt-in instances and provides structured commands for status, semantic page
snapshots, screenshots, navigation, clicking, filling, key presses, scrolling, and history. In
native Kitty, `cliwebctl kitty ensure [url]` manages a browser window in the current tab. Inside
tmux, `cliwebctl tmux ensure [url]` reuses a controlled browser in a right-hand pane, starts one in
an idle pane, or creates a new split without replacing a busy process. It briefly activates a new
browser pane so cliweb can complete terminal capability detection, then restores focus to the
calling pane.

Close a controlled tmux browser with `cliwebctl tmux close --pane %N`. This lets cliweb remove its
terminal image placements before tmux removes the pane. Bind pane-kill keys through this command;
`cliwebctl tmux clear-images` clears placements left by an earlier ungraceful kill.

Use a tmux window-change hook to hide images outside the selected window and repaint them when the
browser window becomes visible again:

```tmux
set-hook -g session-window-changed 'run-shell -b "cliwebctl tmux sync --session \"#{session_name}\" --window \"#{window_id}\" >/dev/null 2>&1"'
```

Control uses an authenticated same-user Unix socket on Linux/macOS or named pipe on Windows. No
control endpoint is created unless `--control` is supplied. To install the accompanying Codex skill:

```bash
./install-control-cliweb-skill
```

For nonvisual automation or CI, combine `--control --no-paint`; this mode does not require terminal
graphics or keyboard input because browser input comes through the control bridge.

Browser-data commands are also available on controlled instances:

```bash
cliwebctl --instance ID bookmark-toggle
cliwebctl --instance ID bookmarks --query docs
cliwebctl --instance ID history --limit 100
cliwebctl --instance ID show-bookmarks
cliwebctl --instance ID show-history
cliwebctl --instance ID close-panel
cliwebctl --instance ID screenshot --toolbar --output /tmp/cliweb-toolbar.png
cliwebctl --instance ID clear-site-data
cliwebctl --instance ID clear-history
```

The two clearing commands delete local browser data immediately, so use them only after confirming
the target instance and current page.

## Browser data

cliweb uses a dedicated persistent Chromium profile for normal browsing. Standard site cookies and
web storage therefore survive restarts, while Chromium continues to enforce cookie attributes such
as `Secure`, `HttpOnly`, `SameSite`, domain, path, and expiration. Cookie values are not exposed to
the toolbar or control protocol. Existing data from the older generic Electron profile is migrated
once on first launch.

Bookmarks and up to 10,000 committed main-frame history visits are stored in cliweb's application
data directory. Only HTTP and HTTPS URLs are stored, and URL credentials are removed before a URL
is written. The bookmark and history buttons in the toolbar open full-screen searchable managers.

Useful shortcuts:

- `Ctrl+D` on Linux or `Cmd+D` on macOS toggles the current bookmark.
- `Ctrl+Shift+O` on Linux or `Cmd+Alt+B` on macOS opens bookmarks.
- `Ctrl+H` on Linux or `Cmd+Y` on macOS opens history.
- The erase button in the toolbar clears cookies and site storage for the current site after an
  inline confirmation.

`--private` uses an in-memory Chromium session and does not record visits. Existing bookmarks and
history remain available, and bookmarks can still be changed, matching normal private-browser
behavior. The toolbar displays a `Private` indicator while this mode is active.

## Configuration

`cliweb` can be configured through `$XDG_CONFIG_HOME/cliweb/config.js`, or
`~/.config/cliweb/config.js` when `XDG_CONFIG_HOME` is not set. The default
configuration is copied there on first launch. Changes update any running
`cliweb` process.

Currently it only supports custom keybindings and changing the homepage that displays when no URL is provided.

For more details on keybinding syntax and available actions, see the comments in `config.js`.

## Contributing

See [Contributing to Cliweb](/CONTRIBUTING.md#contributing-to-cliweb).

## Development

Clone the repository and run the local setup script:

```bash
git clone https://github.com/atomashevic/cliweb.git
cd cliweb
./setup.sh
```

You can update your checkout to use another fork by changing the origin:

```bash
# note: you'll have to change the username some-kind-contributor to your GitHub username
git remote set-url origin git@github.com:some-kind-contributor/cliweb.git
# also track the upstream electron branch
git remote add upstream -f -t electron git@github.com:atomashevic/cliweb.git
```

You can make a branch (ex: my-feature-branch) off the latest changes by doing:

```
git fetch upstream electron
git checkout upstream/electron
git switch -c 'my-feature-branch'
```

Read [Your First Code Contribution](/CONTRIBUTING.md#your-first-code-contribution) for more information on making a PR.
