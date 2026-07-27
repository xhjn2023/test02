// pages/meds/meds.js
const logic = require('../../utils/logic.js');

Page({
  data: {
    todayLabel: '',
    todayChecked: false,
    streakNum: 0,
    ringPct: 0,
    remainPills: 0,
    totalPills: 30,
    bottleNo: '—',
    estFinish: '—',
    showLowAlert: false,
    lowAlertText: '',
    settings: { reminderTime: '08:00', notificationEnabled: false, lowThreshold: 5, pillsPerDay: 1 },
    historyTab: 'checkins',
    checkinHistory: [],
    bottleHistory: [],
    sheetShow: false,
    sheetTitle: '修改剩余药量',
    sheetBottleNo: 1,
    sheetPills: 30,
    sheetErr: '',
    sheetMode: 'edit',
    toastShow: false,
    toastMsg: ''
  },

  _toastTimer: null,
  _app: null,
  _unsubSync: null,
  _ringCanvasReady: false,

  onLoad() {
    this._app = getApp();
    const d = new Date();
    const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    this.setData({
      todayLabel: `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${weekDays[d.getDay()]}`
    });

    this._unsubSync = this._app.onSyncChange((status) => {
      if (status === 'synced') this.refreshView();
    });

    const todayStr = logic.fmtDate(new Date());
    this._ensureFirstBottle(todayStr);
  },

  onReady() {
    this._initRingCanvas();
  },

  onShow() {
    if (this._app) this.refreshView();
  },

  onUnload() {
    if (this._unsubSync) this._unsubSync();
  },

  onPullDownRefresh() {
    this._app.manualSync().then(() => {
      this.refreshView();
      wx.stopPullDownRefresh();
      this.toast('已同步');
    }).catch(() => wx.stopPullDownRefresh());
  },

  _ensureFirstBottle(todayStr) {
    const app = this._app;
    if (!app || !app.globalData) return;
    const state = app.getState();
    if (state.meds.bottles.length) return;
    if (!app.globalData.ready) {
      setTimeout(() => this._ensureFirstBottle(todayStr), 500);
      return;
    }
    const r = logic.newBottle(state, todayStr, {});
    app.globalData.state = r.state;
    app.saveData();
  },

  toast(msg) {
    this.setData({ toastShow: true, toastMsg: msg });
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.setData({ toastShow: false }), 2200);
  },

  _initRingCanvas() {
    const query = wx.createSelectorQuery().in(this);
    query.select('#ringCanvas').fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0] || !res[0].node) {
        setTimeout(() => this._initRingCanvas(), 200);
        return;
      }
      const canvas = res[0].node;
      const ctx = canvas.getContext('2d');
      const dpr = (wx.getSystemInfoSync && wx.getSystemInfoSync().pixelRatio) || 1;
      canvas.width = res[0].width * dpr;
      canvas.height = res[0].height * dpr;
      ctx.scale(dpr, dpr);
      this._ringCanvas = canvas;
      this._ringCtx = ctx;
      this._ringSize = res[0].width;
      this._ringCanvasReady = true;
      this._drawRing();
    });
  },

  _drawRing() {
    if (!this._ringCanvasReady || !this._ringCtx) return;
    const ctx = this._ringCtx;
    const size = this._ringSize || 112;
    const cx = size / 2, cy = size / 2, r = size / 2 - 10;
    const pct = Math.max(0, Math.min(100, this.data.ringPct || 0));
    ctx.clearRect(0, 0, size, size);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = '#dcfce7';
    ctx.lineWidth = 9;
    ctx.stroke();
    if (pct > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (pct / 100));
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 9;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  },

  refreshView() {
    const state = this._app.getState();
    const b = logic.activeBottle(state);
    const today = logic.fmtDate(new Date());
    const tc = state.meds.checkins.find(c => c.date === today);
    const todayChecked = !!(tc && tc.taken);
    const streak = logic.calcMedsStreak(state.meds.checkins, today);
    const settings = state.meds.settings;

    const newData = {
      todayChecked,
      streakNum: streak,
      settings: Object.assign({}, settings),
      remainPills: b ? Math.max(0, Number(b.remainingPills) || 0) : 0,
      totalPills: b ? (Number(b.totalPills) || 30) : 30,
      bottleNo: b ? b.bottleNumber : '—',
      estFinish: logic.estFinishDate(b, settings.pillsPerDay),
      ringPct: logic.ringPercent(b)
    };

    if (b && (Number(b.remainingPills) || 0) <= (Number(settings.lowThreshold) || 0)) {
      newData.showLowAlert = true;
      newData.lowAlertText = `当前剩余 ${b.remainingPills} 颗（第${b.bottleNumber}瓶），低于阈值 ${settings.lowThreshold} 颗，建议尽快购药。`;
    } else {
      newData.showLowAlert = false;
    }

    newData.checkinHistory = logic.recentCheckins(state.meds.checkins, 60).map(c => {
      const bb = state.meds.bottles.find(x => x.id === c.bottleId);
      const bottleLabel = bb ? `第${bb.bottleNumber}瓶` : '';
      const timeStr = c.timestamp ? this._fmtTime(c.timestamp) : '';
      return Object.assign({}, c, { bottleLabel, timeStr });
    });
    newData.bottleHistory = logic.sortedBottles(state.meds.bottles).map(b => {
      const total = Number(b.totalPills) || 30;
      const remain = Math.max(0, Number(b.remainingPills) || 0);
      const consumed = Math.max(0, total - remain);
      const pct = total ? Math.round((consumed / total) * 100) : 0;
      return Object.assign({}, b, { consumed, pct });
    });

    this.setData(newData);
    this._drawRing();
  },

  _fmtTime(iso) {
    try {
      const d = new Date(iso);
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    } catch (e) { return ''; }
  },

  onCheckin() {
    const today = logic.fmtDate(new Date());
    const state = this._app.getState();
    const r = logic.toggleCheckin(state, today);
    if (r.action === 'noBottle') {
      this.toast('请先开启第一瓶药');
      this.openSheet('new');
      return;
    }
    this._app.globalData.state = r.state;
    this._app.saveData().then(res => {
      if (!res || !res.ok) {
        this.toast('同步失败，请检查网络');
      } else if (res.partial) {
        this.toast(r.action === 'checkin' ? '打卡成功（部分同步失败）' : '已取消（部分同步失败）');
      } else {
        this.toast(r.action === 'checkin' ? '打卡成功，记得按时吃药' : '已取消今日打卡');
      }
    });
    this.refreshView();
  },

  onNewBottle() { this.openSheet('new'); },
  onEditPills() { this.openSheet('edit'); },

  openSheet(mode) {
    const state = this._app.getState();
    const b = logic.activeBottle(state);
    let title, bottleNo, pills;
    if (mode === 'new' && b) {
      title = '开新瓶';
      bottleNo = (Number(b.bottleNumber) || 0) + 1;
      pills = 30;
    } else if (mode === 'new') {
      title = '开启第一瓶药';
      bottleNo = 1; pills = 30;
    } else {
      title = '修改余量';
      bottleNo = b ? b.bottleNumber : 1;
      pills = b ? b.remainingPills : 30;
    }
    this.setData({
      sheetShow: true, sheetTitle: title,
      sheetBottleNo: bottleNo, sheetPills: pills,
      sheetErr: '', sheetMode: mode
    });
  },
  onSheetMask() { this.onSheetCancel(); },
  noop() {},
  onSheetCancel() { this.setData({ sheetShow: false }); },
  onSheetInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ [`sheet${key.charAt(0).toUpperCase() + key.slice(1)}`]: e.detail.value });
  },
  onSheetSave() {
    const state = this._app.getState();
    const today = logic.fmtDate(new Date());
    const r = logic.savePills(state, today, {
      bottleNo: this.data.sheetBottleNo,
      pills: this.data.sheetPills
    });
    if (r.error) {
      this.setData({ sheetErr: r.error });
      return;
    }
    this._app.globalData.state = r.state;
    this._app.saveData();
    this.setData({ sheetShow: false });
    this.toast('已保存修改');
    this.refreshView();
  },

  onReminderTimeChange(e) {
    const state = this._app.getState();
    this._app.globalData.state = logic.updateSettings(state, { reminderTime: e.detail.value });
    this._app.saveData();
    this.refreshView();
    this.toast('提醒时间已更新');
  },
  onSettingNumChange(e) {
    const key = e.currentTarget.dataset.key;
    const v = parseInt(e.detail.value, 10);
    if (isNaN(v)) return;
    if (key === 'pillsPerDay' && v < 1) { this.toast('每日颗数不能小于1'); this.refreshView(); return; }
    if (key === 'lowThreshold' && v < 1) { this.toast('阈值不能小于1'); this.refreshView(); return; }
    const state = this._app.getState();
    this._app.globalData.state = logic.updateSettings(state, { [key]: v });
    this._app.saveData();
    this.refreshView();
  },
  onNotifySwitch() {
    const state = this._app.getState();
    const willOn = !state.meds.settings.notificationEnabled;
    this._app.globalData.state = logic.updateSettings(state, { notificationEnabled: willOn });
    this._app.saveData();
    this.refreshView();
    this.toast(willOn ? '已开启页内提醒' : '已关闭提醒');
  },

  onTabHistory(e) {
    this.setData({ historyTab: e.currentTarget.dataset.tab });
  },

  onFabTap() {
    this.onNewBottle();
  }
});
