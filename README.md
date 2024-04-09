# Food Guide - Desktop edition
An Unofficial Food Guide for Don't Starve, running in Electron as a desktop application.

## Releases
A portable version built using Electron Forge can be downloaded on the [releases](https://github.com/bluehexagons/foodguide-app/releases) page.

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
