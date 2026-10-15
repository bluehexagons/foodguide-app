const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');
const { isExternalUrl, isGuideUrl, shareGuideUrl } = require('../dist/lib/navigation.cjs');
const { ignoreFile } = require('../dist/lib/packaging.cjs');

const root = path.resolve(__dirname, '..');
const entryUrl = pathToFileURL(path.join(root, 'app/foodguide/html/index.html')).href;

async function startWrapper({
  installer = false,
  platform = 'linux',
  loadError = null,
  singleInstance = true,
} = {}) {
  const calls = { windows: [], external: [], clipboard: [], quit: 0, ready: 0, exit: [] };
  const app = Object.assign(new EventEmitter(), {
    quit: () => calls.quit++,
    exit: code => calls.exit.push(code),
    requestSingleInstanceLock: () => singleInstance,
    isReady: () => true,
    whenReady: () => {
      calls.ready++;
      return Promise.resolve();
    },
  });
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = handler => {
        this.openHandler = handler;
      };
      this.zoomLimits = [];
      this.webContents.setVisualZoomLevelLimits = (min, max) => {
        this.zoomLimits.push([min, max]);
        return Promise.resolve();
      };
      calls.windows.push(this);
    }
    static getAllWindows() {
      return calls.windows;
    }
    static getFocusedWindow() {
      return calls.windows.find(win => win.focused);
    }
    isMinimized() {
      return this.minimized === true;
    }
    restore() {
      this.minimized = false;
      this.restored = true;
    }
    focus() {
      this.focused = true;
    }
    show() {
      this.visible = true;
    }
    loadFile(file, options) {
      this.file = file;
      this.loadOptions = options;
      return loadError ? Promise.reject(loadError) : Promise.resolve();
    }
  }
  const electron = {
    app,
    BrowserWindow,
    Menu: {
      buildFromTemplate: template => template,
      setApplicationMenu: menu => {
        calls.menu = menu;
      },
    },
    clipboard: { writeText: text => calls.clipboard.push(text) },
    shell: {
      openExternal: url => {
        calls.external.push(url);
        return Promise.resolve();
      },
    },
  };
  vm.runInNewContext(readFileSync(path.join(root, 'dist/index.cjs'), 'utf8'), {
    require: name =>
      name === 'electron'
        ? electron
        : name === 'electron-squirrel-startup'
          ? installer
          : name.startsWith('./')
            ? require(path.join(root, 'dist', name))
            : require(name),
    __dirname: path.join(root, 'dist'),
    exports: {},
    process: { platform },
    console: { error: () => {} },
  });
  await new Promise(resolve => setImmediate(resolve));
  return { app, calls };
}

test('installer events quit without scheduling startup or creating windows', async () => {
  const { app, calls } = await startWrapper({ installer: true });
  assert.equal(calls.quit, 1);
  assert.equal(calls.ready, 0);
  assert.equal(calls.windows.length, 0);
  assert.equal(app.eventNames().length, 0);
  assert.equal(calls.menu, undefined);
});

test('a second launch quits without starting another app process or window', async () => {
  const { calls } = await startWrapper({ singleInstance: false });
  assert.equal(calls.quit, 1);
  assert.equal(calls.ready, 0);
  assert.equal(calls.windows.length, 0);
});

test('launching again restores and focuses the existing window', async () => {
  const { app, calls } = await startWrapper();
  const win = calls.windows[0];
  win.minimized = true;
  app.emit('second-instance');
  assert.equal(calls.windows.length, 1);
  assert.equal(win.restored, true);
  assert.equal(win.focused, true);
});

test('launching again reopens a window when the macOS app is still running without one', async () => {
  const { app, calls } = await startWrapper({ platform: 'darwin' });
  calls.windows.length = 0;
  app.emit('window-all-closed');
  assert.equal(calls.quit, 0);
  app.emit('second-instance');
  assert.equal(calls.windows.length, 1);
  assert.equal(calls.windows[0].file, path.join(root, 'app/foodguide/html/index.html'));
  app.emit('second-instance');
  assert.equal(calls.windows.length, 1);
  assert.equal(calls.windows[0].focused, true);
});

test('the guide opens in a sandbox with native zoom controls and pinch zoom after each load', async () => {
  const { calls } = await startWrapper();
  const win = calls.windows[0];
  assert.equal(calls.windows.length, 1);
  assert.equal(win.options.webPreferences.contextIsolation, true);
  assert.equal(win.options.webPreferences.sandbox, true);
  assert.equal(win.options.webPreferences.nodeIntegration, false);
  assert.equal(win.options.icon, path.join(root, 'app/foodguide/html/icon.png'));
  const zoomMenu = calls.menu.find(item => item.role === 'viewMenu');
  assert.deepEqual(
    Array.from(zoomMenu.submenu, item => item.role),
    ['resetZoom', 'zoomIn', 'zoomOut'],
  );
  assert.deepEqual(win.zoomLimits, []);
  win.webContents.emit('did-finish-load');
  win.webContents.emit('did-finish-load');
  assert.deepEqual(win.zoomLimits, [
    [1, 5],
    [1, 5],
  ]);
  assert.equal(win.visible, undefined);
  win.emit('ready-to-show');
  assert.equal(win.visible, true);
});

test('only the guide entry and its anchors are allowed as local destinations', () => {
  assert(isGuideUrl(entryUrl, entryUrl));
  assert(isGuideUrl(`${entryUrl}#recipes`, entryUrl));
  for (const url of [
    'file:///etc/passwd',
    `${entryUrl}?unexpected=1`,
    'https://example.com',
    'bad url',
  ]) {
    assert.equal(isGuideUrl(url, entryUrl), false, url);
  }
});

test('navigation and popups cannot load unrelated files or remote content', async () => {
  const { calls } = await startWrapper();
  const win = calls.windows[0];
  for (const eventName of ['will-navigate', 'will-redirect']) {
    for (const url of ['file:///etc/passwd', 'https://example.com/', 'javascript:alert(1)']) {
      let prevented = false;
      win.webContents.emit(
        eventName,
        {
          preventDefault: () => {
            prevented = true;
          },
        },
        url,
      );
      assert(prevented);
    }
    win.webContents.emit(
      eventName,
      { preventDefault: () => assert.fail('Guide link blocked') },
      entryUrl,
    );
  }
  assert.equal(win.openHandler({ url: 'https://example.com/' }).action, 'deny');
  assert.equal(win.openHandler({ url: 'file:///etc/passwd' }).action, 'deny');
  assert.deepEqual(calls.external, Array(3).fill('https://example.com/'));
});

test('only credential-free HTTPS URLs can open in the system browser', () => {
  assert(isExternalUrl('https://example.com/path#anchor'));
  for (const url of [
    'http://example.com',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'https://user:password@example.com',
    'https://user@example.com',
    'not a URL',
  ]) {
    assert.equal(isExternalUrl(url), false, url);
  }
});

test('macOS activation recreates a closed window and closing follows platform conventions', async () => {
  for (const platform of ['linux', 'win32', 'darwin']) {
    const { app, calls } = await startWrapper({ platform });
    assert.equal(
      calls.menu.some(item => item.role === 'appMenu'),
      platform === 'darwin',
    );
    app.emit('activate');
    assert.equal(calls.windows.length, 1);
    calls.windows.length = 0;
    app.emit('activate');
    assert.equal(calls.windows.length, 1);
    app.emit('window-all-closed');
    assert.equal(calls.quit, platform === 'darwin' ? 0 : 1);
  }
});

test('a missing guide exits with a failure instead of leaving an empty window', async () => {
  const { calls } = await startWrapper({ loadError: new Error('missing guide') });
  assert.deepEqual(calls.exit, [1]);
});

test('packaging keeps runtime files and excludes guide development dependencies', () => {
  for (const file of [
    '',
    '/',
    '/dist',
    '/dist/lib',
    '/app',
    '/app/foodguide',
    '/dist/index.cjs',
    '/package.json',
    '/LICENSE',
    '/dist/lib/navigation.cjs',
    '/node_modules/debug/src/index.js',
    '/app/foodguide/LICENSE',
    '/app/foodguide/html/img/sprites/sprites.json',
    '/app/foodguide/html/locales/es.js',
  ]) {
    assert.equal(ignoreFile(file), false, file);
    assert.equal(ignoreFile(file.replaceAll('/', '\\')), false, file);
  }
  for (const file of [
    '/app/foodguide/node_modules/sharp/index.js',
    '/app/foodguide/.git',
    '/app/foodguide/tests/functions.test.js',
    '/app/foodguide/scripts/generate-sprites.js',
    '/node_modules/electron-squirrel-startup/test/index.test.js',
    '/forge.config.mts',
    '/dist/scripts/generate-assets.mjs',
    '/dist/lib/packaging.cjs',
    '/dist/index.d.cts',
    '/app/foodguide/html/models.d.ts',
    '/app/foodguide/html/food.ts',
    '/app/foodguide/html/food.js.map',
    '/src/index.cts',
    '/tests/wrapper.test.cjs',
    '/.github/workflows/build.yml',
    '/README.md',
  ]) {
    assert.equal(ignoreFile(file), true, file);
    assert.equal(ignoreFile(file.replaceAll('/', '\\')), true, file);
  }
});

test('guide links and the New Window menu create independent sandboxed guide windows', async () => {
  const { calls } = await startWrapper();
  const source = calls.windows[0];
  const destination = `${entryUrl}#discovery?game=together&inventory=carrot%40together`;
  assert.equal(source.openHandler({ url: destination }).action, 'deny');
  assert.equal(calls.windows.length, 2);
  const linked = calls.windows[1];
  assert.equal(linked.file, source.file);
  assert.equal(linked.loadOptions.hash, new URL(destination).hash.slice(1));
  assert.equal(linked.options.webPreferences.sandbox, true);
  assert.equal(linked.options.webPreferences.nodeIntegration, false);
  const newWindow = calls.menu
    .find(item => item.role === 'fileMenu')
    .submenu.find(item => item.id === 'new-window');
  assert.equal(newWindow.accelerator, 'CmdOrCtrl+N');
  newWindow.click();
  assert.equal(calls.windows.length, 3);
  assert.equal(calls.windows[2].loadOptions.hash, '');
  assert.deepEqual(calls.external, []);
});

test('Copy Link shares the current section through the web guide and never exposes local files', async () => {
  const { calls } = await startWrapper();
  const copy = calls.menu
    .find(item => item.role === 'fileMenu')
    .submenu.find(item => item.id === 'copy-guide-link');
  const hash = '#simulator?game=together&ingredients=meat%40together';
  const webUrl = `https://foodguide.bluehexagons.com/${hash}`;
  assert.equal(shareGuideUrl(`${entryUrl}${hash}`, entryUrl), webUrl);
  assert.equal(shareGuideUrl('file:///etc/passwd#about', entryUrl), null);
  assert.equal(shareGuideUrl(`${entryUrl}?unexpected=1`, entryUrl), null);
  calls.windows[0].webContents.getURL = () => `${entryUrl}${hash}`;
  copy.click(undefined, calls.windows[0]);
  assert.deepEqual(calls.clipboard, [webUrl]);
  assert.doesNotThrow(() => copy.click(undefined, undefined));
  calls.windows[0].webContents.getURL = () => 'file:///etc/passwd';
  copy.click(undefined, calls.windows[0]);
  assert.deepEqual(calls.clipboard, [webUrl]);
});
