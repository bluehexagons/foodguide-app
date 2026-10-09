import path from 'node:path';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { generateAssets } from './scripts/generate-assets.mjs';
import { verifyPackage } from './scripts/verify-package.mjs';
import packaging from './lib/packaging.cjs';

const icon = path.join(import.meta.dirname, 'app/foodguide/html/icon.png');

export default {
  packagerConfig: {
    asar: true,
    icon: path.join(import.meta.dirname, '.generated/icon'),
    ignore: packaging.ignoreFile,
  },
  rebuildConfig: {},
  hooks: {
    generateAssets,
    postPackage: async (_config, { outputPaths, platform }) => {
      for (const outputPath of outputPaths) {
        verifyPackage(outputPath, platform);
      }
    },
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: { setupIcon: path.join(import.meta.dirname, '.generated/icon.ico') },
    },
    { name: '@electron-forge/maker-zip', platforms: ['win32'], config: {} },
    {
      name: '@electron-forge/maker-dmg',
      config: { format: 'ULFO', icon: path.join(import.meta.dirname, '.generated/icon.icns') },
    },
    {
      name: '@reforged/maker-appimage',
      config: { options: { icon, categories: ['Game'] } },
    },
    { name: '@electron-forge/maker-deb', config: { options: { icon, categories: ['Game'] } } },
  ],
  plugins: [
    { name: '@electron-forge/plugin-auto-unpack-natives', config: {} },
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
