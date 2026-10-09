const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { isExternalUrl, isGuideUrl } = require('./lib/navigation.cjs');

const guidePath = path.join(__dirname, 'app/foodguide/html/index.htm');
const guideUrl = pathToFileURL(guidePath).href;

const openExternalUrl = url => {
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
    icon: path.join(__dirname, 'app/foodguide/html/icon.png'),
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
  const guardNavigation = (event, url) => {
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
if (require('electron-squirrel-startup')) {
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
