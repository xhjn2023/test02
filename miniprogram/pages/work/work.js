const logic = require('../../utils/logic.js');

const PRIO_LABELS = { 1: '高', 2: '中', 3: '低' };
const PRIO_TAG_CLASSES = { 1: 'tag-rose', 2: 'tag-orange', 3: '' };

Page({
  data: {
    draft: { title: '', priority: 2, dueDate: '' },
    draftErr: '',
    list: [],
    timelineList: [],
    filter: 'all',
    stat: { total: 0, pending: 0 },
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
    const today = logic.fmtDate(new Date());
    this.setData({ 'draft.dueDate': today });
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setSelected(1);
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
    const today = logic.fmtDate(new Date());
    this.setData({
      showAddModal: true,
      draft: { title: '', priority: 2, dueDate: today },
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

  onPriorityPick(e) {
    this.setData({ 'draft.priority': parseInt(e.currentTarget.dataset.p, 10) });
  },

  onDueDateChange(e) {
    this.setData({ 'draft.dueDate': e.detail.value });
  },

  onAddTask() {
    const d = this.data.draft;
    if (!d.title.trim()) {
      this.setData({ draftErr: '请输入任务标题' });
      return;
    }
    const state = this._app.getState();
    const r = logic.addWorkTask(state, {
      title: d.title,
      priority: d.priority,
      dueDate: d.dueDate
    });
    if (r.error) { this.setData({ draftErr: r.error }); return; }
    this._app.globalData.state = r.state;
    this._app.saveData();
    this.setData({
      showAddModal: false,
      draft: { title: '', priority: 2, dueDate: logic.fmtDate(new Date()) },
      draftErr: ''
    });
    this.toast('任务已添加');
    this.refreshView();
  },

  onToggle(e) {
    const id = parseInt(e.currentTarget.dataset.id, 10);
    const state = this._app.getState();
    const r = logic.toggleWorkTask(state, id);
    if (r.error) { this.toast(r.error); return; }
    this._app.globalData.state = r.state;
    this._app.saveData();
    this.refreshView();
  },

  onDelete(e) {
    const id = parseInt(e.currentTarget.dataset.id, 10);
    wx.showModal({
      title: '提示', content: '确认删除该任务？',
      success: (res) => {
        if (!res.confirm) return;
        const state = this._app.getState();
        this._app.globalData.state = logic.deleteWorkTask(state, id);
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

  _buildTimeline(tasks, today) {
    const todayTasks = tasks.filter(t => t.dueDate === today);
    return todayTasks.map(t => ({
      id: t.id,
      title: t.title,
      done: !!t.done,
      priority: t.priority,
      priorityLabel: PRIO_LABELS[t.priority] || '中',
      priorityTagClass: PRIO_TAG_CLASSES[t.priority] || '',
      timeLabel: t.dueDate ? '今日' : '今天',
      dueDate: t.dueDate
    }));
  },

  refreshView() {
    const state = this._app.getState();
    const tasks = logic.sortedWorkTasks(state.work.tasks);
    const today = logic.fmtDate(new Date());
    const filtered = tasks.filter(t => {
      if (this.data.filter === 'pending') return !t.done;
      if (this.data.filter === 'done') return t.done;
      return true;
    });
    const list = filtered.map(t => ({
      id: t.id,
      title: t.title,
      done: !!t.done,
      priority: t.priority,
      priorityLabel: PRIO_LABELS[t.priority] || '中',
      priorityTagClass: PRIO_TAG_CLASSES[t.priority] || '',
      dueDate: t.dueDate,
      createdAtLabel: (t.createdAt || '').slice(0, 10)
    }));
    const timelineList = this._buildTimeline(tasks, today);
    this.setData({
      list,
      timelineList,
      stat: {
        total: state.work.tasks.length,
        pending: state.work.tasks.filter(t => !t.done).length
      }
    });
  }
});
