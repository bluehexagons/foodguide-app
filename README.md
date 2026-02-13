# Food Guide - Desktop edition
An Unofficial Food Guide for Don't Starve, running in a thin Electron wrapper as a desktop application.

Includes the [main food guide repository](https://github.com/bluehexagons/foodguide) as a git submodule.

## Automated builds

This repository includes GitHub Actions workflows for release publishing from version tags (`v*`).
To publish a release from CI, push a version tag (for example `v1.2.3`) or run the release workflow manually from GitHub.

## Running from source
Clone the repository with submodules, install, and start.

```
> git clone --recurse-submodules https://github.com/bluehexagons/foodguide-app.git
> cd foodguide-app
> npm ci
> npm start
```

## Building a release
Electron Forge is used to build releases.

After running its make command, a portable version will be added to
the `/out` directory.

```
> npm run make
```
