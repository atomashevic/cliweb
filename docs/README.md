# cliweb documentation

cliweb is designed as a shared browser for a terminal workspace: Codex and a human operate the same
Chromium instance from adjacent tmux panes inside Ghostty or Kitty.

Start with these guides:

1. [Workspace setup](SETUP.md) — install cliweb, configure tmux, and open the shared sidecar.
2. [Control reference](CONTROL.md) — inspect, navigate, click, type, scroll, and verify safely.
3. [Practical workflows](WORKFLOWS.md) — use the workspace with Jupyter, local HTML, forms, and
   research.

Maintainer references:

- [npm packaging](NPM_PACKAGING.md)
- [Rebrand and installation notes](REBRAND.md)

## Mental model

There is one browser and two input paths:

```text
human ── mouse/keyboard ──▶ cliweb Chromium ◀── local control socket ── Codex
```

Human actions and control commands share navigation history, cookies, focus, form state, and the
rendered page. Neither path creates a second hidden browser. After the other party acts, inspect the
current state before continuing.
