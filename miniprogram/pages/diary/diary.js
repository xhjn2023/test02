// pages/diary/diary.js
const logic = require('../../utils/logic.js');

const MOODS = [
  { key: 'great', icon: '😀', label: '开心' },
  { key: 'good',  icon: '🙂', label: '不错' },
  { key: 'ok',    icon: '😐', label: '一般' },
  { key: 'bad',   icon: '😕', label: '不好' },
  { key: 'sad',   icon: '😢', label: '难过' }
];
const PRESET_TAGS = ['工作', '生活', '健康', '学习', '家庭', '旅行', '想法'];
const WEEK_DAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

Page({
  data: {
    todayStr: '',
    selectedDate: '',
    selectedDateLabel: '',
    diaryContent: '',
    wcNum: 0,
    currentMood: 'good',
    currentTags: {},
    moods: MOODS,
    presetTags: PRESET_TAGS,
    statTotal: 0,
    showCalendar: false,
    calendarPickerValue: '',
    calendarTitle: '',
    calendarCells: [],
    calendarYear: 0,
    calendarMonth: 0,
    diaryList: [],
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
      selectedDate: today,
      selectedDateLabel: `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK_DAYS[d.getDay()]}`
    });
    this._buildCalendar(d.getFullYear(), d.getMonth());

    this._unsubSync = this._app.onSyncChange((status) => {
      if (status === 'synced') this.refreshView();
    });
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

  toast(msg) {
    this.setData({ toastShow: true, toastMsg: msg });
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.setData({ toastShow: false }), 2200);
  },

  _buildCalendar(year, month) {
    const first = new Date(year, month, 1);
    const firstWeekday = first.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrev = new Date(year, month, 0).getDate();
    const todayStr = this.data.todayStr;
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

    const state = this._app ? this._app.getState() : null;
    const dotMap = state ? logic.diaryMonthMap(state.diary.entries, monthStr) : {};

    const cells = [];
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

  onPrevDay() {
    const d = new Date(this.data.selectedDate);
    d.setDate(d.getDate() - 1);
    this._loadDiaryByDate(logic.fmtDate(d));
  },
  onNextDay() {
    const d = new Date(this.data.selectedDate);
    d.setDate(d.getDate() + 1);
    this._loadDiaryByDate(logic.fmtDate(d));
  },
  onToggleCalendar() {
    this.setData({ showCalendar: !this.data.showCalendar });
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
    const v = e.detail.value;
    const [y, m] = v.split('-').map(n => parseInt(n, 10));
    this._buildCalendar(y, m - 1);
  },
  onCalendarCellTap(e) {
    const date = e.currentTarget.dataset.date;
    if (!date) return;
    this._loadDiaryByDate(date);
    this.setData({ showCalendar: false });
    const [y, m] = date.split('-').map(n => parseInt(n, 10));
    if (y !== this.data.calendarYear || (m - 1) !== this.data.calendarMonth) {
      this._buildCalendar(y, m - 1);
    }
  },
  onJumpToday() {
    this._loadDiaryByDate(this.data.todayStr);
    const d = new Date();
    this._buildCalendar(d.getFullYear(), d.getMonth());
    this.setData({ showCalendar: false });
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
      selectedDateLabel: `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK_DAYS[d.getDay()]}`,
      diaryContent: e ? (e.content || '') : '',
      currentMood: e ? (e.mood || 'good') : 'good',
      currentTags: tags,
      wcNum: e ? (e.content || '').length : 0
    });
    this._buildCalendar(this.data.calendarYear, this.data.calendarMonth);
  },

  refreshView() {
    const state = this._app.getState();
    const stats = logic.diaryStats(state.diary.entries);
    this.setData({ statTotal: stats.total });
    if (!this.data.selectedDate) {
      this._loadDiaryByDate(this.data.todayStr);
    } else {
      this._loadDiaryByDate(this.data.selectedDate);
    }
    this._refreshList();
  },

  _refreshList() {
    const state = this._app.getState();
    const list = (state.diary.entries || [])
      .slice()
      .sort((a, b) => a.date < b.date ? 1 : (a.date > b.date ? -1 : 0))
      .slice(0, 50)
      .map(e => {
        const m = MOODS.find(x => x.key === e.mood) || MOODS[1];
        const preview = (e.content || '').length > 80 ? (e.content || '').slice(0, 80) + '...' : (e.content || '');
        const d = new Date(e.date);
        return {
          date: e.date,
          moodIcon: m.icon,
          dateLabel: `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK_DAYS[d.getDay()]}`,
          preview
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

  onSaveDiary() {
    const state = this._app.getState();
    const date = this.data.selectedDate || this.data.todayStr;
    const tags = Object.keys(this.data.currentTags);
    const r = logic.saveDiary(state, date, this.data.diaryContent, this.data.currentMood, tags);
    if (r.error) { this.toast(r.error); return; }
    this._app.globalData.state = r.state;
    this._app.saveData().then(res => {
      if (!res || !res.ok) {
        this.toast('同步失败，请检查网络');
      } else if (res.partial) {
        this.toast('已保存（部分同步失败）');
      } else {
        this.toast('日记已保存');
      }
    });
    this.refreshView();
  },

  onDiaryItemClick(e) {
    const date = e.currentTarget.dataset.date;
    this._loadDiaryByDate(date);
    wx.pageScrollTo({ scrollTop: 0, duration: 200 });
  },

  onFabTap() {
    this.onSaveDiary();
  }
});
