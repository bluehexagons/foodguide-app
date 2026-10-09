import electron = require('electron');
import path = require('node:path');
import url = require('node:url');
import navigation = require('./lib/navigation.cjs');
import installerStartup = require('electron-squirrel-startup');

const { app, BrowserWindow, shell } = electron;
const { pathToFileURL } = url;
const { isExternalUrl, isGuideUrl } = navigation;
const root = path.resolve(__dirname, '..');

const guidePath = path.join(root, 'app/foodguide/html/index.htm');
const guideUrl = pathToFileURL(guidePath).href;

const openExternalUrl = (url: string) => {
  if (isExternalUrl(url)) {
    void shell.openExternal(url).catch(() => {
      // The system browser may be unavailable in restricted environments.
    });
  }
};

const createWindow = () => {
  const win = new BrowserWindow({
    show: false,
    width: 1000,
    height: 600,
    icon: path.join(root, 'app/foodguide/html/icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.removeMenu();
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: 'deny' };
  });
  const guardNavigation = (event: Electron.Event, url: string) => {
    if (!isGuideUrl(url, guideUrl)) {
      event.preventDefault();
      openExternalUrl(url);
    }
  };
  win.webContents.on('will-navigate', guardNavigation);
  win.webContents.on('will-redirect', guardNavigation);
  win.once('ready-to-show', () => win.show());
  void win.loadFile(guidePath).catch(error => {
    console.error('Unable to load the Food Guide:', error);
    app.exit(1);
  });
};

// Installer events must skip the entire normal startup path.
if (installerStartup) {
  app.quit();
} else {
  void app
    .whenReady()
    .then(() => {
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
}
