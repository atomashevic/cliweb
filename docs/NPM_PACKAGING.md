# npm packaging

The `@atomashevic/cliweb` npm package is a prebuilt command-line application. Installation
must not compile the TypeScript application, build the toolbar, clone the Git
repository, or install a separate Bun runtime.

## Published package layout

The root `package.json` uses a strict `files` allowlist. The tarball contains:

- `dist/index.js`, the bundled Electron main process
- `dist/preload.js`, the bundled toolbar preload
- `dist/runner/index.js`, the Node-based `cliweb` executable
- `dist/toolbar`, the prebuilt toolbar application
- `dist/kitty.css`, the default terminal-aware color theme
- `config.js`, copied into the user's config directory on first launch
- `scripts/configure-sandbox.js`, the Linux sandbox setup hook

Source files, tests, build dependencies, Cargo output, and repository metadata
are excluded from the published package.

The native binding is also prebuilt. `cliweb-native-rs` is a small JavaScript
loader with optional dependencies on four platform packages:

- `cliweb-native-rs-darwin-arm64`
- `cliweb-native-rs-darwin-x64`
- `cliweb-native-rs-linux-arm64-gnu`
- `cliweb-native-rs-linux-x64-gnu`

Each platform package contains one `.node` binary. Installing cliweb never
requires Rust, Cargo, or `@napi-rs/cli` on the consumer machine.

## Build boundary

`npm pack` runs `prepack`, which invokes `scripts/build-package.ts`. The release
build uses esbuild for the relocatable Node and Electron bundles and Vite for
the toolbar. Runtime dependencies remain external and are installed normally
by npm.

The installed launcher reads terminal colors, passes them to Electron through
the environment, and applies them as CSS custom properties. This preserves the
terminal-specific toolbar palette without rebuilding assets on first launch.

## Runtime configuration

On first launch, the packaged `config.js` is copied to:

```text
$XDG_CONFIG_HOME/cliweb/config.js
```

When `XDG_CONFIG_HOME` is unset, the fallback is
`~/.config/cliweb/config.js`. Package upgrades do not overwrite that file.

## Publishing order

The root package depends on `cliweb-native-rs@2.0.5`. Build each native target
on its matching runner, stage it with `stage:package`, then publish the four
platform packages before the loader. The `npm package` GitHub Actions workflow
does this on Linux and macOS for arm64 and x64 and uploads one artifact for each
target.

To reproduce one artifact manually on a matching machine:

```bash
bun run --cwd cliweb-native-rs ci
bun run --cwd cliweb-native-rs stage:package
npm publish --access public ./cliweb-native-rs/npm/<platform>
npm publish --access public ./cliweb-native-rs
```

Repeat the first three commands for Darwin and GNU/Linux on arm64 and x64. All
five native packages must use the same version. Then validate and publish the
root tarball:

```bash
bun install --frozen-lockfile
bun test
bun run typecheck
bun run lint
npm pack --dry-run
npm publish --access public
```

The application package is scoped because npm reserves the similar unscoped
name `cli-web`. The installed command remains `cliweb`:

```bash
npm install --global @atomashevic/cliweb
cliweb --version
```
