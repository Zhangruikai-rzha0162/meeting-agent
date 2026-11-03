/* MeetMind 桌面程序入口：内嵌后端服务 + 桌面窗口 */
const path = require('path');
const { app, BrowserWindow, dialog } = require('electron');

const DEV_URL = 'http://127.0.0.1:7100';
let win = null;

// 启动后端（server.js 内部会监听 7100 端口）
// 开发时直接引用仓库根目录的 server.js；打包时由 scripts/prepare.js 生成 app-src
const serverPath = app.isPackaged
  ? path.join(process.resourcesPath, 'app', 'app-src', 'server.js')
  : path.join(__dirname, '..', 'server.js');

try {
  require(serverPath);
} catch (e) {
  dialog.showErrorBox('MeetMind 启动失败', '后端服务加载失败：' + e.message);
  app.exit(1);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1460,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    title: 'MeetMind 会议智能体',
    autoHideMenuBar: true,
    backgroundColor: '#0b1020',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.loadURL(DEV_URL);
  win.on('closed', () => (win = null));
}

app.whenReady().then(() => {
  // 允许麦克风权限请求，保证实时转写可用
  const { session } = require('electron');
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(['media', 'audioCapture', 'videoCapture', 'speaker-selection'].includes(permission));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission) =>
    ['media', 'audioCapture', 'videoCapture', 'speaker-selection'].includes(permission));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// 单实例：重复双击只聚焦已有窗口
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}
