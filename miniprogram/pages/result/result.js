const app = getApp();
const api = require('../../utils/api.js');
const { md2html } = require('../../utils/md2html.js');

Page({
  data: {
    tab: 'summary',
    loading: true,
    loadingText: '多智能体协作中…',
    summaryHtml: '',
    summaryText: '',
    tree: null,
    imageUrl: '',
  },
  mode: 'all',

  onLoad(options) {
    this.mode = (options && options.mode) || 'all';
    this.setData({ tab: this.mode === 'all' ? 'summary' : this.mode });
    this.generate();
  },

  async generate() {
    const transcript = (app.globalData.transcript || '').trim();
    if (!transcript) {
      wx.showToast({ title: '缺少转写文本', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    const single = this.mode !== 'all';
    this.setData({
      loading: true,
      loadingText: single ? '智能体工作中…' : '纪要专员 + 导图专家 + 信息图设计师 并行工作中…',
    });
    try {
      if (!single) {
        const d = await api.request('/api/run-all', {
          method: 'POST',
          data: { transcript, png: true },
        });
        this.setData({
          summaryHtml: md2html(d.summary || ''),
          summaryText: d.summary || '',
          tree: d.tree || null,
          imageUrl: d.png || '',
          loading: false,
        });
        return;
      }
      // 单智能体模式
      if (this.mode === 'summary') {
        const d = await api.request('/api/summarize', { method: 'POST', data: { transcript } });
        this.setData({ summaryHtml: md2html(d.summary || ''), summaryText: d.summary || '', loading: false });
      } else if (this.mode === 'mindmap') {
        const d = await api.request('/api/mindmap', { method: 'POST', data: { transcript } });
        this.setData({ tree: d.tree || null, loading: false });
      } else {
        const url = await api.requestBinary('/api/summary-image/png', { transcript });
        this.setData({ imageUrl: url, loading: false });
      }
    } catch (e) {
      this.setData({ loading: false });
    }
  },

  switchTab(e) { this.setData({ tab: e.currentTarget.dataset.tab }); },

  copySummary() {
    if (!this.data.summaryText) return;
    wx.setClipboardData({ data: this.data.summaryText });
  },

  saveImage() {
    const url = this.data.imageUrl;
    if (!url) return;
    const base64 = url.replace(/^data:image\/\w+;base64,/, '');
    const path = `${wx.env.USER_DATA_PATH}/summary_${Date.now()}.png`;
    wx.showLoading({ title: '保存中…' });
    wx.getFileSystemManager().writeFile({
      filePath: path,
      data: base64,
      encoding: 'base64',
      success: () => {
        wx.saveImageToPhotosAlbum({
          filePath: path,
          success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
          fail: () => wx.showToast({ title: '保存失败或未授权', icon: 'none' }),
          complete: () => wx.hideLoading(),
        });
      },
      fail: () => { wx.hideLoading(); wx.showToast({ title: '保存失败', icon: 'none' }); },
    });
  },
});
