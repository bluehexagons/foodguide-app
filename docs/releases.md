# Releases

The Build workflow runs checks, dependency audits, native Electron smoke tests, and Forge builds on Windows, Linux, and macOS. It runs for `main`, `feature/typescript-migration`, pull requests, and manual dispatches, and uploads artifacts for three days.

The Release workflow builds Windows and Linux for version tags and publishes a GitHub release with generated notes and `SHA256SUMS.txt`. macOS DMGs are available as Build workflow artifacts and through local builds on a Mac. They are not published by the Release workflow.

## Publish a version

1. Update `package.json` and `package-lock.json` together, for example with `npm version 1.2.6 --no-git-tag-version`.
2. Synchronize the guide submodule, install both dependency sets, and run `npm run check`, `npm run test:electron`, and `npm run make`.
3. Open the packaged app and check the guide, icons, recipe entry, and saved preferences.
4. Commit and push the tested release commit to `main`, then verify the Build workflow succeeds.
5. Create an annotated tag matching the package version and push it:

```sh
git tag -a v1.2.6 -m "Food Guide desktop 1.2.6"
git push origin v1.2.6
```

Use the intended version in those commands. The workflow verifies that the tag is exactly `v` followed by the checked-out package version. A tag such as `v1.2.6` must point to the commit containing version `1.2.6`.

For a manual release run, supply an existing version tag. The workflow checks out `refs/tags/<tag>`, not a branch with the same name. Publishing waits for both platform builds and has write permission only in the publishing job.

## Artifacts

Windows releases contain the Squirrel setup executable and updater files, plus a portable ZIP. Linux releases contain an AppImage and a Debian package. These are architecture-specific builds; the current CI runners produce x64 artifacts.

The publishing job collects artifacts into one directory and rejects duplicate filenames. The checksum file records the filenames used by GitHub release attachments. Download the release files and `SHA256SUMS.txt` into the same directory, keep their original names, and run `sha256sum --check SHA256SUMS.txt` there.

GitHub's automatic source ZIP and tarball do not contain the guide submodule. Use the recursive clone instructions in the [README](../README.md) to build from source.

AppImages need a compatible Linux userspace. If FUSE is unavailable, the AppImage runtime supports `--appimage-extract-and-run` to run from a temporary extraction. Debian packages declare their required system libraries.

The current workflow does not configure code-signing certificates or macOS notarization.
