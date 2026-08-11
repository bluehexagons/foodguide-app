const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');

// Squirrel launches the app briefly during install and uninstall. Exit early
// so those lifecycle operations do not open a user-facing window.
if (require('electron-squirrel-startup')) {
  app.quit();
}

const isExternalUrl = url => {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
};

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
    titleBarStyle: 'default',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.removeMenu();

  // Keep the local guide in the app and send its documented HTTPS links to
  // the user's default browser instead of creating remote Electron windows.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, navigationUrl) => {
    if (!navigationUrl.startsWith('file:')) {
      event.preventDefault();
      openExternalUrl(navigationUrl);
    }
  });

  win.loadFile(path.join(__dirname, 'app/foodguide/html/index.htm'));

  win.once('ready-to-show', () => {
    win.show();
  });
};

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
