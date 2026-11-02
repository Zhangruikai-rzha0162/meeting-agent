const app = getApp();
const api = require('../../utils/api.js');

// 微信同声传译插件：实时语音识别
let manager = null;
try {
  manager = requirePlugin('WechatSI').getRecordRecognitionManager();
} catch (e) {
  manager = null;
}

Page({
  data: {
    transcript: '',
    recording: false,
    interim: '',
    timerText: '00:00',
    llmOk: false,
    uploading: false,
  },
  seconds: 0,
  timerId: null,
  needRestart: false,

  onShow() {
    this.checkHealth();
    this.setData({ transcript: app.globalData.transcript || '' });
  },
  onUnload() { this.stopTimer(); },

  async checkHealth() {
    try {
      const d = await api.request('/api/health');
      this.setData({ llmOk: !!(d.configured && d.keyValid) });
    } catch (e) {
      this.setData({ llmOk: false });
    }
  },

  /* ---------- 实时转写 ---------- */
  toggleRecord() {
    if (this.data.recording) this.stopRecord();
    else this.startRecord();
  },
  startRecord() {
    if (!manager) {
      wx.showToast({ title: '语音识别插件不可用', icon: 'none' });
      return;
    }
    this.needRestart = true;
    this.seconds = 0;
    this.setData({ recording: true, timerText: '00:00', interim: '' });
    this.timerId = setInterval(() => {
      this.seconds += 1;
      const m = String(Math.floor(this.seconds / 60)).padStart(2, '0');
      const s = String(this.seconds % 60).padStart(2, '0');
      this.setData({ timerText: `${m}:${s}` });
    }, 1000);

    manager.onRecognize = res => this.setData({ interim: res.result });
    manager.onStop = res => {
      if (res.result) {
        const t = this.data.transcript + (this.data.transcript ? '\n' : '') + res.result;
        this.setData({ transcript: t });
        app.globalData.transcript = t;
      }
      this.setData({ interim: '' });
      // 每段识别结束自动续期，实现连续转写
      if (this.needRestart) manager.start({ lang: 'zh_CN' });
    };
    manager.onError = res => {
      wx.showToast({ title: '转写中断：' + (res.msg || res.retcode), icon: 'none' });
      this.stopRecord();
    };
    manager.start({ lang: 'zh_CN' });
  },
  stopRecord() {
    this.needRestart = false;
    if (manager) manager.stop();
    this.stopTimer();
    this.setData({ recording: false, interim: '' });
  },
  stopTimer() { if (this.timerId) { clearInterval(this.timerId); this.timerId = null; } },

  /* ---------- 文本编辑 ---------- */
  onInput(e) {
    this.setData({ transcript: e.detail.value });
    app.globalData.transcript = e.detail.value;
  },
  copyText() {
    if (!this.data.transcript) return;
    wx.setClipboardData({ data: this.data.transcript });
  },
  clearText() {
    wx.showModal({
      title: '清空确认',
      content: '确定清空全部转写内容？',
      success: r => {
        if (r.confirm) {
          this.setData({ transcript: '' });
          app.globalData.transcript = '';
        }
      },
    });
  },

  /* ---------- 音频文件转写 ---------- */
  uploadAudio() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['mp3', 'm4a', 'wav', 'aac', 'webm', 'ogg'],
      success: async r => {
        this.setData({ uploading: true });
        try {
          const text = await api.transcribeAudio(r.tempFiles[0].path);
          const t = this.data.transcript + (this.data.transcript ? '\n' : '') + text;
          this.setData({ transcript: t });
          app.globalData.transcript = t;
          wx.showToast({ title: '音频转写完成', icon: 'success' });
        } catch (e) { /* 已提示 */ }
        this.setData({ uploading: false });
      },
    });
  },

  /* ---------- 生成 ---------- */
  validate() {
    const t = (this.data.transcript || '').trim();
    if (!t) { wx.showToast({ title: '请先转写或粘贴文本', icon: 'none' }); return null; }
    if (t.length < 20) { wx.showToast({ title: '文本至少 20 字', icon: 'none' }); return null; }
    return t;
  },
  runAll() {
    const t = this.validate();
    if (!t) return;
    wx.navigateTo({ url: '/pages/result/result?mode=all' });
  },
  runOne(e) {
    const t = this.validate();
    if (!t) return;
    wx.navigateTo({ url: `/pages/result/result?mode=${e.currentTarget.dataset.mode}` });
  },
  goConfig() {
    wx.navigateTo({ url: '/pages/config/config' });
  },
});
