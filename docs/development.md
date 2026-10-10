# Development and maintenance

The desktop repository contains the Electron wrapper and build configuration. The guide's data, UI, translations, and assets live in the separate [Food Guide repository](https://github.com/bluehexagons/foodguide), pinned here as `app/foodguide`.

The guide's browser suite includes keyboard navigation and axe-core accessibility
audits of every panel in both themes and all three languages. It also checks
emulated touch taps, canceled gestures, scrolling, long-press handling, and
control sizing across narrow phone and larger tablet/desktop viewports, including
increased text spacing and complete touch-visible ingredient names. It verifies
localized search feedback, persistent ingredient error explanations, non-color
selection indicators, forced-color display, and keyboard scrolling of named
tables. Manual column selections override Auto while retaining the other visible
columns. Resizing or zooming moves focus out of hidden cells to their column
buttons. Analysis exposes bounded partial results when paused and gives localized
feedback when no results match the filters. Changing language preserves Discovery
calculations and filters. Completed-result pagination follows filters and language
changes while retaining the expanded limit. Paused analyses can load more results;
the table distinguishes loaded matching combinations from the calculation total
and explains its snapshot during calculation. Reset filters restores the original
exclusions and clears requirements while retaining the pagination limit. The guide
also omits undefined percentage gains for zero ingredient baselines and drains
delivered batch results to avoid retaining a second result collection.
Ingredient, tab, and game changes
save immediately, so recovery does not depend on a normal page unload. Run it with
`npm --prefix app/foodguide run test:browser` after installing Chromium in that
checkout. The native Electron smoke test separately exercises arrow-key tabs,
ingredient removal with Space, empty-slot activation, Escape/reopening the picker,
and table sorting with keyboard focus retained. It checks the grouping menu with
native keyboard input, named result groups, option positions, and selected-only
removal controls while exercising ingredient shortcuts inside grouped results.
The minus appears only for multiple pot copies and disappears when one remains;
the checkbox stays anchored at the trailing edge in both states.
Icon mode checks square tiles, centered sprites, aligned shortcuts, and a clear
size difference between compact, normal, and cozy. Compact uses fixed smaller
tiles; touchscreens retain 44-pixel targets.
Wide pickers stack group cards in columns in one scroll area, reading top to
bottom and then left to right without gaps beneath shorter cards. Narrow pickers
stack groups in one column. The native smoke test checks card spacing, reading
order, and native zoom, and the guide's browser suite
verifies each display/density combination and focus across resizing.
Efficiency results group consecutive combinations without changing their sort
order. The native smoke test expands a recipe with the keyboard, activates a
combination to fill the Simulator, and checks exact ingredient keys and immediate
saved state. Returning retains the Discovery calculation and expanded group.
It also checks filter resets through native keyboard input and localized matching
counts without losing the loaded limit.
Cooking views retain selected food, explain fully and partially hidden search
matches, and offer Show all recovery that preserves the query and restores search
focus. The native smoke test verifies recovery and its saved view preference.
It also checks empty-search status
feedback, visible full-pot error recovery, manual column selection, focus recovery,
and horizontal table scrolling at 200% zoom. It also exercises a larger Discovery
inventory, filtered and localized pagination, immediate selection saves, and
restored ingredients after reload. Focused table regions handle
unmodified Left/Right directly; table buttons retain their own keyboard behavior.

Native File/Edit/View/Window menus preserve platform keyboard and accessibility
conventions. The View menu provides zoom in/out/reset with the standard
Command/Ctrl shortcuts. Pinch zoom is enabled from 1× to 5× after each page load;
Electron [disables visual zoom by default](https://www.electronjs.org/docs/latest/api/web-contents#contentssetvisualzoomlevellimitsminimumlevel-maximumlevel).
The native smoke test verifies menu zoom actions on every platform and injected
keyboard zoom/reset on Windows/Linux. On macOS it verifies the installed menu
commands and their accelerators; this harness's synthetic renderer keys do not
activate the Cocoa application menu. Check native shortcuts, pinch behavior, and touch target sizing
on physical devices as well.

## Repository layout

| Path                           | Purpose                                                                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `src/index.cts`                | Electron window and application lifecycle                                                                                     |
| `src/lib/`                     | Navigation policy and packaging file selection                                                                                |
| `forge.config.mts`             | Makers, asset generation, package verification, and Electron fuses                                                            |
| `src/scripts/`                 | Generate sprites/icons, verify packaged assets, and run native smoke tests                                                    |
| `tests/`                       | Wrapper regression tests and the real Electron smoke test                                                                     |
| `tools/image-size-compat/`     | Local callback-compatible adapter for the DMG image parser                                                                    |
| `app/foodguide/`               | Guide submodule; see its [development documentation](https://github.com/bluehexagons/foodguide/blob/main/docs/development.md) |
| `dist/`, `.generated/`, `out/` | Ignored generated icons, packages, and test captures                                                                          |

Production and build sources use strict TypeScript. `npm run build` compiles the
wrapper to `dist/` and builds the pinned guide. `.cts` files emit CommonJS for
Electron; `.mts` build tools emit ES modules. Forge loads `forge.config.mts`
through its TypeScript configuration support after the scripts have been built.
`npm start`, `npm run package`, and `npm run make` build automatically.
JavaScript tests run against the compiled runtime. The small `image-size-compat`
installation adapter remains JavaScript so it can run during dependency installation.

The wrapper loads the bundled entry page with Node integration disabled, context isolation enabled, and renderer sandboxing enabled. It allows navigation to that page and its anchors. Other local files and popups are blocked; credential-free HTTPS links go to the system browser. Squirrel installation events exit before normal startup.

## Checks

Install both dependency sets as described in the [README](../README.md). Run `npm run check` for unit tests, lint, formatting, and strict wrapper, Forge, and guide type checks. oxlint checks TypeScript sources and JavaScript tests with correctness rules and rejects explicit `any`; warnings fail CI. oxfmt checks code, documentation, and configuration. Run `npm run format` to format the wrapper or `npm run fix` to apply safe lint fixes and format both projects. The root tools exclude generated files and the guide submodule; the lint and formatting check commands validate the guide using its own configuration.

Run `npm run test:electron` from a graphical session. Its temporary profile keeps tests independent of personal app preferences, and its screenshot is saved to `out/test-results/electron-smoke.png`. On a headless Linux machine with Xvfb installed:

```sh
xvfb-run -a npm run test:electron
```

The native regression checks picked ingredient quantities across search rebuilds
and verifies that full-pot feedback appears above the selection without moving
it. Result counts stay visible in a separate row while an error is shown.
Native pointer targets and Shift+Enter/Ctrl or Command+Enter shortcuts remove one
or all copies without losing input focus. The guide's browser suite covers
translated errors and narrow layouts.

The smoke-test launcher uses `src/scripts/run-process.mts` to preserve the child's
exit code and report startup failures. Its 60-second deadline forcibly stops a
hung process and fails the test; profile cleanup runs even after a timeout.
Unit tests exercise the runner with real child processes.

Before changing build tooling or the submodule, also run `npm run make` and open the resulting packaged app. The Forge `postPackage` hook reads the ASAR archive to check the compiled guide entry point, its module imports, required assets, and sprite sheets. It also rejects TypeScript declarations and other development files. Unit tests exercise complete and deliberately incomplete archives. Linux AppImage builds need `mksquashfs`.

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

Use `npm run audit` to audit both dependency sets; a failure in either repository
fails the command. Both CI workflows run it before building distributables.
Use `npm outdated` at the root and repeat it with `--prefix app/foodguide` for
the guide. Upgrade guide dependencies in the guide repository.

Both repositories require Node.js 24 or newer. CI uses Node.js 24, `.nvmrc`
selects that major version for local development, and `.npmrc` enforces the
minimum version during installation. Forge 8 uses ES modules for its tooling
configuration.

The guide uses Node.js 24 declarations. The wrapper currently needs
`@types/node` 26 because Forge's `listr2` declarations import `InspectColor`,
which the Node.js 24 declarations do not export. This is a build-time type
dependency; the wrapper and build tools must continue to run on Node.js 24.
Recheck the typing requirement when upgrading Forge or `listr2`.

The `@reforged/maker-appimage` override selects Forge's 8.0.1 maker base because its published dependency range still selects Forge 7 and brings in vulnerable build dependencies. Recheck that override when upgrading either package; the AppImage build exercises its compatibility.

The root `allowScripts` entry permits the reviewed `electron-winstaller` script to select its host architecture's 7-Zip files. When upgrading that dependency with npm versions that require script approval, inspect the changed script and refresh the pinned approval.

### DMG image parser compatibility

The macOS DMG toolchain still requests the old `image-size` API:

```text
@electron-forge/maker-dmg → electron-installer-dmg → appdmg → image-size
```

[GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) concerns an infinite loop when parsing a malformed ICNS image. The targeted `appdmg` override replaces its vulnerable parser with `tools/image-size-compat`. This adapter exports the callable `imageSize` function from the pinned [community-maintained `image-size-next@1.2.2`](https://github.com/lcf2212dev/image-size-next/blob/main/SECURITY.md), preserving file paths and callbacks. The original patched 2.x API would require changes to `appdmg`.

The override's `../../tools/image-size-compat` path is relative to `node_modules/appdmg`. Keep the adapter installed as a direct development dependency so its compatibility tests also run on Windows and Linux, where `appdmg` is optional and skipped. Tests cover buffers, synchronous file reads, background callbacks, missing-file errors, and malformed ICNS input in a child process with a timeout. The macOS CI job also verifies that the installed `appdmg` resolves this adapter and builds an actual DMG.

Both full and production dependency audits are clean as of October 9, 2026. The parser and adapter are development dependencies excluded from the app archive. Recheck the fork and override when the DMG toolchain updates; remove the adapter once upstream provides a compatible patched parser.
