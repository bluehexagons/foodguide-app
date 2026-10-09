import { parseSpriteManifest } from '../../app/foodguide/html/utils.js';
import assert from 'node:assert/strict';
import path from 'node:path';
import { extractFile, listPackage } from '@electron/asar';
import { parse } from 'es-module-lexer/js';

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
    '/app/foodguide/html/index.html',
    '/app/foodguide/html/style/main.css',
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
  assert(
    !files.some(
      file =>
        /\.(?:[cm]?tsx?|map)$/.test(file) ||
        file.startsWith('/src/') ||
        file.startsWith('/forge.config.'),
    ),
    'TypeScript sources, declarations, or build configuration leaked into the packaged app',
  );

  // Check the compiled browser modules inside the archive, including nested imports
  // and re-exports. Reading the checkout would miss files excluded during packaging.
  const packagedFiles = new Set(files);
  const visited = new Set<string>();
  const verifyModule = (filename: string) => {
    assert(packagedFiles.has(filename), `Missing packaged module: ${filename}`);
    if (visited.has(filename)) {
      return;
    }
    visited.add(filename);
    const source = extractFile(archive, path.normalize(filename.slice(1))).toString('utf8');
    for (const { specifier } of parse(source, filename)[0]) {
      if (specifier?.startsWith('.')) {
        verifyModule(path.posix.join(path.posix.dirname(filename), specifier));
      }
    }
  };
  verifyModule('/app/foodguide/html/foodguide.js');
  verifyModule('/app/foodguide/html/legacy-browser-warning.js');

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
