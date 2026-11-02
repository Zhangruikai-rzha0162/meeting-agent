/**
 * 打包前准备：把仓库根目录的后端与前端同步到 desktop/app-src
 * 用法：node scripts/prepare.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DEST = path.join(__dirname, '..', 'app-src');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });
fs.copyFileSync(path.join(ROOT, 'server.js'), path.join(DEST, 'server.js'));
copyDir(path.join(ROOT, 'agents'), path.join(DEST, 'agents'));
copyDir(path.join(ROOT, 'public'), path.join(DEST, 'public'));
console.log('PREPARE_OK app-src 已同步');
