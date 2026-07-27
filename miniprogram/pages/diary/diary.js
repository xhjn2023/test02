// pages/diary/diary.js
const logic = require('../../utils/logic.js');

const MOODS = [
  { key: 'great', icon: '😀', label: '开心', classes: 'mood-great' },
  { key: 'good',  icon: '🙂', label: '不错', classes: 'mood-good' },
  { key: 'ok',    icon: '😐', label: '一般', classes: 'mood-ok' },
  { key: 'bad',   icon: '😕', label: '不好', classes: 'mood-bad' },
  { key: 'sad',   icon: '😢', label: '难过', classes: 'mood-sad' }
];
const PRESET_TAGS = ['工作', '生活', '健康', '学习', '家庭', '旅行', '想法'];
const WEEK_DAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

Page({
  data: {
    todayStr: '',
    todayLabel: '',
    // 选中的编辑日期
    selectedDate: '',
    editingDateTitle: '',
    diaryDateTitle: '',
    diaryContent: '',
    diarySaveBtnText: '保存日记',
    showDiaryDelete: false,
    wcNum: 0,
    currentMood: 'good',
    currentTags: {},
    moods: MOODS,
    presetTags: PRESET_TAGS,
    statTotal: 0,
    statWords: 0,
    statStreak: 0,
    diarySearch: '',
    diaryList: [],
    // 日历
    calendarPickerValue: '',
    calendarTitle: '',
    calendarCells: [],
    calendarYear: 0,
    calendarMonth: 0, // 0-11
    // toast
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
      todayLabel: `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${WEEK_DAYS[d.getDay()]}`,
      selectedDate: today
    });
    this._buildCalendar(d.getFullYear(), d.getMonth());

    this._unsubSync = this._app.onSyncChange((status) => {
      if (status === 'synced') this.refreshDiaryView();
    });
  },

  onShow() {
    if (this._app) this.refreshDiaryView();
  },

  onUnload() {
    if (this._unsubSync) this._unsubSync();
  },

  onPullDownRefresh() {
    this._app.manualSync().then(() => {
      this.refreshDiaryView();
      wx.stopPullDownRefresh();
      this.toast('已同步');
    }).catch(() => wx.stopPullDownRefresh());
  },

  // ============ Toast ============
  toast(msg) {
    this.setData({ toastShow: true, toastMsg: msg });
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.setData({ toastShow: false }), 2200);
  },

  // ============ 日历构建 ============
  _buildCalendar(year, month) {
    // month 0-11
    const first = new Date(year, month, 1);
    const firstWeekday = first.getDay(); // 0-6 (Sun-Sat)
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrev = new Date(year, month, 0).getDate();
    const todayStr = logic.fmtDate(new Date());
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

    // 当月有日记的日期集合
    const state = this._app ? this._app.getState() : null;
    const dotMap = state ? logic.diaryMonthMap(state.diary.entries, monthStr) : {};

    const cells = [];
    // 上月尾部填空
    for (let i = firstWeekday - 1; i >= 0; i--) {
      const day = daysInPrev - i;
      const prevMonth = month === 0 ? 11 : month - 1;
      const prevYear = month === 0 ? year - 1 : year;
      const dateStr = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      cells.push({
        key: 'p' + dateStr,
        day, date: dateStr,
        classes: 'muted' + (dotMap[dateStr] ? ' has-dot' : '')
      });
    }
    // 当月
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const classes = [];
      if (dateStr === todayStr) classes.push('today');
      if (dateStr === this.data.selectedDate) classes.push('selected');
      if (dotMap[dateStr]) classes.push('has-dot');
      cells.push({
        key: 'c' + dateStr,
        day, date: dateStr,
        classes: classes.join(' ')
      });
    }
    // 下月头部填空至 42 格（6 行）
    const remaining = 42 - cells.length;
    for (let i = 1; i <= remaining; i++) {
      const nextMonth = month === 11 ? 0 : month + 1;
      const nextYear = month === 11 ? year + 1 : year;
      const dateStr = `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      cells.push({
        key: 'n' + dateStr,
        day: i, date: dateStr,
        classes: 'muted' + (dotMap[dateStr] ? ' has-dot' : '')
      });
    }

    this.setData({
      calendarCells: cells,
      calendarYear: year,
      calendarMonth: month,
      calendarTitle: `${year}年${month + 1}月`,
      calendarPickerValue: `${year}-${String(month + 1).padStart(2, '0')}`
    });
  },

  onPrevMonth() {
    let y = this.data.calendarYear;
    let m = this.data.calendarMonth - 1;
    if (m < 0) { m = 11; y--; }
    this._buildCalendar(y, m);
  },
  onNextMonth() {
    let y = this.data.calendarYear;
    let m = this.data.calendarMonth + 1;
    if (m > 11) { m = 0; y++; }
    this._buildCalendar(y, m);
  },
  onPickerMonthChange(e) {
    const v = e.detail.value; // YYYY-MM
    const [y, m] = v.split('-').map(n => parseInt(n, 10));
    this._buildCalendar(y, m - 1);
  },
  onPickerDateChange(e) {
    const date = e.detail.value;
    this._loadDiaryByDate(date);
  },
  onCalendarCellTap(e) {
    const date = e.currentTarget.dataset.date;
    if (!date) return;
    this._loadDiaryByDate(date);
    // 跨月时同步翻月
    const [y, m] = date.split('-').map(n => parseInt(n, 10));
    if (y !== this.data.calendarYear || (m - 1) !== this.data.calendarMonth) {
      this._buildCalendar(y, m - 1);
    }
  },
  onJumpToday() {
    const today = logic.fmtDate(new Date());
    this._loadDiaryByDate(today);
    const d = new Date();
    this._buildCalendar(d.getFullYear(), d.getMonth());
  },

  _loadDiaryByDate(dateStr) {
    const state = this._app.getState();
    const e = logic.getDiaryByDate(state, dateStr);
    const d = new Date(dateStr);
    const tags = {};
    if (e) {
      (e.tags || []).forEach(t => { tags[t] = true; });
    }
    this.setData({
      selectedDate: dateStr,
      editingDateTitle: `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK_DAYS[d.getDay()]}`,
      diaryDateTitle: `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK_DAYS[d.getDay()]}`,
      diaryContent: e ? (e.content || '') : '',
      currentMood: e ? (e.mood || 'good') : 'good',
      currentTags: tags,
      diarySaveBtnText: e ? '更新日记' : '保存日记',
      showDiaryDelete: !!e,
      wcNum: e ? (e.content || '').length : 0
    });
    // 重新构建日历以刷新 selected 高亮
    this._buildCalendar(this.data.calendarYear, this.data.calendarMonth);
  },

  // ============ diary 视图刷新 ============
  refreshDiaryView() {
    const state = this._app.getState();
    const today = logic.fmtDate(new Date());
    const stats = logic.diaryStats(state.diary.entries);
    this.setData({
      statTotal: stats.total,
      statWords: stats.words,
      statStreak: logic.calcDiaryStreak(state.diary.entries, today)
    });
    // 若当前选中日期没有日记且为今日，初始化空表单
    if (!this.data.selectedDate) {
      this._loadDiaryByDate(today);
    } else {
      // 已选日期内容也刷新（云端可能更新）
      this._loadDiaryByDate(this.data.selectedDate);
    }
    this._refreshDiaryList();
    this._buildCalendar(this.data.calendarYear, this.data.calendarMonth);
  },

  _refreshDiaryList() {
    const state = this._app.getState();
    const kw = this.data.diarySearch;
    const list = logic.searchDiary(state.diary.entries, kw).slice(0, 100).map(e => {
      const m = MOODS.find(x => x.key === e.mood) || MOODS[1];
      const preview = (e.content || '').length > 120 ? (e.content || '').slice(0, 120) + '...' : (e.content || '');
      const d = new Date(e.date);
      return {
        date: e.date,
        moodIcon: m.icon,
        dateLabel: `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK_DAYS[d.getDay()]}`,
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
    const date = this.data.selectedDate || logic.fmtDate(new Date());
    const tags = Object.keys(this.data.currentTags);
    const r = logic.saveDiary(state, date, this.data.diaryContent, this.data.currentMood, tags);
    if (r.error) { this.toast(r.error); return; }
    this._app.globalData.state = r.state;
    this._app.saveData().then(res => {
      if (!res || !res.ok) {
        this.toast('同步失败，请检查网络');
        console.warn('[diary] 保存到云端失败:', res);
      } else if (res.partial) {
        this.toast('已保存（部分同步失败）');
      } else {
        this.toast('日记已保存');
      }
    });
    this.refreshDiaryView();
  },
  onDiaryDelete() {
    if (!this.data.selectedDate) return;
    wx.showModal({
      title: '提示',
      content: '确认删除该日记？此操作不可恢复。',
      success: (res) => {
        if (!res.confirm) return;
        const state = this._app.getState();
        this._app.globalData.state = logic.deleteDiary(state, this.data.selectedDate);
        this._app.saveData();
        this.toast('日记已删除');
        this.refreshDiaryView();
      }
    });
  },
  onDiaryItemClick(e) {
    const date = e.currentTarget.dataset.date;
    this._loadDiaryByDate(date);
    const [y, m] = date.split('-').map(n => parseInt(n, 10));
    if (y !== this.data.calendarYear || (m - 1) !== this.data.calendarMonth) {
      this._buildCalendar(y, m - 1);
    }
    wx.pageScrollTo({ scrollTop: 0, duration: 200 });
  }
});
