import electron = require('electron');
import path = require('node:path');
import url = require('node:url');
import fs = require('node:fs');
import navigation = require('./lib/navigation.cjs');
import windowState = require('./lib/window-layout.cjs');
import updates = require('./lib/updates.cjs');
import installerStartup = require('electron-squirrel-startup');

const { app, BrowserWindow, Menu, shell, clipboard, dialog, net, screen } = electron;
const { pathToFileURL } = url;
const { bundledGuideLink, companionGuideLink, isExternalUrl, isGuideUrl, shareGuideUrl } =
  navigation;
const { centerWindow, defaultSize, fitWindow, readWindowLayout, saveWindowLayout } = windowState;
const root = path.resolve(__dirname, '..');

const guidePath = path.join(root, 'app/foodguide/html/index.html');
const guideUrl = pathToFileURL(guidePath).href;
const buildInfo = JSON.parse(fs.readFileSync(path.join(__dirname, 'build-info.json'), 'utf8')) as {
  commit: string;
};
const desktopVersion = `Desktop ${app.getVersion()} (${buildInfo.commit})`;
const companionSize = { width: 420, height: 640 };
const companionStyle = `
  .tab-navigation .game-link,
  #simulator > .instructions > span { display: none; }
  #simulator .selectionpanel { margin: 4px 0 10px; padding: 8px; }
  #simulator .ingredientdropdown { max-height: clamp(110px, 28vh, 220px); }
`;
let layoutFile: string;
let layout: windowState.WindowLayout | undefined;
let lastGuideWindow: Electron.BrowserWindow | undefined;
let companionWindow: Electron.BrowserWindow | undefined;
let openingCompanion = false;
let checkingForUpdates = false;
let quitting = false;

const openExternalUrl = (url: string) => {
  if (isExternalUrl(url)) {
    void shell.openExternal(url).catch(() => {
      // The system browser may be unavailable in restricted environments.
    });
  }
};

const focusWindow = (win: Electron.BrowserWindow) => {
  if (win.isMinimized()) {
    win.restore();
  }
  win.focus();
};

const rememberLayout = (win: Electron.BrowserWindow) => {
  layout = {
    bounds: win.getNormalBounds(),
    maximized: win.isMaximized(),
    zoomFactor: win.webContents.getZoomFactor(),
  };
  saveWindowLayout(layoutFile, layout);
};

const createWindow = (initialUrl = guideUrl, companion = false) => {
  const firstGuideWindow = !BrowserWindow.getAllWindows().some(win => win !== companionWindow);
  const saved = !companion && firstGuideWindow ? layout : undefined;
  const area = saved
    ? screen.getDisplayMatching(saved.bounds).workArea
    : screen.getPrimaryDisplay().workArea;
  const size = companion ? companionSize : (layout?.bounds ?? defaultSize);
  const bounds = saved
    ? fitWindow(saved.bounds, area)
    : {
        width: Math.min(size.width, area.width),
        height: Math.min(size.height, area.height),
      };
  const win = new BrowserWindow({
    show: false,
    ...bounds,
    ...(companion
      ? { alwaysOnTop: true, autoHideMenuBar: true, title: 'Food Guide Companion' }
      : {}),
    icon: path.join(root, 'app/foodguide/html/icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      ...(saved ? { zoomFactor: saved.zoomFactor } : {}),
    },
  });

  if (companion) {
    companionWindow = win;
    win.on('page-title-updated', event => event.preventDefault());
    win.on('closed', () => {
      companionWindow = undefined;
    });
  } else {
    win.on('focus', () => {
      lastGuideWindow = win;
    });
    win.on('close', () => {
      if (!quitting && win.isVisible()) {
        rememberLayout(win);
      }
    });
  }

  win.webContents.on('did-finish-load', () => {
    if (companion) {
      void Promise.all([
        win.webContents.insertCSS(companionStyle),
        win.webContents.executeJavaScript(`(() => {
          const pot = document.querySelector('#simulator .selectionpanel');
          const search = document.querySelector('#simulator .ingredient-search-row');
          if (pot && search) search.before(pot);
          const saveDish = document.querySelector('#cookbook-save');
          const cookbook = document.querySelector('#personal-cookbook');
          const results = document.querySelector('#results');
          if (saveDish && cookbook && results) {
            const panel = document.createElement('div');
            panel.className = 'selectionpanel';
            panel.append(saveDish, cookbook);
            results.after(panel);
          }
        })()`),
      ]).catch(error => {
        if (!win.isDestroyed()) {
          console.error('Unable to apply the companion layout:', error);
        }
      });
    }
    void win.webContents
      .executeJavaScript(
        `(() => { const element = document.createElement('p'); element.className = 'info-footnote'; element.id = 'desktop-build-version'; element.textContent = ${JSON.stringify(desktopVersion)}; document.getElementById('build-version')?.after(element); })()`,
      )
      .catch(error => {
        if (!win.isDestroyed()) {
          console.error('Unable to display the desktop version:', error);
        }
      });
    void win.webContents.setVisualZoomLevelLimits(1, 5).catch(error => {
      console.error('Unable to enable pinch zoom:', error);
    });
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isGuideUrl(url, guideUrl)) {
      createWindow(url);
    } else {
      openExternalUrl(url);
    }
    return { action: 'deny' };
  });
  const guardNavigation = (event: Electron.Event<{ url: string }>) => {
    const { url } = event;
    if (!isGuideUrl(url, guideUrl)) {
      event.preventDefault();
      openExternalUrl(url);
    }
  };
  win.webContents.on('will-navigate', guardNavigation);
  win.webContents.on('will-redirect', guardNavigation);
  win.once('ready-to-show', () => {
    if (saved?.maximized) {
      win.maximize();
    }
    win.show();
  });
  void win.loadURL(initialUrl).catch(error => {
    if (win.isDestroyed()) {
      return;
    }
    console.error('Unable to load the Food Guide:', error);
    if (BrowserWindow.getAllWindows().length === 1) {
      app.exit(1);
    } else {
      win.destroy();
    }
  });
};

const showMessage = (win: Electron.BaseWindow | undefined, options: Electron.MessageBoxOptions) =>
  win && !win.isDestroyed() ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);

const openClipboardLink = async (win: Electron.BaseWindow | undefined) => {
  const text = await clipboard.readText().catch(() => '');
  const link = bundledGuideLink(text, guideUrl);
  if (quitting) {
    return;
  }
  if (link) {
    createWindow(link);
  } else {
    await showMessage(win, {
      type: 'info',
      message: 'No Food Guide link on the clipboard',
      detail: 'Copy a link from the Food Guide’s Share menu and try again.',
    });
  }
};

const openCompanion = async (source: Electron.BaseWindow | undefined) => {
  if (companionWindow) {
    focusWindow(companionWindow);
    return;
  }
  if (openingCompanion) {
    return;
  }
  openingCompanion = true;
  try {
    let snapshot: Parameters<typeof companionGuideLink>[1];
    if (source instanceof BrowserWindow && isGuideUrl(source.webContents.getURL(), guideUrl)) {
      snapshot = await source.webContents
        .executeJavaScript(`(() => ({
        simulator: document.querySelector('#tab-simulator')?.href,
        ingredients: Array.from(document.querySelectorAll('#ingredients > button'), slot => slot.dataset.id ?? '')
      }))()`)
        .catch(() => undefined);
    }
    if (!quitting) {
      createWindow(companionGuideLink(guideUrl, snapshot), true);
    }
  } finally {
    openingCompanion = false;
  }
};

const checkForUpdates = async (win: Electron.BaseWindow | undefined) => {
  if (checkingForUpdates) {
    return;
  }
  checkingForUpdates = true;
  try {
    const result = await updates.checkForDesktopUpdate(
      app.getVersion(),
      process.platform,
      process.arch,
      net.fetch,
    );
    if (!result) {
      await showMessage(win, {
        type: 'info',
        message: 'Food Guide is up to date',
        detail: `Installed version ${app.getVersion()}.`,
      });
      return;
    }
    const actions = [...result.downloads, { label: 'Release Notes', url: result.notesUrl }];
    const { response } = await showMessage(win, {
      type: 'info',
      message: `Food Guide ${result.version} is available`,
      detail: result.downloads.length
        ? `Installed version ${app.getVersion()}.`
        : 'See the release notes for supported downloads.',
      buttons: [...actions.map(action => action.label), 'Later'],
      cancelId: actions.length,
    });
    const action = actions[response];
    if (action) {
      openExternalUrl(action.url);
    }
  } catch {
    await showMessage(win, {
      type: 'warning',
      message: 'Couldn’t check for updates',
      detail: 'Check your internet connection and try again.',
    });
  } finally {
    checkingForUpdates = false;
  }
};

// Installer events must skip the entire normal startup path.
if (installerStartup) {
  app.quit();
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (win) {
      focusWindow(win);
    } else if (app.isReady()) {
      // macOS keeps the app running after its last window closes.
      createWindow();
    }
  });
  void app
    .whenReady()
    .then(() => {
      layoutFile = path.join(app.getPath('userData'), 'window-layout.json');
      layout = readWindowLayout(layoutFile);
      if (process.platform === 'win32') {
        app.setAppUserModelId('com.squirrel.foodguide_app.foodguide-app');
      }
      const template: Electron.MenuItemConstructorOptions[] = [
        {
          role: 'fileMenu',
          submenu: [
            {
              id: 'new-window',
              label: 'New Window',
              accelerator: 'CmdOrCtrl+N',
              click: () => createWindow(),
            },
            {
              id: 'open-guide-link',
              label: 'Open Food Guide Link from Clipboard',
              accelerator: 'CmdOrCtrl+O',
              click: (_item, focusedWindow) => {
                void openClipboardLink(focusedWindow).catch(error =>
                  console.error('Unable to open the clipboard link:', error),
                );
              },
            },
            {
              id: 'copy-guide-link',
              label: 'Copy Link to Current Section',
              accelerator: 'CmdOrCtrl+Shift+C',
              click: (_item, focusedWindow) => {
                if (!(focusedWindow instanceof BrowserWindow)) {
                  return;
                }
                const link = shareGuideUrl(focusedWindow.webContents.getURL(), guideUrl);
                if (link) {
                  void clipboard
                    .writeText(link)
                    .catch(error => console.error('Unable to copy the guide link:', error));
                }
              },
            },
            { type: 'separator' },
            { id: 'close-window', role: 'close' },
            ...(process.platform === 'darwin' ? [] : [{ role: 'quit' as const }]),
          ],
        },
        { role: 'editMenu' },
        {
          role: 'viewMenu',
          submenu: [
            { id: 'reload-guide', role: 'reload' },
            { type: 'separator' },
            { id: 'reset-zoom', role: 'resetZoom' },
            { id: 'zoom-in', role: 'zoomIn' },
            { id: 'zoom-out', role: 'zoomOut' },
            { type: 'separator' },
            {
              id: 'reset-window-layout',
              label: 'Reset Window Layout',
              click: (_item, win) => {
                if (!(win instanceof BrowserWindow)) {
                  return;
                }
                const area = screen.getDisplayMatching(win.getBounds()).workArea;
                const isCompanion = win === companionWindow;
                const bounds = centerWindow(isCompanion ? companionSize : defaultSize, area);
                const applyDefaults = () => {
                  win.setBounds(bounds);
                  win.webContents.setZoomFactor(1);
                  if (!isCompanion) {
                    rememberLayout(win);
                  }
                };
                if (win.isMaximized()) {
                  win.once('unmaximize', applyDefaults);
                  win.unmaximize();
                } else {
                  applyDefaults();
                }
              },
            },
            {
              id: 'companion-window',
              label: 'Open Companion Window',
              click: (_item, win) => {
                void openCompanion(win).catch(error =>
                  console.error('Unable to open the companion:', error),
                );
              },
            },
          ],
        },
        { role: 'windowMenu' },
        {
          role: 'help',
          submenu: [
            {
              id: 'check-for-updates',
              label: 'Check for Updates…',
              click: (_item, win) => {
                void checkForUpdates(win).catch(error =>
                  console.error('Unable to show update status:', error),
                );
              },
            },
          ],
        },
      ];
      if (process.platform === 'darwin') {
        template.unshift({ role: 'appMenu' });
      }
      Menu.setApplicationMenu(Menu.buildFromTemplate(template));
      createWindow();
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createWindow();
        }
      });
    })
    .catch(error => {
      console.error('Unable to start the Food Guide:', error);
      app.exit(1);
    });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
  app.on('before-quit', () => {
    quitting = true;
    const win = lastGuideWindow;
    if (win && !win.isDestroyed()) {
      rememberLayout(win);
    }
  });
}
