# Food Guide - Desktop edition
An Unofficial Food Guide for Don't Starve, running in a thin Electron wrapper as a desktop application.

Includes the [main food guide repository](https://github.com/bluehexagons/foodguide) as a git submodule.

## Automated builds

This repository includes GitHub Actions workflows for release publishing from version tags (`v*`).
CI currently builds and publishes Windows and Linux artifacts only; macOS packaging is not produced in GitHub Actions.
To publish a release from CI, push a version tag (for example `v1.2.3`) or run the release workflow manually from GitHub.

## Running from source
Clone the repository with submodules, install, and start.

```
> git clone --recurse-submodules https://github.com/bluehexagons/foodguide-app.git
> cd foodguide-app
> npm ci
> npm start
```

The desktop wrapper requires Node.js 20.19.0 or newer. The embedded Food Guide
has its own development dependencies because it is maintained as a submodule.
To run the full validation suite locally:

```
> npm ci --prefix app/foodguide
> npm run check
```

`npm test` also works after the root install and runs the Food Guide tests plus
a syntax check of the Electron entry point.

## Building a release
Electron Forge is used to build releases.

After running its make command, platform-specific installers and portable versions will be added to the `/out` directory.

**Build outputs per platform:**
- **Windows**: Squirrel installer (.exe) + Portable ZIP
- **macOS**: DMG installer (universal binary - supports both Intel x64 and Apple Silicon ARM)
- **Linux**: AppImage (universal - works on all distros including Ubuntu, Fedora, SteamOS/Arch) + Debian package (.deb)

**Linux build requirements:**
To build AppImages, you need `squashfs-tools` installed:
```bash
# Debian/Ubuntu
sudo apt-get install squashfs-tools

# Fedora
sudo dnf install squashfs-tools

# Arch
sudo pacman -S squashfs-tools
```

**Build command:**
```
> npm run make
```
