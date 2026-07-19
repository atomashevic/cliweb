# cliweb

**A real Chromium browser in your terminal, built to be shared by you and Codex.**

cliweb renders Chromium through the
[Kitty graphics protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/), so a browser can live
beside your shell instead of in a separate desktop window. Its primary use case is a local workspace
made from four pieces:

- **Codex** for reasoning, coding, and structured browser actions
- **tmux** for a durable, shared pane layout
- **Ghostty or Kitty** for high-quality terminal graphics and mouse input
- **cliweb** for the browser that both Codex and the human can control

```text
Ghostty or Kitty
└── tmux window
    ├── Codex + shell ── cliwebctl ── authenticated local socket ──┐
    └── cliweb pane ◀──────────── human mouse + keyboard           │
                         same Chromium instance ◀─────────────────┘
```

Codex can inspect the page, navigate, click, type, scroll, take screenshots, and verify the result.
At the same time, you can move into the browser pane and use it normally. Log in yourself, solve a
CAPTCHA, review a form, adjust a notebook cell, or take over whenever visual judgment matters; Codex
can resume from the resulting browser state.

## What this workspace is for

- Run JupyterLab beside a shell and collaborate on notebooks without leaving tmux.
- Preview local HTML, documentation, Vite applications, and other development servers.
- Browse technical material while Codex follows links, extracts page structure, and keeps context.
- Let Codex prepare forms while a human reviews sensitive fields and controls final submission.
- Reproduce UI bugs, reload after code changes, and capture the exact rendered viewport.
- Keep one persistent browser session that survives the handoff between agent and human.

See [practical workflows](docs/WORKFLOWS.md) for complete examples.

## Quick start: Codex + tmux + cliweb

### 1. Install cliweb

```bash
npm install --global @atomashevic/cliweb
cliweb --version
cliwebctl --help
```

The published package contains prebuilt application, toolbar, and native assets. It does not build
the TypeScript application on first launch.

### 2. Configure tmux

Use tmux 3.3 or newer; 3.6 or newer is recommended. Add this to `~/.tmux.conf`:

```tmux
set -g mouse on
set -g focus-events on
set -g allow-passthrough all
```

Then reload the configuration:

```bash
tmux source-file ~/.tmux.conf
```

Ghostty and Kitty both understand the graphics protocol used by cliweb. The terminal emulator,
tmux server, and cliweb process must currently run on the same machine because rendered frames use
POSIX shared memory.

### 3. Open the shared browser pane

Start Codex inside tmux, then run this from the Codex pane—or ask Codex to run it:

```bash
cliwebctl tmux ensure https://example.com
```

The adapter reuses a controlled cliweb to the right when one exists. Otherwise it starts cliweb in
an idle right-hand pane or creates a 50/50 split. The returned JSON includes the instance ID and tmux
pane ID.

The browser is immediately available through both paths:

```bash
# Codex/automation path
cliwebctl --pane %N status
cliwebctl --pane %N snapshot --pretty

# Human path
# Click into pane %N and use the normal mouse and keyboard.
```

### 4. Install the Codex skill

The repository includes the `control-cliweb` skill, which teaches Codex how to create or reuse the
browser sidecar and follow the inspect-act-verify workflow. Install it once for your Codex user:

```bash
git clone https://github.com/atomashevic/cliweb.git
cd cliweb
./install-control-cliweb-skill
```

The installer creates this symlink:

```text
${CODEX_HOME:-$HOME/.codex}/skills/control-cliweb -> <cliweb checkout>/skills/control-cliweb
```

Because the installation is a symlink, pulling a newer cliweb checkout also updates the installed
skill. The installer is safe to rerun when that exact symlink already exists; if another file or
skill occupies the target path, it stops without replacing it.

Verify the installation from your shell:

```bash
test -f "${CODEX_HOME:-$HOME/.codex}/skills/control-cliweb/SKILL.md" \
  && echo 'control-cliweb is installed'
```

Codex normally detects the new skill automatically. If it does not appear, restart Codex, then run
`/skills` or type `$control-cliweb` in a prompt to select it. For example:

```text
Use $control-cliweb to open the app in the right tmux pane, inspect it, and test the form.
```

The skill uses `cliwebctl` for page interaction and leaves the same pane available for direct human
input.

## The shared-control loop

A reliable browser task follows four steps:

```bash
# 1. Open or reuse the browser.
cliwebctl tmux ensure https://example.com

# 2. Confirm the target and inspect the page.
cliwebctl --pane %N status
cliwebctl --pane %N snapshot --pretty

# 3. Act through stable semantic refs returned by the snapshot.
cliwebctl --pane %N click --ref d1-n13

# 4. Wait for the page and verify its new state.
cliwebctl --pane %N wait
cliwebctl --pane %N status
```

Snapshot refs are scoped to the current document. Take a new snapshot after navigation or after a
`STALE_REF` response. A human can interact between any two commands; Codex should simply inspect the
new state before continuing.

Read the [control reference](docs/CONTROL.md) for navigation, filling, key presses, screenshots,
history, bookmarks, panels, and instance targeting.

## Direct browser usage

cliweb is also useful without Codex:

```bash
cliweb [url]

# temporary cookies/storage and no recorded history
cliweb --private [url]

# expose the authenticated local control endpoint
cliweb --control [url]

# nonvisual automation or CI
cliweb --control --no-paint [url]
```

Supported URL schemes are `http:`, `https:`, `file:`, and `data:`. When a scheme is omitted,
`https:` is used.

## Human review and sensitive actions

Shared control is especially useful when a browser task crosses a trust boundary:

- Codex can fill ordinary fields and explain what remains.
- The human can enter passwords, payment data, or other credentials directly in the browser pane.
- The human can solve CAPTCHAs and complete browser-native authentication prompts.
- External submissions, purchases, messages, uploads, deletions, and permission changes should be
  confirmed immediately before the final action.

cliweb does not expose cookie values, password stores, or arbitrary page JavaScript through its
control protocol.

## Browser data

Normal browsing uses a dedicated persistent Chromium profile, so standard cookies and web storage
survive restarts. Bookmarks and up to 10,000 committed main-frame history visits are stored in
cliweb's application data directory. Only HTTP and HTTPS history entries are recorded, and URL
credentials are removed before storage.

Useful shortcuts:

- `Ctrl+D` on Linux or `Cmd+D` on macOS toggles the current bookmark.
- `Ctrl+Shift+O` on Linux or `Cmd+Alt+B` on macOS opens bookmarks.
- `Ctrl+H` on Linux or `Cmd+Y` on macOS opens history.
- The toolbar erase button clears site data for the current origin after inline confirmation.

`--private` uses an in-memory Chromium session and does not record visits. Existing bookmarks and
history remain available.

## Configuration

The configuration file is `$XDG_CONFIG_HOME/cliweb/config.js`, or
`~/.config/cliweb/config.js` when `XDG_CONFIG_HOME` is unset. The default is copied on first launch,
and edits are picked up by running cliweb processes.

Configuration currently covers the homepage and Neovim-style keybindings. See the comments in
[`config.js`](config.js) for syntax and available actions.

## Documentation

- [Workspace setup](docs/SETUP.md): tmux, Ghostty, Kitty, the Codex skill, and troubleshooting
- [Control reference](docs/CONTROL.md): instances, snapshots, actions, verification, and safety
- [Practical workflows](docs/WORKFLOWS.md): Jupyter, HTML, browsing, forms, and UI debugging
- [npm packaging](docs/NPM_PACKAGING.md): package contents and release workflow
- [Rebrand notes](docs/REBRAND.md): the historical migration to the cliweb identity
- [Contributing](CONTRIBUTING.md): development and pull requests

## Development

```bash
git clone https://github.com/atomashevic/cliweb.git
cd cliweb
./setup.sh

./.bun/bin/bun test
./.bun/bin/bun run typecheck
./.bun/bin/bun run lint
./.bun/bin/bun run build
```

A runtime smoke test must be performed in Ghostty or Kitty; a generic pseudo-terminal cannot verify
the graphics, keyboard, mouse, and browser-control paths.
