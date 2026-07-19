# Browser control reference

`cliweb --control` creates an authenticated, same-user control endpoint for one browser instance.
`cliwebctl` discovers that endpoint and exposes typed browser operations. The control path and direct
human input both act on the same Chromium session.

No endpoint is created unless `--control` is supplied. On Linux and macOS, descriptors and sockets
live in a mode-`0700` runtime directory and each request carries a random per-instance token. Public
command output omits the token and descriptor path.

## Start or discover a browser

```bash
# Recommended inside tmux
cliwebctl tmux ensure https://example.com

# Recommended in a native Kitty split
cliwebctl kitty ensure https://example.com

# Manual opt-in launch
cliweb --control https://example.com

# List live instances
cliwebctl instances --pretty
```

Target a browser by instance ID, tmux pane, or Kitty window:

```bash
cliwebctl --instance INSTANCE_ID status
cliwebctl --pane %3 status
cliwebctl --kitty-window 17 status
```

When exactly one controlled instance exists, the target may be omitted. If multiple instances
exist, `cliwebctl` returns `AMBIGUOUS_TARGET` until a target is specified.

## Inspect, act, verify

Start every task by confirming the target and reading the current document:

```bash
cliwebctl --pane %3 status
cliwebctl --pane %3 snapshot --pretty
```

`status` reports the URL, title, loading state, viewport, history availability, privacy and bookmark
state, panel mode, document epoch, and adapter metadata. `snapshot` returns a bounded accessibility
tree with semantic roles, names, properties, and refs such as `d2-n41`.

Prefer refs over CSS selectors:

```bash
cliwebctl --pane %3 click --ref d2-n41
cliwebctl --pane %3 fill --ref d2-n52 --text 'Belgrade'
```

Refs belong to the document epoch in which they were created. Take another snapshot after
navigation, after a human changes pages, or after `STALE_REF`.

After an action that may load or rerender the page:

```bash
cliwebctl --pane %3 wait
cliwebctl --pane %3 status
cliwebctl --pane %3 snapshot --pretty
```

## Commands

### Navigation

```bash
cliwebctl --pane %3 navigate https://example.com/path
cliwebctl --pane %3 back
cliwebctl --pane %3 forward
cliwebctl --pane %3 reload
```

### Page interaction

```bash
cliwebctl --pane %3 click --ref REF
cliwebctl --pane %3 click --selector 'button[type=submit]'

cliwebctl --pane %3 fill --ref REF --text 'value'
cliwebctl --pane %3 press --ref REF --key Enter
cliwebctl --pane %3 press --key 'Shift+Tab'

cliwebctl --pane %3 scroll --dy 700
cliwebctl --pane %3 scroll --dx 300 --dy 0
```

`fill` focuses the target, selects its current value, replaces it, and does not implicitly submit
the form. Keys accept modifiers such as `Ctrl+A`, `Shift+Tab`, and `Alt+ArrowLeft`.

### Screenshots

```bash
cliwebctl --pane %3 screenshot --output /tmp/page.png
cliwebctl --pane %3 screenshot --toolbar --output /tmp/toolbar.png
```

The default captures Chromium content. `--toolbar` captures cliweb's trusted navigation surface.

### Browser data and panels

```bash
cliwebctl --pane %3 bookmark-toggle
cliwebctl --pane %3 bookmarks --query notebook --limit 100
cliwebctl --pane %3 history --query localhost --limit 100

cliwebctl --pane %3 show-bookmarks
cliwebctl --pane %3 show-history
cliwebctl --pane %3 close-panel
```

These commands inspect cliweb's application-level bookmarks and sanitized visit history. They do
not expose cookie values or saved passwords.

The following commands delete browser data immediately:

```bash
cliwebctl --pane %3 clear-site-data
cliwebctl --pane %3 clear-history
```

Confirm the intended instance and scope immediately before using either command.

## Sharing control with a human

`cliwebctl` does not lock the renderer or replace terminal input. A human may click and type in the
browser pane between control commands. Both paths share focus, form values, cookies, navigation, and
history.

Use this handoff pattern:

1. Codex inspects and performs the mechanical steps.
2. Codex stops before credentials, CAPTCHA, or an external side effect.
3. The human uses the visible pane directly.
4. Codex takes a fresh `status` and `snapshot` before resuming.

Avoid sending browser keystrokes through tmux automation. Agents should use `cliwebctl`; tmux should
only manage the visible pane or window.

## Safety boundary

Require an immediate human confirmation before submitting forms with external effects, sending
messages, purchasing, deleting data, uploading files, changing permissions, or exposing
credentials. A human can always take the final action directly in the shared pane.

The control bridge intentionally does not provide arbitrary page JavaScript, cookie inspection,
password-store access, or profile-file access.

## Nonvisual mode

For CI or automation that does not need a terminal image:

```bash
cliweb --control --no-paint https://example.com
```

This mode uses the same structured control endpoint but skips terminal graphics and terminal input.
It is not a shared human browser surface.
