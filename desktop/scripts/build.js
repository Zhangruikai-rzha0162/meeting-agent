/**
 * 编程式调用 electron-builder 构建 Windows 便携版
 * 用法：node scripts/build.js
 * 注意：electron-builder 25 的 CLI 在 Node 24 下有参数解析兼容问题，故走 API。
 * 国内网络建议设置镜像：
 *   ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
 *   ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
 */
process.env.ELECTRON_BUILDER_BINARIES_MIRROR = process.env.ELECTRON_BUILDER_BINARIES_MIRROR
  || 'https://npmmirror.com/mirrors/electron-builder-binaries/';
process.env.ELECTRON_MIRROR = process.env.ELECTRON_MIRROR
  || 'https://npmmirror.com/mirrors/electron/';

const builder = require('electron-builder');
const { Platform, Arch } = builder;

builder.build({
  targets: Platform.WINDOWS.createTarget('portable', Arch.x64),
  config: {
    appId: 'com.meetmind.desktop',
    productName: 'MeetMind',
    asar: false,
    directories: { output: 'dist' },
    files: [
      'main.js',
      'app-src/**',
      'package.json'
    ],
    win: {
      target: [{ target: 'portable', arch: ['x64'] }],
      artifactName: 'MeetMind-${version}-便携版.${ext}',
    },
    portable: {
      artifactName: 'MeetMind-${version}-便携版.${ext}',
    },
  },
}).then(result => {
  console.log('BUILD_OK', result);
}).catch(err => {
  console.error('BUILD_FAIL', err.message);
  process.exit(1);
});
