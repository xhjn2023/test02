// pages/study/study.js
const logic = require('../../utils/logic.js');

Page({
  data: {
    draft: { subject: '', content: '', durationMin: 30, date: '' },
    draftErr: '',
    list: [],
    filter: 'all',
    stat: { total: 0, done: 0, minutes: 0 },
    toastShow: false,
    toastMsg: ''
  },

  _toastTimer: null,
  _app: null,
  _unsubSync: null,

  onLoad() {
    this._app = getApp();
    this._unsubSync = this._app.onSyncChange((status) => {
      if (status === 'synced') this.refreshView();
    });
    this.setData({ 'draft.date': logic.fmtDate(new Date()) });
  },

  onShow() {
    if (this._app) this.refreshView();
  },

  onUnload() { if (this._unsubSync) this._unsubSync(); },

  onPullDownRefresh() {
    this._app.manualSync().then(() => {
      this.refreshView();
      wx.stopPullDownRefresh();
      this.toast('已同步');
    }).catch(() => wx.stopPullDownRefresh());
  },

  toast(msg) {
    this.setData({ toastShow: true, toastMsg: msg });
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.setData({ toastShow: false }), 2200);
  },

  onDraftInput(e) {
    const key = e.currentTarget.dataset.key;
    let val = e.detail.value;
    if (key === 'durationMin') val = parseInt(val, 10) || 0;
    this.setData({ [`draft.${key}`]: val });
  },
  onDateChange(e) {
    this.setData({ 'draft.date': e.detail.value });
  },

  onAddPlan() {
    const d = this.data.draft;
    if (!d.subject.trim()) {
      this.setData({ draftErr: '请输入学习主题' });
      return;
    }
    const state = this._app.getState();
    const r = logic.addStudyPlan(state, {
      subject: d.subject,
      content: d.content,
      durationMin: d.durationMin,
      date: d.date
    });
    if (r.error) { this.setData({ draftErr: r.error }); return; }
    this._app.globalData.state = r.state;
    this._app.saveData();
    this.setData({
      draft: { subject: '', content: '', durationMin: 30, date: logic.fmtDate(new Date()) },
      draftErr: ''
    });
    this.toast('计划已添加');
    this.refreshView();
  },

  onToggle(e) {
    const id = parseInt(e.currentTarget.dataset.id, 10);
    const state = this._app.getState();
    const r = logic.toggleStudyPlan(state, id);
    if (r.error) { this.toast(r.error); return; }
    this._app.globalData.state = r.state;
    this._app.saveData();
    this.refreshView();
  },

  onDelete(e) {
    const id = parseInt(e.currentTarget.dataset.id, 10);
    wx.showModal({
      title: '提示', content: '确认删除该计划？',
      success: (res) => {
        if (!res.confirm) return;
        const state = this._app.getState();
        this._app.globalData.state = logic.deleteStudyPlan(state, id);
        this._app.saveData();
        this.toast('已删除');
        this.refreshView();
      }
    });
  },

  onFilter(e) {
    this.setData({ filter: e.currentTarget.dataset.f });
    this.refreshView();
  },

  refreshView() {
    const state = this._app.getState();
    const plans = logic.sortedStudyPlans(state.study.plans);
    const filtered = plans.filter(p => {
      if (this.data.filter === 'pending') return !p.completed;
      if (this.data.filter === 'done') return p.completed;
      return true;
    });
    const list = filtered.map(p => ({
      id: p.id,
      subject: p.subject,
      content: p.content,
      durationMin: p.durationMin,
      completed: !!p.completed,
      date: p.date,
      createdAtLabel: (p.createdAt || '').slice(0, 10)
    }));
    const stats = logic.studyStats(state.study.plans);
    this.setData({ list, stat: stats });
  }
});
