// pages/home/home.js
const logic = require('../../utils/logic.js');

Page({
  data: {
    greeting: '',
    heroTitle: '',
    hero: {
      tasksDone: 0,
      tasksTotal: 0,
      studyHours: 0,
      studyMinutes: 0,
      streak: 0
    },
    overview: {
      meds: { streak: 0, remain: 0 },
      diary: { total: 0, streak: 0, today: false },
      work: { total: 0, pending: 0, todayTotal: 0, todayDone: 0 },
      study: { total: 0, done: 0, minutes: 0, streak: 0 },
      life: { total: 0, today: false },
      review: { total: 0, avgRating: 0 },
      side: { total: 0, done: 0, inProgress: 0, avgProgress: 0 },
      reviewDaily: { today: false, streak: 0, total: 0 }
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
    this._updateGreeting();

    this._unsubSync = this._app.onSyncChange((status) => {
      this._applySyncStatus(status);
      if (status === 'synced') this.refreshOverview();
    });
  },

  onShow() {
    this._updateGreeting();
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

  _updateGreeting() {
    const h = new Date().getHours();
    let greeting = '你好';
    let heroTitle = '今天是充实的一天';
    if (h >= 5 && h < 12) {
      greeting = '上午好 ☀️';
      heroTitle = '开启美好的一天';
    } else if (h >= 12 && h < 18) {
      greeting = '下午好 🌤';
      heroTitle = '继续加油向前冲';
    } else if (h >= 18 && h < 22) {
      greeting = '晚上好 🌙';
      heroTitle = '回顾今天的收获';
    } else {
      greeting = '夜深了 ✨';
      heroTitle = '早点休息哦';
    }
    this.setData({ greeting, heroTitle });
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
    const overview = logic.moduleOverview(state);
    const studyHours = Math.floor(overview.study.minutes / 60);
    const studyMinutes = overview.study.minutes % 60;
    const streak = Math.max(
      overview.meds.streak,
      overview.diary.streak,
      overview.study.streak,
      overview.reviewDaily.streak
    );
    const hero = {
      tasksDone: overview.work.todayDone || 0,
      tasksTotal: overview.work.todayTotal || 0,
      studyHours,
      studyMinutes,
      streak
    };
    this.setData({ overview, hero });
  },

  toast(msg) {
    this.setData({ toastShow: true, toastMsg: msg });
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.setData({ toastShow: false }), 2200);
  },

  onFabTap() {
    wx.showActionSheet({
      itemList: ['工作任务', '学习计划', '生活记录', '副业项目', '每日复盘'],
      success: (res) => {
        const actions = [
          () => this.goWork(),
          () => this.goStudy(),
          () => this.goLife(),
          () => this.goSide(),
          () => this.goReview()
        ];
        if (actions[res.tapIndex]) actions[res.tapIndex]();
      }
    });
  },

  goMeds() { wx.navigateTo({ url: '/pages/meds/meds' }); },
  goDiary() { wx.navigateTo({ url: '/pages/diary/diary' }); },
  goWork() { wx.navigateTo({ url: '/pages/work/work' }); },
  goStudy() { wx.navigateTo({ url: '/pages/study/study' }); },
  goLife() { wx.navigateTo({ url: '/pages/life/life' }); },
  goReview() { wx.navigateTo({ url: '/pages/review/review' }); },
  goSide() { wx.navigateTo({ url: '/pages/side/side' }); },

  onExport() {
    const state = this._app.getState();
    wx.setClipboardData({
      data: JSON.stringify(state, null, 2),
      success: () => this.toast('数据已复制到剪贴板')
    });
  }
});
