const { app, BrowserWindow } = require('electron');
const path = require('node:path')

const createWindow = () => {
  const win = new BrowserWindow({
    show: false,
    width: 1000,
    height: 600,
    titleBarStyle: 'default',
  });

  win.removeMenu();
  
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

app.on('web-contents-created', (event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    console.log(navigationUrl)
      // event.preventDefault()
  })
})
console.log('test')