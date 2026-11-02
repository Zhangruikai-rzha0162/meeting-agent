App({
  globalData: {
    // 后端服务地址：默认本机开发地址，可在「设置」页修改（存 storage）
    backend: 'http://localhost:7100',
    transcript: '',
  },
  onLaunch() {
    const saved = wx.getStorageSync('backend');
    if (saved) this.globalData.backend = saved;
  },
});
