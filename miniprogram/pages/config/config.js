const app = getApp();
const api = require('../../utils/api.js');

Page({
  data: {
    backend: '',
    tested: false,
    llmOk: false,
    testResult: '',
    model: '',
    llmConfigured: false,
  },
  onLoad() {
    this.setData({ backend: app.globalData.backend || '' });
  },
  onInput(e) { this.setData({ backend: e.detail.value }); },
  save() {
    const url = (this.data.backend || '').trim().replace(/\/+$/, '');
    if (!url) { wx.showToast({ title: '请输入后端地址', icon: 'none' }); return; }
    app.globalData.backend = url;
    wx.setStorageSync('backend', url);
    wx.showToast({ title: '已保存', icon: 'success' });
  },
  async test() {
    this.save();
    try {
      const d = await api.request('/api/health');
      const ok = !!(d.configured && d.keyValid);
      this.setData({
        tested: true,
        llmOk: ok,
        testResult: ok ? '✔ 后端已连接，LLM 配置有效' : '✘ 后端已连接，但 LLM 未配置或 Key 无效',
        model: d.model || '',
        llmConfigured: !!d.configured,
      });
    } catch (e) {
      this.setData({ tested: true, llmOk: false, testResult: '✘ 无法连接后端服务' });
    }
  },
});
