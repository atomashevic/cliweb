---
name: control-cliweb
description: Control an opt-in cliweb browser through cliwebctl and place it beside Codex with a native Kitty window or tmux pane. Use when the user asks Codex to open, inspect, navigate, click, type, scroll, screenshot, or test a page in cliweb, especially for side-by-side terminal browser workflows.
---

# Control cliweb

Use `cliwebctl` for page interaction. Use Kitty or tmux only to discover, start, or close the visible browser surface; do not inject page keystrokes through the terminal multiplexer.

## Connect

1. Pass the user's exact URL in the first ensure command and retain the returned `instanceId`:
   - In native Kitty (`KITTY_WINDOW_ID` set and `TMUX` unset), run `cliwebctl kitty ensure <exact-url>`.
   - Inside tmux, run `cliwebctl tmux ensure <exact-url>`.
   - Outside either adapter, run `cliwebctl instances` and continue only when the intended instance is unambiguous.
2. Prefer native Kitty for local Codex + cliweb work. It creates a 50/50 vertical Kitty split and retains focus on Codex.
   Require Kitty remote control with a reusable `KITTY_LISTEN_ON` socket; use `CLIWEB_KITTY_TO` and `CLIWEB_KITTY_WINDOW_ID` only when environment inheritance is unavailable.
3. Run `cliwebctl --instance <id> status` before reading or acting.
4. Leave an existing cliweb launched without `--control` intact; let the selected adapter create a separate controlled browser.

## Inspect and act

1. Run `cliwebctl --instance <id> snapshot` for the semantic page state.
2. Prefer returned element refs such as `d2-n41`. Use `--selector` only when the accessibility snapshot has no usable ref.
3. Treat refs as document-scoped. Take a new snapshot after navigation or a `STALE_REF` error.
4. Use the typed commands:

```text
cliwebctl --instance <id> navigate <url>
cliwebctl --instance <id> click --ref <ref>
cliwebctl --instance <id> fill --ref <ref> --text <text>
cliwebctl --instance <id> press [--ref <ref>] --key <key>
cliwebctl --instance <id> scroll --dy <pixels> [--dx <pixels>]
cliwebctl --instance <id> back|forward|reload
cliwebctl --instance <id> bookmark-toggle
cliwebctl --instance <id> bookmarks|history [--query text] [--limit count]
cliwebctl --instance <id> show-bookmarks|show-history|close-panel
cliwebctl --instance <id> clear-site-data|clear-history
```

5. After a meaningful action, run `cliwebctl --instance <id> wait`, then inspect `status` or `snapshot` to verify the result.
6. When visual state matters, save a viewport screenshot and inspect the resulting PNG:

```text
cliwebctl --instance <id> screenshot --output /tmp/cliweb.png
cliwebctl --instance <id> screenshot --toolbar --output /tmp/cliweb-toolbar.png
```

## Safety and cleanup

- Confirm immediately before submitting forms with external effects, sending messages, purchasing, deleting data, uploading files, changing permissions, or exposing credentials.
- Treat `clear-site-data` and `clear-history` as destructive: confirm the intended instance and scope immediately before calling either command.
- Do not inspect cookies, password stores, or cliweb profile files.
- Do not use arbitrary page JavaScript; the control bridge intentionally exposes typed operations only.
- Leave cliweb and its terminal window running unless the user asks to close it.
- For Kitty, close with `cliwebctl kitty close --window <kitty-window-id>` from the instance descriptor.
- When asked to close a cliweb pane, run `cliwebctl tmux close --pane <pane-id>`. Do not use raw `tmux kill-pane`; graceful close must remove terminal image placements before tmux removes the pane.
- If a previous ungraceful kill left a browser image visible, run `cliwebctl tmux clear-images` once.
- If control fails, report the exact `cliwebctl` error. Do not silently switch to the Chrome plugin or another browser.
