import { parseSpriteManifest } from '../../app/foodguide/html/utils.js';
import assert from 'node:assert/strict';
import path from 'node:path';
import { extractFile, listPackage } from '@electron/asar';

export function verifyPackage(outputPath: string, platform: string) {
  const resources =
    platform === 'darwin'
      ? path.join(outputPath, 'foodguide-app.app/Contents/Resources')
      : path.join(outputPath, 'resources');
  const archive = path.join(resources, 'app.asar');
  const files = listPackage(archive, { isPack: false }).map(file => file.replaceAll('\\', '/'));
  for (const file of [
    '/dist/index.cjs',
    '/dist/lib/navigation.cjs',
    '/LICENSE',
    '/app/foodguide/LICENSE',
    '/app/foodguide/html/index.htm',
    '/app/foodguide/html/icon.png',
    '/node_modules/electron-squirrel-startup/index.js',
  ]) {
    assert(files.includes(file), `Missing packaged file: ${file}`);
  }
  assert(
    !files.some(file => /\/(?:\.git|test|tests|scripts|\.github)(?:\/|$)/.test(file)),
    'Development files leaked into the packaged app',
  );
  assert(
    !files.some(file => file.startsWith('/app/foodguide/node_modules/')),
    'The guide development dependencies must not ship',
  );
  const guideRoot = 'app/foodguide/html/';
  const manifest = parseSpriteManifest(
    JSON.parse(
      extractFile(archive, path.join(guideRoot, 'img', 'sprites', 'sprites.json')).toString('utf8'),
    ),
  );
  assert(Object.keys(manifest.images).length > 0, 'The sprite manifest is empty');
  for (const sheet of manifest.sheets) {
    assert(files.includes(`/${guideRoot}${sheet}`), `Missing sprite sheet: ${sheet}`);
  }
  console.log(`Verified packaged guide assets in ${archive}`);
}
