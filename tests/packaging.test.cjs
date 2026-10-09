const assert = require('node:assert/strict');
const { mkdir, mkdtemp, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const fixtureFiles = {
  'dist/index.cjs': '',
  'dist/lib/navigation.cjs': '',
  LICENSE: '',
  'node_modules/electron-squirrel-startup/index.js': '',
  'app/foodguide/LICENSE': '',
  'app/foodguide/html/index.htm': '',
  'app/foodguide/html/index.html': '',
  'app/foodguide/html/icon.png': '',
  'app/foodguide/html/style/main.css': '',
  'app/foodguide/html/foodguide.js': "export * from './food.js'; import './locales/index.js';",
  'app/foodguide/html/legacy-browser-warning.js': '',
  'app/foodguide/html/food.js': `import './collection.js'; import './preferences.js';
const example = "import './example-only.js'";`,
  'app/foodguide/html/collection.js': "import './food.js';", // Module cycles are valid.
  'app/foodguide/html/preferences.js': '',
  'app/foodguide/html/locales/index.js': "import './es.js';",
  'app/foodguide/html/locales/es.js': "import '../food.js';",
  'app/foodguide/html/img/sprites/sheet-0.png': '',
  'app/foodguide/html/img/sprites/sprites.json': JSON.stringify({
    cellSize: 64,
    columns: 1,
    rows: [1],
    sheets: ['img/sprites/sheet-0.png'],
    images: { 'img/carrot.png': { sheet: 0, col: 0, row: 0 } },
  }),
};

async function createArchive(t, { omit, extra, platform = 'linux' } = {}) {
  const { createPackage } = await import('@electron/asar');
  const directory = await mkdtemp(path.join(tmpdir(), 'foodguide-archive-'));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const source = path.join(directory, 'source');
  for (const [filename, contents] of Object.entries({ ...fixtureFiles, ...extra })) {
    if (filename === omit) {
      continue;
    }
    const target = path.join(source, filename);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents);
  }
  const resources =
    platform === 'darwin'
      ? path.join(directory, 'foodguide-app.app/Contents/Resources')
      : path.join(directory, 'resources');
  await mkdir(resources, { recursive: true });
  await createPackage(source, path.join(resources, 'app.asar'));
  return directory;
}

for (const platform of ['linux', 'darwin']) {
  test(`package verification accepts complete ${platform} archives`, async t => {
    const { verifyPackage } = await import('../dist/scripts/verify-package.mjs');
    verifyPackage(await createArchive(t, { platform }), platform);
  });
}

for (const filename of ['foodguide.js', 'collection.js', 'locales/es.js']) {
  test(`package verification rejects a missing compiled ${filename}`, async t => {
    const { verifyPackage } = await import('../dist/scripts/verify-package.mjs');
    const output = await createArchive(t, { omit: `app/foodguide/html/${filename}` });
    assert.throws(() => verifyPackage(output, 'linux'), /Missing packaged module/);
  });
}

test('package verification rejects missing sprite sheets', async t => {
  const { verifyPackage } = await import('../dist/scripts/verify-package.mjs');
  const output = await createArchive(t, { omit: 'app/foodguide/html/img/sprites/sheet-0.png' });
  assert.throws(() => verifyPackage(output, 'linux'), /Missing sprite sheet/);
});

for (const filename of ['food.d.ts', 'food.ts', 'food.js.map']) {
  test(`package verification rejects leaked ${filename}`, async t => {
    const { verifyPackage } = await import('../dist/scripts/verify-package.mjs');
    const output = await createArchive(t, { extra: { [`app/foodguide/html/${filename}`]: '' } });
    assert.throws(() => verifyPackage(output, 'linux'), /leaked into the packaged app/);
  });
}
