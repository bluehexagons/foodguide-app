const assert = require('node:assert/strict');
const { mkdtemp, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
  centerWindow,
  fitWindow,
  readWindowLayout,
  saveWindowLayout,
} = require('../dist/lib/window-layout.cjs');
const { checkForDesktopUpdate, isNewerDesktopVersion } = require('../dist/lib/updates.cjs');

test('saved bounds fit a smaller display with a negative coordinate', () => {
  const area = { x: -1024, y: 40, width: 1024, height: 660 };
  assert.deepEqual(fitWindow({ x: 1800, y: -20, width: 1400, height: 800 }, area), area);
  assert.deepEqual(centerWindow({ width: 700, height: 500 }, area), {
    x: -862,
    y: 120,
    width: 700,
    height: 500,
  });
});

test('window layout survives successive saves and ignores invalid preferences', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'foodguide-layout-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'profile', 'layout.json');
  assert.equal(readWindowLayout(file), undefined);
  const layout = {
    bounds: { x: -400, y: 65, width: 800, height: 530 },
    zoomFactor: 1.2,
    maximized: true,
  };
  saveWindowLayout(file, layout);
  assert.deepEqual(readWindowLayout(file), layout);
  const updated = { ...layout, zoomFactor: 1, maximized: false };
  saveWindowLayout(file, updated);
  assert.deepEqual(readWindowLayout(file), updated);
  await writeFile(
    file,
    '{"bounds":{"x":0,"y":0,"width":-7,"height":80},"zoomFactor":1,"maximized":false}',
  );
  assert.equal(readWindowLayout(file), undefined);
});

test('update checks compare the guide version and desktop build numerically', () => {
  assert(isNewerDesktopVersion('1.2.7-app.10', '1.2.7-app.9'));
  assert(isNewerDesktopVersion('1.2.7-app.0', '1.2.5'));
  assert(isNewerDesktopVersion('1.2.7', '1.2.7-app.99'));
  assert(!isNewerDesktopVersion('1.2.7-app.9', '1.2.7-app.10'));
  assert(!isNewerDesktopVersion('1.2.7-app.3', '1.2.7-app.3'));
  assert.throws(() => isNewerDesktopVersion('nightly', '1.2.7-app.3'), /Unsupported/);
});

function mockRelease(assets, extra) {
  return async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/bluehexagons/foodguide-app/releases/latest');
    assert.equal(options.credentials, 'omit');
    return Response.json({
      tag_name: 'v1.2.7-app.10',
      draft: false,
      prerelease: false,
      assets,
      ...extra,
    });
  };
}

test('release downloads use matching platform and architecture assets on GitHub', async () => {
  const fetch = mockRelease([
    { name: 'foodguide-app-1.2.7-app.10 Setup.exe', browser_download_url: 'https://example.com/' },
    { name: 'foodguide-app-win32-x64-1.2.7-app.10.zip' },
    { name: 'foodguide-app-1.2.7-app.10-x64.AppImage' },
    { name: 'foodguide-app_1.2.7-app.10_amd64.deb' },
  ]);
  const windows = await checkForDesktopUpdate('1.2.7-app.9', 'win32', 'x64', fetch);
  assert.equal(windows.version, '1.2.7-app.10');
  assert.deepEqual(
    windows.downloads.map(download => download.url.split('/').at(-1)),
    ['foodguide-app-1.2.7-app.10%20Setup.exe', 'foodguide-app-win32-x64-1.2.7-app.10.zip'],
  );
  assert(
    windows.downloads.every(download => new URL(download.url).origin === 'https://github.com'),
  );
  const linux = await checkForDesktopUpdate('1.2.7-app.9', 'linux', 'x64', fetch);
  assert.deepEqual(
    linux.downloads.map(download => download.label),
    ['Download AppImage', 'Download Debian Package'],
  );
  const otherArch = await checkForDesktopUpdate('1.2.7-app.9', 'win32', 'arm64', fetch);
  assert.deepEqual(otherArch.downloads, []);
  assert.equal(await checkForDesktopUpdate('1.2.7-app.10', 'linux', 'x64', fetch), null);
  await assert.rejects(
    checkForDesktopUpdate('1.2.7-app.9', 'linux', 'x64', mockRelease([], { draft: true })),
    /Unexpected/,
  );
});
