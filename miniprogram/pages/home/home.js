// pages/home/home.js
const logic = require('../../utils/logic.js');

Page({
  data: {
    todayLabel: '',
    overview: {
      meds: { streak: 0, remain: 0 },
      diary: { total: 0, streak: 0, today: false },
      work: { total: 0, pending: 0 },
      study: { total: 0, done: 0 },
      life: { total: 0, today: false },
      review: { total: 0, avgRating: 0 }
    },
    syncColorClass: 'sync-color-offline',
    syncIconChar: '☁',
    syncSpinning: false,
    toastShow: false,
    toastMsg: ''
  },

  _toastTimer: null,
  _app: null,
  _unsubSync: null,

  onLoad() {
    this._app = getApp();
    const d = new Date();
    const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    this.setData({
      todayLabel: `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${weekDays[d.getDay()]}`
    });

    this._unsubSync = this._app.onSyncChange((status) => {
      this._applySyncStatus(status);
      if (status === 'synced') this.refreshOverview();
    });
  },

  onShow() {
    // 每次切回首页刷新一次
    this.refreshOverview();
  },

  onUnload() {
    if (this._unsubSync) this._unsubSync();
  },

  onPullDownRefresh() {
    this._app.manualSync().then(() => {
      this.refreshOverview();
      wx.stopPullDownRefresh();
      this.toast('已同步');
    }).catch(() => wx.stopPullDownRefresh());
  },

  _applySyncStatus(status) {
    const map = {
      synced:  { cls: 'sync-color-synced',  icon: '✓', spin: false },
      syncing: { cls: 'sync-color-syncing', icon: '↻', spin: true },
      offline: { cls: 'sync-color-offline', icon: '☁', spin: false }
    };
    const m = map[status] || map.offline;
    this.setData({
      syncColorClass: m.cls,
      syncIconChar: m.icon,
      syncSpinning: m.spin
    });
  },

  onSyncTap() {
    this._app.manualSync().then(() => this.refreshOverview());
  },

  refreshOverview() {
    const state = this._app.getState();
    this.setData({ overview: logic.moduleOverview(state) });
  },

  toast(msg) {
    this.setData({ toastShow: true, toastMsg: msg });
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.setData({ toastShow: false }), 2200);
  },

  goMeds() { wx.navigateTo({ url: '/pages/meds/meds' }); },
  goDiary() { wx.navigateTo({ url: '/pages/diary/diary' }); },
  goWork() { wx.navigateTo({ url: '/pages/work/work' }); },
  goStudy() { wx.navigateTo({ url: '/pages/study/study' }); },
  goLife() { wx.navigateTo({ url: '/pages/life/life' }); },
  goReview() { wx.navigateTo({ url: '/pages/review/review' }); },

  onExport() {
    const state = this._app.getState();
    wx.setClipboardData({
      data: JSON.stringify(state, null, 2),
      success: () => this.toast('数据已复制到剪贴板')
    });
  }
});
