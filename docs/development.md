# Development and maintenance

The desktop repository contains the Electron wrapper and build configuration. The guide's data, UI, translations, and assets live in the separate [Food Guide repository](https://github.com/bluehexagons/foodguide), pinned here as `app/foodguide`.

## Repository layout

| Path                       | Purpose                                                                                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `index.js`                 | Electron window and application lifecycle                                                                                     |
| `lib/`                     | Navigation policy and packaging file selection                                                                                |
| `forge.config.mjs`         | Makers, asset generation, package verification, and Electron fuses                                                            |
| `scripts/`                 | Generate sprites/icons, verify packaged assets, and run native smoke tests                                                    |
| `tests/`                   | Wrapper regression tests and the real Electron smoke test                                                                     |
| `tools/image-size-compat/` | Local callback-compatible adapter for the DMG image parser                                                                    |
| `app/foodguide/`           | Guide submodule; see its [development documentation](https://github.com/bluehexagons/foodguide/blob/main/docs/development.md) |
| `.generated/`, `out/`      | Ignored generated icons, packages, and test captures                                                                          |

The wrapper loads the bundled entry page with Node integration disabled, context isolation enabled, and renderer sandboxing enabled. It allows navigation to that page and its anchors. Other local files and popups are blocked; credential-free HTTPS links go to the system browser. Squirrel installation events exit before normal startup.

## Checks

Install both dependency sets as described in the [README](../README.md). Run `npm run check` for unit tests, lint, formatting, and guide type checks. To format wrapper code and documentation, run `npx prettier --write .`; the root formatter ignores the separately maintained guide.

Run `npm run test:electron` from a graphical session. Its temporary profile keeps tests independent of personal app preferences, and its screenshot is saved to `out/test-results/electron-smoke.png`. On a headless Linux machine with Xvfb installed:

```sh
xvfb-run -a npm run test:electron
```

Before changing build tooling or the submodule, also run `npm run make` and open the resulting packaged app. The Forge `postPackage` hook checks the ASAR archive for required guide files and generated sprites. Linux AppImage builds need `mksquashfs`.

## Update the embedded guide

Normal checkout and CI use the committed submodule revision. They do not automatically follow the guide's latest branch.

After guide changes have been reviewed and committed in its own repository:

```sh
git -C app/foodguide fetch origin
git -C app/foodguide checkout <reviewed-guide-commit>
npm ci --ignore-scripts --prefix app/foodguide
npm run check
npm run test:electron
npm run make
git add app/foodguide
git commit -m "chore: update embedded Food Guide"
```

The parent commit records the gitlink; guide edits must be committed and pushed in the guide repository first. After pulling desktop changes, synchronize the pinned checkout with `git submodule update --init --recursive`.

## Dependencies

Use `npm outdated` and `npm audit` at the root, and repeat them with `--prefix app/foodguide` for the guide. Upgrade guide dependencies in the guide repository.

Forge 8 requires Node.js 22.13 or newer and uses ES modules for its tooling configuration. Node.js 24 LTS is used in CI. The `@reforged/maker-appimage` override selects Forge's 8.0.1 maker base because its published dependency range still selects Forge 7 and brings in vulnerable build dependencies. Recheck that override when upgrading either package; the AppImage build exercises its compatibility.

The root `allowScripts` entry permits the reviewed `electron-winstaller` script to select its host architecture's 7-Zip files. When upgrading that dependency with npm versions that require script approval, inspect the changed script and refresh the pinned approval.

### DMG image parser compatibility

The macOS DMG toolchain still requests the old `image-size` API:

```text
@electron-forge/maker-dmg → electron-installer-dmg → appdmg → image-size
```

[GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) concerns an infinite loop when parsing a malformed ICNS image. The targeted `appdmg` override replaces its vulnerable parser with `tools/image-size-compat`. This adapter exports the callable `imageSize` function from the pinned [community-maintained `image-size-next@1.2.2`](https://github.com/lcf2212dev/image-size-next/blob/main/SECURITY.md), preserving file paths and callbacks. The original patched 2.x API would require changes to `appdmg`.

The override's `../../tools/image-size-compat` path is relative to `node_modules/appdmg`. Keep the adapter installed as a direct development dependency so its compatibility tests also run on Windows and Linux, where `appdmg` is optional and skipped. Tests cover buffers, synchronous file reads, background callbacks, missing-file errors, and malformed ICNS input in a child process with a timeout. The macOS CI job also verifies that the installed `appdmg` resolves this adapter and builds an actual DMG.

Both full and production dependency audits are clean as of October 9, 2026. The parser and adapter are development dependencies excluded from the app archive. Recheck the fork and override when the DMG toolchain updates; remove the adapter once upstream provides a compatible patched parser.
