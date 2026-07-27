// pages/study/study.js
const logic = require('../../utils/logic.js');

const BANNER_CLASSES = ['gradient-blue', 'gradient-green', 'gradient-orange', 'gradient-rose', 'gradient-pink'];
const COURSE_ICONS = ['📚', '🎯', '💡', '🌟', '🚀', '📝', '🎨', '🧠'];
const TEACHERS = ['张老师', '李教授', '王导师', '陈讲师', '刘老师', '赵教授'];

Page({
  data: {
    draft: { subject: '', content: '', durationMin: 30, date: '' },
    draftErr: '',
    list: [],
    filter: 'all',
    stat: { total: 0, done: 0, minutes: 0 },
    toastShow: false,
    toastMsg: '',
    categories: [
      { id: 'all', name: '全部' },
      { id: 'hr', name: '人事专业' },
      { id: 'supermarket', name: '超市经营' },
      { id: 'energy', name: '内心能量' },
      { id: 'wisdom', name: '人生智慧' }
    ],
    activeCategory: 'all',
    weeklyHours: 0,
    streakDays: 0,
    courseList: [],
    recommendList: [
      { id: 1, title: '高效学习的7个方法', icon: '📖', iconBg: 'gradient-blue', source: '学习日报', readTime: 5 },
      { id: 2, title: '如何保持专注与自律', icon: '🎯', iconBg: 'gradient-green', source: '内心成长', readTime: 8 },
      { id: 3, title: '时间管理的艺术', icon: '⏰', iconBg: 'gradient-orange', source: '效率提升', readTime: 6 }
    ]
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
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setSelected(2);
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

  onCategoryTap(e) {
    this.setData({ activeCategory: e.currentTarget.dataset.id });
    this.refreshView();
  },

  onCourseTap(e) {
    const id = parseInt(e.currentTarget.dataset.id, 10);
    wx.showActionSheet({
      itemList: ['标记完成', '删除计划'],
      itemColor: '#6b7280',
      success: (res) => {
        if (res.tapIndex === 0) {
          this.onToggle({ currentTarget: { dataset: { id } } });
        } else if (res.tapIndex === 1) {
          this.onDelete({ currentTarget: { dataset: { id } } });
        }
      }
    });
  },

  onFabTap() {
    wx.showModal({
      title: '新建学习计划',
      editable: true,
      placeholderText: '输入学习主题',
      success: (res) => {
        if (!res.confirm || !res.content || !res.content.trim()) return;
        const state = this._app.getState();
        const r = logic.addStudyPlan(state, {
          subject: res.content.trim(),
          content: '',
          durationMin: 30,
          date: logic.fmtDate(new Date())
        });
        if (r.error) { this.toast(r.error); return; }
        this._app.globalData.state = r.state;
        this._app.saveData();
        this.toast('计划已添加');
        this.refreshView();
      }
    });
  },

  _calcWeeklyMinutes(plans) {
    const now = new Date();
    const dayOfWeek = now.getDay() || 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - dayOfWeek + 1);
    monday.setHours(0, 0, 0, 0);
    const mondayStr = logic.fmtDate(monday);

    return (plans || [])
      .filter(p => p.completed && p.date >= mondayStr)
      .reduce((sum, p) => sum + (Number(p.durationMin) || 0), 0);
  },

  _buildCourseList(plans) {
    const sorted = logic.sortedStudyPlans(plans);
    return sorted.map((p, idx) => {
      const progress = p.completed ? 100 : (p.durationMin ? 30 : 0);
      const bannerIdx = idx % BANNER_CLASSES.length;
      const iconIdx = idx % COURSE_ICONS.length;
      const teacherIdx = idx % TEACHERS.length;
      let progressClass = '';
      if (p.completed) progressClass = 'green';
      else if (bannerIdx === 1) progressClass = 'green';
      else if (bannerIdx === 2) progressClass = 'orange';
      else if (bannerIdx === 3 || bannerIdx === 4) progressClass = 'rose';

      return {
        id: p.id,
        subject: p.subject,
        content: p.content,
        durationMin: p.durationMin || 30,
        completed: !!p.completed,
        date: p.date,
        progress,
        progressClass,
        bannerClass: BANNER_CLASSES[bannerIdx],
        icon: COURSE_ICONS[iconIdx],
        teacher: TEACHERS[teacherIdx]
      };
    });
  },

  refreshView() {
    const state = this._app.getState();
    const plans = state.study.plans;
    const sorted = logic.sortedStudyPlans(plans);
    const filtered = sorted.filter(p => {
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
    const stats = logic.studyStats(plans);
    const weeklyMin = this._calcWeeklyMinutes(plans);
    const weeklyHours = Math.round(weeklyMin / 60 * 10) / 10;
    const todayStr = logic.fmtDate(new Date());
    const streakDays = logic.calcStudyStreak(plans, todayStr);
    const courseList = this._buildCourseList(plans);

    this.setData({
      list,
      stat: stats,
      weeklyHours,
      streakDays,
      courseList
    });
  }
});
