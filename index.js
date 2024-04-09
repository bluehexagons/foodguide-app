const { app, BrowserWindow } = require('electron');

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1000,
    height: 600,
  });

  win.loadFile('app/foodguide/html/index.htm');
};

app.whenReady().then(() => {
  createWindow();
});
