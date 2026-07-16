# CLIWEB rebrand and installation notes

This change establishes `cliweb` as the canonical identity of the application
across its command-line interface, JavaScript packages, Rust native module,
automation, documentation, and runtime state.

## Application identity

- The executable and usage examples now use `cliweb`.
- The native package and source directory are named `cliweb-native-rs`.
- JavaScript imports, Cargo package metadata, N-API binary names, lockfiles,
  CI paths, Dependabot configuration, and release artifact names use the new
  package identity.
- The default homepage and project links point to
  `atomashevic/cliweb` on GitHub.
- The Electron session partition and diagnostic log use `cliweb`-specific
  names, preventing new runtime state from being written under the legacy
  identity.

## Installation and native build

`setup.sh` installs a repository-local Bun runtime and reconciles dependencies
on every explicit setup run. The native N-API module is built locally during
package installation, so installation does not depend on a matching prebuilt
release artifact already existing.

A Rust toolchain with Cargo is therefore required during installation. Setup
checks for Cargo before dependency installation and exits with a direct error
when the toolchain is unavailable.

The native package helper resolves Bun relative to both the source checkout and
its installed location under `node_modules`. This keeps lifecycle scripts
working in either context. The standalone installer in `docs/get` delegates to
the same setup path, avoiding a second installation implementation.

## Linux Chromium sandbox

Electron requires a root-owned setuid Chromium sandbox on Linux. When a
compatible system helper is available, setup links Electron to that helper.
The installer verifies that the helper is executable, setuid, and owned by
root before using it. It does not disable Chromium sandboxing.

The currently recognized system locations are:

- `/opt/google/chrome/chrome-sandbox`
- `/usr/lib/claude-desktop/chrome-sandbox`
- `/usr/lib/chromium/chrome-sandbox`
- `/usr/lib/chromium-browser/chrome-sandbox`

Setup emits a warning when none of these helpers, or an already-correct
Electron helper, is available.

## User impact

- Invoke the application with `cliweb [url]`.
- Replace any shell aliases or symlinks that reference the previous command.
- Existing `config.js` keybinding and homepage configuration remains valid.
- The renamed Electron session partition starts with independent cookies,
  storage, and login state.

## Validation

The change can be checked with:

```bash
./setup.sh
./.bun/bin/bun test
./.bun/bin/bun run typecheck
./.bun/bin/bun run lint
(cd cliweb-native-rs && cargo check --locked)
cliweb --help
cliweb --version
```

A complete runtime smoke test should be run in a terminal that supports the
Kitty graphics protocol, because a generic pseudo-terminal cannot answer the
keyboard and color capability queries used during startup.
