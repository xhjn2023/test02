// pages/life/life.js
const logic = require('../../utils/logic.js');

const MOODS = [
  { key: 'great', icon: '😀', label: '开心', classes: 'mood-great' },
  { key: 'good',  icon: '🙂', label: '不错', classes: 'mood-good' },
  { key: 'ok',    icon: '😐', label: '一般', classes: 'mood-ok' },
  { key: 'bad',   icon: '😕', label: '不好', classes: 'mood-bad' },
  { key: 'sad',   icon: '😢', label: '难过', classes: 'mood-sad' }
];
const PRESET_TAGS = ['工作', '生活', '美食', '运动', '家庭', '旅行', '想法'];
const WEEK_DAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

Page({
  data: {
    draft: { content: '', mood: 'good', tags: {}, date: '' },
    draftErr: '',
    list: [],
    moods: MOODS,
    presetTags: PRESET_TAGS,
    stat: { total: 0, today: false },
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
    this.setData({ [`draft.${key}`]: e.detail.value });
  },
  onMoodPick(e) {
    this.setData({ 'draft.mood': e.currentTarget.dataset.mood });
  },
  onTagToggle(e) {
    const t = e.currentTarget.dataset.tag;
    const tags = Object.assign({}, this.data.draft.tags);
    if (tags[t]) delete tags[t]; else tags[t] = true;
    this.setData({ 'draft.tags': tags });
  },
  onDateChange(e) {
    this.setData({ 'draft.date': e.detail.value });
  },

  onAddMoment() {
    const d = this.data.draft;
    if (!d.content.trim()) {
      this.setData({ draftErr: '请输入内容' });
      return;
    }
    const state = this._app.getState();
    const r = logic.addLifeMoment(state, {
      content: d.content,
      mood: d.mood,
      tags: Object.keys(d.tags),
      date: d.date
    });
    if (r.error) { this.setData({ draftErr: r.error }); return; }
    this._app.globalData.state = r.state;
    this._app.saveData();
    this.setData({
      draft: { content: '', mood: 'good', tags: {}, date: logic.fmtDate(new Date()) },
      draftErr: ''
    });
    this.toast('记录已保存');
    this.refreshView();
  },

  onDelete(e) {
    const id = parseInt(e.currentTarget.dataset.id, 10);
    wx.showModal({
      title: '提示', content: '确认删除该记录？',
      success: (res) => {
        if (!res.confirm) return;
        const state = this._app.getState();
        this._app.globalData.state = logic.deleteLifeMoment(state, id);
        this._app.saveData();
        this.toast('已删除');
        this.refreshView();
      }
    });
  },

  refreshView() {
    const state = this._app.getState();
    const today = logic.fmtDate(new Date());
    const list = logic.sortedLifeMoments(state.life.moments).slice(0, 200).map(m => {
      const moodObj = MOODS.find(x => x.key === m.mood) || MOODS[1];
      const d = new Date(m.date);
      return {
        id: m.id,
        moodIcon: moodObj.icon,
        dateLabel: `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK_DAYS[d.getDay()]}`,
        content: m.content,
        tagsHtml: (m.tags || []).slice(0, 8)
      };
    });
    this.setData({
      list,
      stat: {
        total: state.life.moments.length,
        today: state.life.moments.some(m => m.date === today)
      }
    });
  }
});
