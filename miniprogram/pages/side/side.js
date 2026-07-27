const logic = require('../../utils/logic.js');

const CATEGORIES = ['全部', '自媒体', '电商', '知识付费', '投资'];
const CATEGORY_TAG_CLASSES = {
  '自媒体': 'tag-purple',
  '电商': 'tag-orange',
  '知识付费': 'tag-blue',
  '投资': 'tag-green'
};

Page({
  data: {
    draft: { title: '', category: '自媒体', progress: 0, dueDate: '', tags: {} },
    draftErr: '',
    list: [],
    categories: CATEGORIES,
    activeCategory: '全部',
    stat: { total: 0, done: 0, inProgress: 0, avgProgress: 0 },
    toastShow: false,
    toastMsg: '',
    showAddModal: false
  },

  _toastTimer: null,
  _app: null,
  _unsubSync: null,

  onLoad() {
    this._app = getApp();
    this._unsubSync = this._app.onSyncChange((status) => {
      if (status === 'synced') this.refreshView();
    });
    this.setData({ 'draft.dueDate': logic.fmtDate(new Date()) });
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setSelected(4);
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

  onFabTap() {
    this.setData({
      showAddModal: true,
      draft: { title: '', category: '自媒体', progress: 0, dueDate: logic.fmtDate(new Date()), tags: {} },
      draftErr: ''
    });
  },

  onCloseModal() {
    this.setData({ showAddModal: false });
  },

  onDraftInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ [`draft.${key}`]: e.detail.value });
  },

  onCategoryPick(e) {
    this.setData({ 'draft.category': e.currentTarget.dataset.cat });
  },

  onCategoryFilter(e) {
    this.setData({ activeCategory: e.currentTarget.dataset.cat });
    this.refreshView();
  },

  onProgressInput(e) {
    let v = parseInt(e.detail.value, 10);
    if (isNaN(v)) v = 0;
    v = Math.max(0, Math.min(100, v));
    this.setData({ 'draft.progress': v });
  },

  onDueDateChange(e) {
    this.setData({ 'draft.dueDate': e.detail.value });
  },

  onAddProject() {
    const d = this.data.draft;
    if (!d.title.trim()) {
      this.setData({ draftErr: '请输入项目名称' });
      return;
    }
    const state = this._app.getState();
    const r = logic.addSideProject(state, {
      title: d.title,
      category: d.category,
      progress: d.progress,
      dueDate: d.dueDate,
      tags: Object.keys(d.tags)
    });
    if (r.error) { this.setData({ draftErr: r.error }); return; }
    this._app.globalData.state = r.state;
    this._app.saveData();
    this.setData({
      showAddModal: false,
      draft: { title: '', category: '自媒体', progress: 0, dueDate: logic.fmtDate(new Date()), tags: {} },
      draftErr: ''
    });
    this.toast('项目已添加');
    this.refreshView();
  },

  onToggle(e) {
    const id = parseInt(e.currentTarget.dataset.id, 10);
    const state = this._app.getState();
    const r = logic.toggleSideProject(state, id);
    if (r.error) { this.toast(r.error); return; }
    this._app.globalData.state = r.state;
    this._app.saveData();
    this.refreshView();
  },

  onDelete(e) {
    const id = parseInt(e.currentTarget.dataset.id, 10);
    wx.showModal({
      title: '提示', content: '确认删除该项目？',
      success: (res) => {
        if (!res.confirm) return;
        const state = this._app.getState();
        this._app.globalData.state = logic.deleteSideProject(state, id);
        this._app.saveData();
        this.toast('已删除');
        this.refreshView();
      }
    });
  },

  refreshView() {
    const state = this._app.getState();
    const projects = logic.sortedSideProjects(state.side.projects);
    const stats = logic.sideStats(state.side.projects);

    const filtered = projects.filter(p => {
      if (this.data.activeCategory === '全部') return true;
      return p.category === this.data.activeCategory;
    });

    const list = filtered.map(p => ({
      id: p.id,
      title: p.title,
      category: p.category,
      categoryTagClass: CATEGORY_TAG_CLASSES[p.category] || '',
      done: !!p.done,
      progress: Number(p.progress) || 0,
      dueDate: p.dueDate || '',
      progressFillClass: p.done ? 'green' : (p.progress >= 50 ? 'blue' : 'orange')
    }));

    this.setData({
      list,
      stat: stats
    });
  }
});
