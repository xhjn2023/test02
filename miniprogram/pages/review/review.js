// pages/review/review.js
const logic = require('../../utils/logic.js');

const PRESET_TAGS = ['工作', '学习', '生活', '成长', '总结', '反思', '计划'];

Page({
  data: {
    draft: {
      periodType: 'week',
      rating: 3,
      periodStart: '',
      periodEnd: '',
      content: '',
      tags: {}
    },
    draftErr: '',
    list: [],
    presetTags: PRESET_TAGS,
    stat: { total: 0, avgRating: 0 },
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
    // 默认本周（今天往前 7 天）
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    this.setData({
      'draft.periodStart': logic.fmtDate(start),
      'draft.periodEnd': logic.fmtDate(today)
    });
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
    this.setData({ [`draft.${key}`]: e.detail.value });
  },
  onPeriodTypePick(e) {
    this.setData({ 'draft.periodType': e.currentTarget.dataset.p });
  },
  onRatingPick(e) {
    this.setData({ 'draft.rating': parseInt(e.currentTarget.dataset.r, 10) });
  },
  onPeriodStartChange(e) {
    this.setData({ 'draft.periodStart': e.detail.value });
  },
  onPeriodEndChange(e) {
    this.setData({ 'draft.periodEnd': e.detail.value });
  },
  onTagToggle(e) {
    const t = e.currentTarget.dataset.tag;
    const tags = Object.assign({}, this.data.draft.tags);
    if (tags[t]) delete tags[t]; else tags[t] = true;
    this.setData({ 'draft.tags': tags });
  },

  onAddReview() {
    const d = this.data.draft;
    if (!d.content.trim()) {
      this.setData({ draftErr: '请输入复盘内容' });
      return;
    }
    const state = this._app.getState();
    const r = logic.addReviewEntry(state, {
      periodType: d.periodType,
      periodStart: d.periodStart,
      periodEnd: d.periodEnd,
      content: d.content,
      rating: d.rating,
      tags: Object.keys(d.tags)
    });
    if (r.error) { this.setData({ draftErr: r.error }); return; }
    this._app.globalData.state = r.state;
    this._app.saveData();
    this.setData({
      draft: {
        periodType: 'week',
        rating: 3,
        periodStart: '',
        periodEnd: '',
        content: '',
        tags: {}
      },
      draftErr: ''
    });
    this.toast('复盘已保存');
    this.refreshView();
  },

  onDelete(e) {
    const id = parseInt(e.currentTarget.dataset.id, 10);
    wx.showModal({
      title: '提示', content: '确认删除该复盘？',
      success: (res) => {
        if (!res.confirm) return;
        const state = this._app.getState();
        this._app.globalData.state = logic.deleteReviewEntry(state, id);
        this._app.saveData();
        this.toast('已删除');
        this.refreshView();
      }
    });
  },

  refreshView() {
    const state = this._app.getState();
    const list = logic.sortedReviewEntries(state.review.entries).map(r => ({
      id: r.id,
      periodTypeLabel: r.periodType === 'month' ? '月' : '周',
      periodLabel: r.periodStart && r.periodEnd ? `${r.periodStart} ~ ${r.periodEnd}` : (r.createdAt || '').slice(0, 10),
      rating: r.rating,
      content: r.content,
      tagsHtml: (r.tags || []).slice(0, 8)
    }));
    this.setData({
      list,
      stat: logic.reviewStats(state.review.entries)
    });
  }
});
