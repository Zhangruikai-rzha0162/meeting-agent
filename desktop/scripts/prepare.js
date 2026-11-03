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

/* 本地转写推理库（约 22MB，不入 git）：缺失时自动从 jsdelivr 下载 */
const VENDOR_DIR = path.join(DEST, 'public', 'vendor');
const VENDOR_FILES = {
  'transformers.min.js': 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/dist/transformers.web.min.js',
  'ort-wasm-simd-threaded.jsep.mjs': 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/dist/ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm': 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/dist/ort-wasm-simd-threaded.jsep.wasm',
};

async function ensureVendor() {
  fs.mkdirSync(VENDOR_DIR, { recursive: true });
  for (const [name, url] of Object.entries(VENDOR_FILES)) {
    const target = path.join(VENDOR_DIR, name);
    if (fs.existsSync(target) && fs.statSync(target).size > 0) continue;
    console.log('下载推理库文件:', name);
    const r = await fetch(url);
    if (!r.ok) throw new Error(`下载失败 ${r.status}: ${url}`);
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(target, buf);
  }
}

ensureVendor()
  .then(() => console.log('PREPARE_OK app-src 已同步'))
  .catch(e => { console.error('PREPARE_FAIL:', e.message); process.exit(1); });
