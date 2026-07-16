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

# if url is not provided, it will go to the cliweb homepage (this is temporary, promise)
# the URL protocol can be http:, https:, or data:
# if the URL protocol is not included, https: is used by default
```

For more options look at the help:

```bash
cliweb --help
```

### tmux

`cliweb` can render in a local tmux pane when passthrough is enabled:

```tmux
set -g allow-passthrough on
```

tmux 3.3 or newer is required for configurable passthrough, and tmux 3.6 or newer is recommended
for reliable pane pixel dimensions. The tmux server and terminal emulator must run on the same
machine because `cliweb` transfers frames through POSIX shared memory; tmux over SSH is not yet
supported.

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
