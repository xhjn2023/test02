// pages/index/index.js
const logic = require('../../utils/logic.js');
const supabase = require('../../utils/supabase.js');

const MOODS = [
  { key: 'great', icon: '😀', label: '开心', classes: 'mood-great' },
  { key: 'good',  icon: '🙂', label: '不错', classes: 'mood-good' },
  { key: 'ok',    icon: '😐', label: '一般', classes: 'mood-ok' },
  { key: 'bad',   icon: '😕', label: '不好', classes: 'mood-bad' },
  { key: 'sad',   icon: '😢', label: '难过', classes: 'mood-sad' }
];
const PRESET_TAGS = ['工作', '生活', '健康', '学习', '家庭', '旅行', '想法'];

Page({
  data: {
    // 模块
    currentModule: 'meds',
    todayLabel: '',

    // 同步状态
    syncColorClass: 'sync-color-offline',
    syncIconChar: '☁',
    syncSpinning: false,

    // 通知开关（同步到 settings.notificationEnabled）
    notifyOn: false,

    // meds
    checkinTitle: '还未打卡',
    checkinBtnText: '完成今日打卡',
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

    // 弹层
    sheetShow: false,
    sheetTitle: '修改剩余药量',
    sheetBottleNo: 1,
    sheetPills: 30,
    sheetErr: '',
    sheetMode: 'edit',

    // diary
    diaryDateTitle: '',
    diaryContent: '',
    diarySaveBtnText: '保存日记',
    showDiaryDelete: false,
    wcNum: 0,
    currentMood: 'good',
    currentTags: {},   // {tag: true}
    moods: MOODS,
    presetTags: PRESET_TAGS,
    statTotal: 0,
    statWords: 0,
    statStreak: 0,
    diarySearch: '',
    diaryList: [],
    editingDiaryDate: null,

    // toast
    toastShow: false,
    toastMsg: ''
  },

  _toastTimer: null,
  _app: null,
  _unsubSync: null,
  _ringCanvasReady: false,

  onLoad() {
    this._app = getApp();
    const todayStr = logic.fmtDate(new Date());
    const d = new Date();
    const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    this.setData({
      todayLabel: `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${weekDays[d.getDay()]}`
    });

    // 监听同步状态：pullFromCloud 完成后会触发，刷新视图
    this._unsubSync = this._app.onSyncChange((status) => {
      this._applySyncStatus(status);
      if (status === 'synced') {
        this.refreshMedsView();
        if (this.data.currentModule === 'diary') this.refreshDiaryView();
      }
    });

    // 首次进入建第一瓶药（仅在云端拉取完成后；未就绪则等 onShow 时再判断）
    this._ensureFirstBottle(todayStr);
    this.refreshMedsView();
    this.refreshDiaryView();
  },

  // 确保至少有一瓶药：仅在 ready 后执行，避免覆盖云端已有数据
  _ensureFirstBottle(todayStr) {
    const app = this._app;
    if (!app || !app.globalData) return;
    const state = app.getState();
    if (state.meds.bottles.length) return;
    if (!app.globalData.ready) {
      // 还没拉取完，稍后重试
      setTimeout(() => this._ensureFirstBottle(todayStr), 500);
      return;
    }
    const r = logic.newBottle(state, todayStr, {});
    app.globalData.state = r.state;
    app.saveData();
  },

  onReady() {
    this._initRingCanvas();
  },

  onShow() {
    // 每次切回前台/页面时刷新一次（云端可能已更新）
    if (this._app) {
      this.refreshMedsView();
      if (this.data.currentModule === 'diary') this.refreshDiaryView();
    }
  },

  onUnload() {
    if (this._unsubSync) this._unsubSync();
  },

  onPullDownRefresh() {
    this._app.manualSync().then(() => {
      this.refreshMedsView();
      if (this.data.currentModule === 'diary') this.refreshDiaryView();
      wx.stopPullDownRefresh();
      this.toast('已同步');
    }).catch(() => wx.stopPullDownRefresh());
  },

  // ============ 同步状态 ============
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
    this._app.manualSync().then(() => {
      this.refreshMedsView();
      if (this.data.currentModule === 'diary') this.refreshDiaryView();
    });
  },

  // ============ 模块切换 ============
  switchModule(e) {
    const m = e.currentTarget.dataset.module;
    this.setData({ currentModule: m });
    if (m === 'diary') this.refreshDiaryView();
    else if (m === 'meds') this._drawRing();
  },

  // ============ Toast ============
  toast(msg) {
    this.setData({ toastShow: true, toastMsg: msg });
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.setData({ toastShow: false }), 2200);
  },

  // ============ 环形进度 Canvas ============
  _initRingCanvas() {
    const query = wx.createSelectorQuery().in(this);
    query.select('#ringCanvas').fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0] || !res[0].node) {
        // canvas 还没渲染（diary 模块下），稍后再试
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
    // 背景环
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = '#dcfce7';
    ctx.lineWidth = 9;
    ctx.stroke();
    // 前景环
    if (pct > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (pct / 100));
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 9;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  },

  // ============ meds 视图刷新 ============
  refreshMedsView() {
    const state = this._app.getState();
    const b = logic.activeBottle(state);
    const today = logic.fmtDate(new Date());
    const tc = state.meds.checkins.find(c => c.date === today);
    const todayChecked = !!(tc && tc.taken);
    const streak = logic.calcMedsStreak(state.meds.checkins, today);
    const settings = state.meds.settings;

    const newData = {
      todayChecked,
      checkinTitle: todayChecked ? '今日已完成 ✓' : '还未打卡',
      checkinBtnText: todayChecked ? '已打卡，再按一次取消' : '完成今日打卡',
      streakNum: streak,
      settings: Object.assign({}, settings),
      notifyOn: !!settings.notificationEnabled,
      remainPills: b ? Math.max(0, Number(b.remainingPills) || 0) : 0,
      totalPills: b ? (Number(b.totalPills) || 30) : 30,
      bottleNo: b ? b.bottleNumber : '—',
      estFinish: logic.estFinishDate(b, settings.pillsPerDay),
      ringPct: logic.ringPercent(b)
    };

    // 低药量提醒
    if (b && (Number(b.remainingPills) || 0) <= (Number(settings.lowThreshold) || 0)) {
      newData.showLowAlert = true;
      newData.lowAlertText = `当前剩余 ${b.remainingPills} 颗（第${b.bottleNumber}瓶），低于阈值 ${settings.lowThreshold} 颗，建议尽快购药。`;
    } else {
      newData.showLowAlert = false;
    }

    // 历史
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

  // ============ meds 操作 ============
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
    this._app.saveData();
    this.refreshMedsView();
    if (r.action === 'checkin') {
      this.toast('打卡成功，记得按时吃药');
      this._notify('吃药打卡成功 ✓', `今日已服药 ${this.data.settings.pillsPerDay} 颗，剩余 ${this.data.remainPills} 颗`);
    } else {
      this.toast('已取消今日打卡');
    }
  },

  onNewBottle() {
    this.openSheet('new');
  },
  onEditPills() {
    this.openSheet('edit');
  },

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
    this.refreshMedsView();
  },

  // 设置
  onReminderTimeChange(e) {
    const state = this._app.getState();
    this._app.globalData.state = logic.updateSettings(state, { reminderTime: e.detail.value });
    this._app.saveData();
    this.refreshMedsView();
    this.toast('提醒时间已更新');
  },
  onSettingNumChange(e) {
    const key = e.currentTarget.dataset.key;
    const v = parseInt(e.detail.value, 10);
    if (isNaN(v)) return;
    if (key === 'pillsPerDay' && v < 1) { this.toast('每日颗数不能小于1'); this.refreshMedsView(); return; }
    if (key === 'lowThreshold' && v < 1) { this.toast('阈值不能小于1'); this.refreshMedsView(); return; }
    const state = this._app.getState();
    this._app.globalData.state = logic.updateSettings(state, { [key]: v });
    this._app.saveData();
    this.refreshMedsView();
  },
  onNotifySwitch() {
    const state = this._app.getState();
    const willOn = !state.meds.settings.notificationEnabled;
    this._app.globalData.state = logic.updateSettings(state, { notificationEnabled: willOn });
    this._app.saveData();
    this.refreshMedsView();
    this.toast(willOn ? '已开启页内提醒' : '已关闭提醒');
  },
  onNotifyToggle() { this.onNotifySwitch(); },

  _notify(title, body) {
    // 页内提示（暂用 toast，订阅消息留接口注释）
    // 如需微信订阅消息推送，需在小程序后台申请模板，调用 wx.requestSubscribeMessage + 服务端 push
    if (!this.data.notifyOn) return;
    this.toast(title + ' · ' + body);
  },

  onTabHistory(e) {
    this.setData({ historyTab: e.currentTarget.dataset.tab });
  },

  // ============ diary 视图刷新 ============
  refreshDiaryView() {
    const state = this._app.getState();
    const today = logic.fmtDate(new Date());
    const d = new Date();
    const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const e = state.diary.entries.find(x => x.date === today);

    // 今日编辑区
    const diaryData = {};
    diaryData.editingDiaryDate = today;
    diaryData.diaryDateTitle = `${d.getMonth() + 1}月${d.getDate()}日 ${weekDays[d.getDay()]}`;
    if (e) {
      diaryData.diaryContent = e.content || '';
      diaryData.currentMood = e.mood || 'good';
      diaryData.currentTags = {};
      (e.tags || []).forEach(t => { diaryData.currentTags[t] = true; });
      diaryData.diarySaveBtnText = '更新日记';
      diaryData.showDiaryDelete = true;
    } else {
      diaryData.diaryContent = '';
      diaryData.currentMood = 'good';
      diaryData.currentTags = {};
      diaryData.diarySaveBtnText = '保存日记';
      diaryData.showDiaryDelete = false;
    }
    diaryData.wcNum = (diaryData.diaryContent || '').length;

    // 统计
    const stats = logic.diaryStats(state.diary.entries);
    diaryData.statTotal = stats.total;
    diaryData.statWords = stats.words;
    diaryData.statStreak = logic.calcDiaryStreak(state.diary.entries, today);

    this.setData(diaryData);
    this._refreshDiaryList();
  },

  _refreshDiaryList() {
    const state = this._app.getState();
    const kw = this.data.diarySearch;
    const list = logic.searchDiary(state.diary.entries, kw).slice(0, 100).map(e => {
      const m = MOODS.find(x => x.key === e.mood) || MOODS[1];
      const preview = (e.content || '').length > 120 ? (e.content || '').slice(0, 120) + '...' : (e.content || '');
      const d = new Date(e.date);
      const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      return {
        date: e.date,
        moodIcon: m.icon,
        dateLabel: `${d.getMonth() + 1}月${d.getDate()}日 ${weekDays[d.getDay()]}`,
        contentLen: (e.content || '').length,
        preview,
        tagsHtml: (e.tags || []).slice(0, 8)
      };
    });
    this.setData({ diaryList: list });
  },

  onDiaryInput(e) {
    this.setData({ diaryContent: e.detail.value, wcNum: e.detail.value.length });
  },
  onMoodPick(e) {
    this.setData({ currentMood: e.currentTarget.dataset.mood });
  },
  onTagToggle(e) {
    const t = e.currentTarget.dataset.tag;
    const tags = Object.assign({}, this.data.currentTags);
    if (tags[t]) delete tags[t]; else tags[t] = true;
    this.setData({ currentTags: tags });
  },
  onDiarySearch(e) {
    this.setData({ diarySearch: e.detail.value });
    this._refreshDiaryList();
  },

  onDiarySave() {
    const state = this._app.getState();
    const date = this.data.editingDiaryDate || logic.fmtDate(new Date());
    const tags = Object.keys(this.data.currentTags);
    const r = logic.saveDiary(state, date, this.data.diaryContent, this.data.currentMood, tags);
    if (r.error) { this.toast(r.error); return; }
    this._app.globalData.state = r.state;
    this._app.saveData();
    this.toast('日记已保存');
    this.refreshDiaryView();
  },
  onDiaryDelete() {
    if (!this.data.editingDiaryDate) return;
    wx.showModal({
      title: '提示',
      content: '确认删除该日记？此操作不可恢复。',
      success: (res) => {
        if (!res.confirm) return;
        const state = this._app.getState();
        this._app.globalData.state = logic.deleteDiary(state, this.data.editingDiaryDate);
        this._app.saveData();
        this.toast('日记已删除');
        this.refreshDiaryView();
      }
    });
  },
  onDiaryItemClick(e) {
    const date = e.currentTarget.dataset.date;
    const state = this._app.getState();
    const e2 = state.diary.entries.find(x => x.date === date);
    if (!e2) return;
    const d = new Date(e2.date);
    const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const tags = {};
    (e2.tags || []).forEach(t => { tags[t] = true; });
    this.setData({
      editingDiaryDate: e2.date,
      diaryContent: e2.content,
      currentMood: e2.mood || 'good',
      currentTags: tags,
      diaryDateTitle: `${d.getMonth() + 1}月${d.getDate()}日 ${weekDays[d.getDay()]}`,
      diarySaveBtnText: '更新日记',
      showDiaryDelete: true,
      wcNum: (e2.content || '').length
    });
    wx.pageScrollTo({ scrollTop: 0, duration: 200 });
  },

  // 导出
  onExport() {
    const state = this._app.getState();
    wx.setClipboardData({
      data: JSON.stringify(state, null, 2),
      success: () => this.toast('数据已复制到剪贴板')
    });
  }
});
