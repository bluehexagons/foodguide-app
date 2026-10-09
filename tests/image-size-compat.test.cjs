const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const sizeOf = require('@foodguide/image-size-compat');
const icon = path.join(root, 'app/foodguide/html/icon.png');

test('the patched parser remains callable for buffers and synchronous files', () => {
  assert.deepEqual(sizeOf(readFileSync(icon)), { width: 32, height: 32, type: 'png' });
  assert.deepEqual(sizeOf(icon), { width: 32, height: 32, type: 'png' });
});

test('valid ICNS images remain supported', () => {
  const png = readFileSync(icon);
  const header = Buffer.alloc(16);
  header.write('icns', 0);
  header.writeUInt32BE(header.length + png.length, 4);
  header.write('icp5', 8);
  header.writeUInt32BE(8 + png.length, 12);
  assert.deepEqual(sizeOf(Buffer.concat([header, png])), {
    width: 32,
    height: 32,
    type: 'icns',
  });
});

test(
  'the installed macOS appdmg resolves the patched adapter',
  { skip: process.platform !== 'darwin' },
  () => {
    const appdmgRequire = createRequire(require.resolve('appdmg/package.json'));
    assert.equal(appdmgRequire('image-size'), sizeOf);
  },
);

test('appdmg background parsing preserves the file callback API and errors', async () => {
  const dimensions = await new Promise((resolve, reject) => {
    sizeOf(icon, (error, size) => (error ? reject(error) : resolve(size)));
  });
  assert.deepEqual(dimensions, { width: 32, height: 32, type: 'png' });
  await assert.rejects(
    new Promise((resolve, reject) => {
      sizeOf(path.join(root, 'missing-background.png'), error =>
        error ? reject(error) : resolve(),
      );
    }),
    { code: 'ENOENT' },
  );
});

test('malformed ICNS entries fail without hanging the packaging process', () => {
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      `const assert = require('node:assert/strict');
       const sizeOf = require('@foodguide/image-size-compat');
       const malformed = Buffer.from([
         0x69, 0x63, 0x6e, 0x73, 0, 0, 0, 0x10,
         0x69, 0x73, 0x33, 0x32, 0, 0, 0, 0
       ]);
       assert.throws(() => sizeOf(malformed));`,
    ],
    { cwd: root, encoding: 'utf8', timeout: 5000 },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});
