// pages/review/review.js
const logic = require('../../utils/logic.js');

const MOODS = [
  { key: 'sad',   emoji: '😞', label: '低落' },
  { key: 'ok',    emoji: '😐', label: '平淡' },
  { key: 'good',  emoji: '🙂', label: '不错' },
  { key: 'great', emoji: '😊', label: '开心' },
  { key: 'amazing', emoji: '🤩', label: '超赞' }
];

const SCORE_DIMS = [
  { key: 'physical', label: '体能', color: 'green' },
  { key: 'energy',   label: '心力', color: 'blue' },
  { key: 'mental',   label: '脑力', color: 'orange' },
  { key: 'emotion',  label: '情绪', color: 'rose' }
];

const PRESET_TAGS = ['工作', '学习', '生活', '成长', '总结', '反思', '计划'];
const WEEK_DAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

Page({
  data: {
    todayStr: '',
    dateLabel: '',
    weekDay: '',
    streak: 0,
    todayDoneCount: 0,
    todayTotalCount: 0,
    todayCompleteRate: 0,
    currentMood: 'good',
    scoreDims: SCORE_DIMS,
    scores: { physical: 5, energy: 5, mental: 5, emotion: 5 },
    todayTasks: [],
    moods: MOODS,
    showHistory: false,
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
    const today = logic.fmtDate(new Date());
    const d = new Date();
    this.setData({
      todayStr: today,
      dateLabel: `${d.getMonth() + 1}月${d.getDate()}日`,
      weekDay: WEEK_DAYS[d.getDay()]
    });
    const start = new Date();
    start.setDate(start.getDate() - 6);
    this.setData({
      'draft.periodStart': logic.fmtDate(start),
      'draft.periodEnd': today
    });
    this._unsubSync = this._app.onSyncChange((status) => {
      if (status === 'synced') this.refreshView();
    });
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setSelected(5);
    }
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

  refreshView() {
    const state = this._app.getState();
    const today = this.data.todayStr;

    const metrics = logic.getReviewDaily(state, today);
    const streak = logic.reviewDailyStreak(state.reviewDaily.metrics, today);

    const workTasks = state.work.tasks || [];
    const todayTasks = workTasks.filter(t => {
      if (t.dueDate) return t.dueDate === today;
      const d = t.createdAt ? new Date(t.createdAt) : null;
      return d && logic.fmtDate(d) === today;
    });
    const doneCount = todayTasks.filter(t => t.done).length;
    const totalCount = todayTasks.length;
    const rate = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

    const taskList = logic.sortedWorkTasks(todayTasks).map(t => ({
      id: t.id,
      title: t.title,
      done: t.done,
      priority: t.priority || 1,
      timeLabel: t.dueDate || ''
    }));

    this.setData({
      streak,
      todayDoneCount: doneCount,
      todayTotalCount: totalCount,
      todayCompleteRate: rate,
      todayTasks: taskList,
      currentMood: metrics ? (metrics.mood || 'good') : 'good',
      scores: {
        physical: metrics ? metrics.physical : 5,
        energy: metrics ? metrics.energy : 5,
        mental: metrics ? metrics.mental : 5,
        emotion: metrics ? metrics.emotion : 5
      }
    });

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
  },

  onMoodPick(e) {
    this.setData({ currentMood: e.currentTarget.dataset.mood });
  },

  onScoreTap(e) {
    const key = e.currentTarget.dataset.key;
    const scores = Object.assign({}, this.data.scores);
    scores[key] = (scores[key] + 1) % 11;
    this.setData({ scores });
  },

  onTaskToggle(e) {
    const id = parseInt(e.currentTarget.dataset.id, 10);
    const state = this._app.getState();
    const r = logic.toggleWorkTask(state, id);
    if (r.error) { this.toast(r.error); return; }
    this._app.globalData.state = r.state;
    this._app.saveData();
    this.refreshView();
  },

  onSaveReview() {
    const state = this._app.getState();
    const r = logic.saveReviewDaily(state, this.data.todayStr, {
      mood: this.data.currentMood,
      physical: this.data.scores.physical,
      energy: this.data.scores.energy,
      mental: this.data.scores.mental,
      emotion: this.data.scores.emotion
    });
    if (r.error) { this.toast(r.error); return; }
    this._app.globalData.state = r.state;
    this._app.saveData();
    this.toast('今日复盘已保存');
    this.refreshView();
  },

  toggleHistory() {
    this.setData({ showHistory: !this.data.showHistory });
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

  onFabTap() {
    this.onSaveReview();
  }
});
