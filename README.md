# Food Guide — desktop edition

An unofficial [Don't Starve Food Guide](https://github.com/bluehexagons/foodguide) in an Electron desktop app. The bundled guide works offline; external HTTPS links open in your default browser.

Ingredient pickers offer **Cooking: Practical** to hide redundant forms and uncommon
inputs while keeping recipe specialties, or **Cooking: Everyday** for a smaller
routine cooking list. **Cooking: All** restores every available ingredient. Each
picker remembers its choice; switching views leaves selected ingredients in place.

Efficiency tables group consecutive combinations for the same recipe, preserving
their sort order. Expand a recipe to inspect combinations or click its ingredients
to load the Simulator. Pause calculations to inspect more results, and use
**Reset filters** to restore the analysis's original filters.
The progress bar counts all checked combinations, including those without a valid
recipe, and calculations yield frequently to keep scrolling and pause responsive.

Download Windows and Linux builds from [Releases](https://github.com/bluehexagons/foodguide-app/releases). Windows has a Squirrel installer and a portable ZIP. Linux has an AppImage and a Debian package. Builds target a specific processor architecture; AppImages still require a compatible Linux system.

## Run from source

Basaltwater on Debian is the reference development environment. Its
[shared standards and skills](https://github.com/bluehexagons/basaltwater/blob/main/docs/agents/project-standards.md)
provide environment support; the native commands below also work with manually
installed prerequisites on the documented platforms.

Use Node.js 24 or newer and Git. CI uses Node.js 24; `nvm use` selects that major version from `.nvmrc`. Dependency installation rejects older Node versions. The app and embedded guide each have their own dependencies, so install both:

```sh
git clone --recurse-submodules https://github.com/bluehexagons/foodguide-app.git
cd foodguide-app
npm ci
npm ci --ignore-scripts --prefix app/foodguide
npm start
```

For an existing checkout, run `git submodule update --init --recursive` before installing. GitHub's generated source archives omit the guide submodule; use a recursive clone.

The wrapper is written in strict TypeScript. Starting and packaging automatically compile
the wrapper and embedded guide, then generate sprite sheets and platform icons from the guide's assets. Generated files stay out of Git.

The app starts with one window. Launching it again focuses the running app.
**File → New Window** (`Ctrl+N` / `Cmd+N`) and modified section-link clicks are
available for optional comparisons. Pot choices and picker views are independent;
named inventories, cookbook dishes, theme, and language synchronize across windows.
The # links beside food and recipe names link to a highlighted entry.

**File → Copy Link to Current Section** (`Ctrl+Shift+C` / `Cmd+Shift+C`) copies a
web link to the section and game. Use the guide's **Share** button to include a pot
or inventory snapshot, choose which page settings to include, or link to the
GitHub repository or development site. Sharing choices stay in the current
window until it closes; links never include your installation path.
Shared inventory links create new named copies. **My cookbook** saves combinations
with their game settings. **Options** provides language and theme settings alongside JSON backup
import/export for inventories and dishes, including transfers between the app
and web guide. Language and theme controls also remain in the main header.

## Validate changes

```sh
npm run check
npm run audit
npm run test:electron
```

`check` runs wrapper and guide unit tests, oxlint, oxfmt checks, and strict TypeScript checks for the wrapper, Forge configuration, and guide. `audit` checks both dependency sets. `test:electron` opens the real app with a temporary profile, checks sprites, keyboard and mouse ingredient entry, keyboard table sorting and focus, saved preferences, and sandbox settings, then closes it. These commands require the two dependency installs above. The Electron test also needs a graphical session; Linux CI uses `xvfb-run -a npm run test:electron`.

See [development and dependency maintenance](docs/development.md) for the repository layout, submodule updates, and packaging dependency overrides.
See [artifact retention](docs/artifacts.md) before clearing generated output,
packaged apps or smoke-test captures.

## Package the app

Electron Forge builds for the current operating system and architecture:

```sh
npm run package
npm run make
```

The unpacked app goes in `out/foodguide-app-<platform>-<arch>/`; installers go in `out/make/`. Packaging verifies that the archive contains the guide, sprites, runtime dependencies, and licenses, and excludes development files.

| Platform | Configured outputs               | Additional requirements                                    |
| -------- | -------------------------------- | ---------------------------------------------------------- |
| Windows  | Squirrel installer, portable ZIP | Build on Windows                                           |
| Linux    | AppImage, Debian package         | `mksquashfs` from `squashfs-tools`; Debian packaging tools |
| macOS    | DMG                              | Build on macOS                                             |

On Debian/Ubuntu, install Linux build tools with `sudo apt-get install squashfs-tools dpkg`. For other distributions, install their equivalent packages. To target a different architecture, pass Forge's `--arch` option, for example `npm run make -- --arch=arm64`. A normal build produces one architecture rather than a universal macOS app.

GitHub Actions validates and builds Windows, Linux, and macOS on pushes to `main`, pull requests, and manual runs. CI artifacts expire after three days. Version tags publish Windows and Linux release artifacts and SHA256 checksums; see [release instructions](docs/releases.md).

## License and credits

The repository is licensed under [Apache-2.0](LICENSE), as is the embedded [Food Guide](https://github.com/bluehexagons/foodguide/blob/main/LICENSE). See the guide's About tab for contributors and game asset credits. Don't Starve and its artwork belong to Klei Entertainment; this project is unofficial.
