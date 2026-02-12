# Food Guide - Desktop edition
An Unofficial Food Guide for Don't Starve, running in a thin Electron wrapper as a desktop application.

Includes the [main food guide repository](https://github.com/bluehexagons/foodguide) as a git submodule.

## Releases
A portable version built using Electron Forge can be downloaded on the [releases](https://github.com/bluehexagons/foodguide-app/releases) page.

## Automated build and release

This repository includes GitHub Actions workflows for:

- **Build validation** on pushes and pull requests (`.github/workflows/build.yml`)
- **Release publishing** from version tags (`v*`) or manual dispatch (`.github/workflows/release.yml`)
- **Dependency updates** through Dependabot (`.github/dependabot.yml`) for npm and GitHub Actions

To publish a release from CI, push a version tag (for example `v1.2.3`) or run the release workflow manually from GitHub.

## Running from source
Clone the repository with submodules, install, and start.

```
> git clone --recurse-submodules https://github.com/bluehexagons/foodguide-app.git
> cd foodguide-app
> npm install
> npm start
```

## Building a release
Electron Forge is used to build releases.

After running its make command, a portable version will be added to
the `/out` directory.

```
> npm run make
```
