# HyprTile
A fork of (gtile)[https://github.com/gTile/gTile.git]

# Table of Contents

- [User Documentation](#user-documentation)
  - [Installation](#installation)
    - [Install Latest Build](#install-latest-build)
    - [Install from Source](#install-from-source)
  - [Configuration](#configuration)
  - [Usage](#usage)
    - [Window Spacing and Insets](#window-spacing-and-insets)
- [Developer Documentation](#developer-documentation)
  - [Prerequisites](#prerequisites)
  - [Workflow](#workflow)
  - [Testing](#testing)
  - [Code Structure](#code-structure)
  - [Design Principles](#design-principles)
  - [Code Style Guide](#code-style-guide)
  - [Resources](#resources)

# User Documentation

## Installation

### Install Latest Build
Alternatively, the most recent stable version may also be downloaded as a distributable archive (`hyprtile.dist.tgz`) through the [GitHub releases page](https://github.com/topazrn/hyprtile/releases).

```shell
# Replace `VERSION` with the most recent release.
wget https://github.com/topazrn/hyprtile/releases/download/VERSION/hyprtile.dist.tgz

# The `-f` flag will perform an upgrade, if necessary.
gnome-extensions install -f ~/Downloads/hyprtile.dist.tgz

# The changes only become effective once the shell session was restarted.
# In case the extension was installed for the first time it must be enabled afterwards.
gnome-extensions enable HyprTile@topazrn
```

### Install from Source
Alternatively, you can build and install the latest version from GitHub. Make sure to have a working `git` and `npm` installation.

```shell
git clone https://github.com/HyprTile/HyprTile.git
cd HyprTile
npm ci
npm run build:dist
npm run install:extension
```

After restarting your Gnome shell session you can enable the extension via:

```shell
gnome-extensions enable HyprTile@topazrn
```

## Configuration

The extension can be configured through a dedicated preferences dialog. You can open the extension settings either through the [Gnome Extensions](https://apps.gnome.org/Extensions/) app, or by executing the following command in your terminal:

```shell
gnome-extensions prefs HyprTile@topazrn
```

Note that most settings are applied either immediately or after toggling the HyprTile overlay. There is one exception though. When the theme is changed, the extension needs to be disabled and then enabled again for the new theme to become effective.

## Usage

Hyprtile auto tiles all windows on screen


### Window Spacing and Insets

By default, windows snap seamlessly to one another. You can optionally configure a margin between windows (aka gaps in) and the screen edges (aka gaps out). The illustration below depicts how insets and margins are applied to the windows.

![insets-and-spacing](https://github.com/HyprTile/HyprTile/assets/3457747/b2ea5e69-9a0a-481c-ba03-307d562a34d7)

# Developer Documentation

## Prerequisites
To build and develop the extension `node`, `npm`, `git` and a few standard GNU utilities are required. Check the `scripts` section of `package.json` to see which GNU utilities are used.

To get started, checkout the repository and install the required dependencies:

```shell
git clone https://github.com/topazrn/hyprtile.git
cd hyprtile
npm ci
```

## Workflow

Testing changes can be tedious at times because an extension cannot be updated in-place. The Gnome shell session must be restarted in order for changes to take effect. In Wayland it is usually much easier to start a nested session instead. Check the [GJS documentation](https://gjs.guide/extensions/development/debugging.html#reloading-extensions) on how to best debug extensions. Note that nested gnome sessions can take time to load and does not allow to test multi-screen setups. I personally found it most productive to have a second remote system which I used to continuously test the extension on. For this purpose I added a simple new script to `package.json`:

```json
{
  "scripts": {
    "install:remote": "scp hyprtile.dist.tgz remotehost:~/Downloads && ssh remotehost gnome-extensions install -f ~/Downloads/hyprtile.dist.tgz",
  }
}
```

Deploying a change is as simple as executing `npm run build:dist && npm run install:remote` and restart the Gnome session on the remote system. When developing locally use the `npm run install:extension` command instead.

## Testing

```shell
# For a one-off run of all tests
npm run test
```

**Note:** All tests are strictly kept in the `test/` directory, in isolation to the `src/` directory. Test files do _not_ have a special naming convention such as a required `.spec.ts` suffix. Thus, keeping tests in a separate directory allows them to be transpiled on-demand when needed and avoids pollution of the redistributable build.

## Code Structure

```
dist                - Contents will be distributed 1:1 whenever the extension is build
├── schemas         - Contains the GSettings definitions. Required for reading/writing settings
└── metadata.json   - The extension metadata.json as recognized by Gnome

src                 - The TypeScript root directory
├── core            - Contains the main orchestration classes that are instantiated as singleton
├── types           - Contains _only_ TypeScript types that do NOT(!) emit code
├── util            - Reusable helper classes or functions
├── extension.ts    - The entry point for the extension invoked by Gnome shell
└── prefs.ts        - The entry point for the preferences dialog

test                - Tests are kept separate from src/ and are not transpiled by "npm run build"
```

Note that `src/types/` must not contain any files that emit actual JS runtime code. Transpiled files in `dist/types/` (as emited by `tsc` during transpilation) are deleted by the `postbuild` script in `package.json`.

## Design Principles
The code base follows the [SOLID](https://en.wikipedia.org/wiki/SOLID) paradigm __up to an extent__. Although it doesn't strictly follow the paradigm it is definitely architectured with these principles in mind. Try to stick with these principles when changing the architecture, e.g., to ease [adaptation for different desktop environments](https://github.com/HyprTile/HyprTile/issues/103).

The extension makes use of the GJS mechanisms where possible. In particular, the UI components make extensive use of GObject [Properties and Signals](https://gjs.guide/guides/gobject/basics.html) for synchronization purposes. UI components are modeled as general purpose, composable components. In particular, they do not contain any logic other than strictly related to rendering. Business logic is supposed to reside in an orchestrating class or function.

## Code Style Guide
The project does intentionally avoid the use of linters such as prettier or eslint. Quick comprehension is more important than following strict code formatting rules. That being said, please try to comply with the implicit code style used throughout the code base. In particular:

- Respect the `.editorconfig` file - best with a plugin that automatically applies the rules.
- Code lines should not exceed 80 characters in length
- Public members (methods and fields) of exported classes should be documented in JSDoc style.
  - This also applies to exported types, interfaces and functions unless they are really self-explanatory.
- In general, private members of classes or non-exported types/functions should not require to be documented as the complexity of the inner-workings of a class (or similar) should remain comprehensible. In case the complexity gets out of hand consider to refactor the class or document the functions where necessary.
- Prefer [native ECMAScript private properties](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes/Private_properties) over [TypeScript’s `private` visibility specifier](https://www.typescriptlang.org/docs/handbook/2/classes.html#private).

At the time of its release, this extension was quite possibly the most TypeScript conformant extension in the Gnome ecosystem. It is in the interest of the author to honor that by utilizing the capabilities of TypeScript where possible to achieve maximum type-safety during compile time.

## Resources

When developing in the Gnome ecosystem, these are the primary go-to resources to refer to.

- https://gjs.guide/ for a written documentation and explanation of core concepts.
- https://gjs-docs.gnome.org/ for an API reference of the GJS libraries.
- https://gitlab.gnome.org/GNOME/gnome-shell to lookup the source code of the (otherwise officially undocumented) Gnome-shell API.
