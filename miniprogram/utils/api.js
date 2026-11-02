const app = getApp();

function base() {
  return (app.globalData.backend || '').replace(/\/+$/, '');
}

/** 统一请求封装：自动带后端地址与错误提示 */
function request(path, { method = 'GET', data, header, responseType } = {}) {
  return new Promise((resolve, reject) => {
    if (!base()) {
      wx.showToast({ title: '请先设置后端地址', icon: 'none' });
      return reject(new Error('未设置后端地址'));
    }
    wx.request({
      url: base() + path,
      method,
      data,
      header: { 'Content-Type': 'application/json', ...(header || {}) },
      responseType,
      success: res => {
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(res.data);
        const msg = (res.data && res.data.error) || `请求失败 (${res.statusCode})`;
        wx.showToast({ title: msg.slice(0, 40), icon: 'none' });
        reject(new Error(msg));
      },
      fail: err => {
        wx.showToast({ title: '无法连接后端服务', icon: 'none' });
        reject(err);
      },
    });
  });
}

/** 拉取二进制（如总结图 PNG），返回 base64 data URL */
function requestBinary(path, data) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: base() + path,
      method: 'POST',
      data,
      header: { 'Content-Type': 'application/json' },
      responseType: 'arraybuffer',
      success: res => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const b64 = wx.arrayBufferToBase64(res.data);
          return resolve('data:image/png;base64,' + b64);
        }
        let msg = `请求失败 (${res.statusCode})`;
        try { msg = JSON.parse(String.fromCharCode.apply(null, new Uint8Array(res.data))).error || msg; } catch (e) {}
        wx.showToast({ title: String(msg).slice(0, 40), icon: 'none' });
        reject(new Error(msg));
      },
      fail: reject,
    });
  });
}

/** 上传音频文件转写：读取文件二进制后以 audio/* 流发送（与后端 raw 接口对齐） */
function transcribeAudio(filePath) {
  return new Promise((resolve, reject) => {
    const ext = (filePath.split('.').pop() || 'mp3').toLowerCase();
    wx.getFileSystemManager().readFile({
      filePath,
      success: r => {
        wx.request({
          url: base() + '/api/transcribe',
          method: 'POST',
          data: r.data,
          header: { 'Content-Type': 'audio/' + (ext === 'm4a' ? 'mp4' : ext), 'x-audio-ext': ext },
          success: res => {
            if (res.statusCode >= 200 && res.statusCode < 300 && res.data && res.data.text) {
              return resolve(res.data.text);
            }
            const msg = (res.data && res.data.error) || `转写失败 (${res.statusCode})`;
            wx.showToast({ title: String(msg).slice(0, 40), icon: 'none' });
            reject(new Error(msg));
          },
          fail: reject,
        });
      },
      fail: reject,
    });
  });
}

module.exports = { request, requestBinary, transcribeAudio, base };
