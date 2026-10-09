# Food Guide — desktop edition

An unofficial [Don't Starve Food Guide](https://github.com/bluehexagons/foodguide) in an Electron desktop app. The bundled guide works offline; external HTTPS links open in your default browser.

Download Windows and Linux builds from [Releases](https://github.com/bluehexagons/foodguide-app/releases). Windows has a Squirrel installer and a portable ZIP. Linux has an AppImage and a Debian package. Builds target a specific processor architecture; AppImages still require a compatible Linux system.

## Run from source

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

## Validate changes

```sh
npm run check
npm run audit
npm run test:electron
```

`check` runs wrapper and guide unit tests, oxlint, oxfmt checks, and strict TypeScript checks for the wrapper, Forge configuration, and guide. `audit` checks both dependency sets. `test:electron` opens the real app with a temporary profile, checks sprites, keyboard and mouse ingredient entry, saved preferences, and sandbox settings, then closes it. These commands require the two dependency installs above. The Electron test also needs a graphical session; Linux CI uses `xvfb-run -a npm run test:electron`.

See [development and dependency maintenance](docs/development.md) for the repository layout, submodule updates, and packaging dependency overrides.

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

GitHub Actions validates and builds Windows, Linux, and macOS on pushes to `main` and `feature/typescript-migration`, pull requests, and manual runs. CI artifacts expire after three days. Version tags publish Windows and Linux release artifacts and SHA256 checksums; see [release instructions](docs/releases.md).

## License and credits

The repository is licensed under [Apache-2.0](LICENSE), as is the embedded [Food Guide](https://github.com/bluehexagons/foodguide/blob/main/LICENSE). See the guide's About tab for contributors and game asset credits. Don't Starve and its artwork belong to Klei Entertainment; this project is unofficial.
