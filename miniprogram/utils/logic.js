// utils/logic.js
// 核心业务纯函数（不依赖小程序运行时，便于 Node 单测）
// 所有函数都不直接修改入参，返回新状态或新值

const DEFAULT_DATA = {
  meds: {
    bottles: [],
    checkins: [],
    settings: { reminderTime: '08:00', notificationEnabled: false, lowThreshold: 5, pillsPerDay: 1 }
  },
  diary: {
    entries: []   // { id, date, content, mood, tags, createdAt, updatedAt }
  },
  work: {
    tasks: []     // { id, title, done, priority, dueDate, createdAt, updatedAt }
  },
  study: {
    plans: []      // { id, subject, content, durationMin, completed, date, createdAt, updatedAt }
  },
  life: {
    moments: []    // { id, content, mood, tags, date, createdAt, updatedAt }
  },
  review: {
    entries: []    // { id, periodType, periodStart, periodEnd, content, rating, tags, createdAt, updatedAt }
  }
};

// 深拷贝（小程序/Node 都可用，避免 structuredClone 兼容问题）
function clone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (typeof structuredClone === 'function') {
    try { return structuredClone(obj); } catch (e) {}
  }
  return JSON.parse(JSON.stringify(obj));
}

// 数据补全（兼容旧版/损坏数据）
function reconcile(p) {
  if (!p || typeof p !== 'object') return clone(DEFAULT_DATA);
  if (!p.meds || typeof p.meds !== 'object') p.meds = clone(DEFAULT_DATA.meds);
  if (!Array.isArray(p.meds.bottles)) p.meds.bottles = [];
  if (!Array.isArray(p.meds.checkins)) p.meds.checkins = [];
  if (!p.meds.settings || typeof p.meds.settings !== 'object') p.meds.settings = clone(DEFAULT_DATA.meds.settings);
  else {
    const d = DEFAULT_DATA.meds.settings;
    if (typeof p.meds.settings.reminderTime !== 'string') p.meds.settings.reminderTime = d.reminderTime;
    if (typeof p.meds.settings.notificationEnabled !== 'boolean') p.meds.settings.notificationEnabled = d.notificationEnabled;
    if (typeof p.meds.settings.lowThreshold !== 'number' || !isFinite(p.meds.settings.lowThreshold)) p.meds.settings.lowThreshold = d.lowThreshold;
    if (typeof p.meds.settings.pillsPerDay !== 'number' || !isFinite(p.meds.settings.pillsPerDay)) p.meds.settings.pillsPerDay = d.pillsPerDay;
  }
  if (!p.diary || typeof p.diary !== 'object') p.diary = { entries: [] };
  if (!Array.isArray(p.diary.entries)) p.diary.entries = [];
  // 新增模块（work/study/life/review）补全
  if (!p.work || typeof p.work !== 'object') p.work = { tasks: [] };
  if (!Array.isArray(p.work.tasks)) p.work.tasks = [];
  if (!p.study || typeof p.study !== 'object') p.study = { plans: [] };
  if (!Array.isArray(p.study.plans)) p.study.plans = [];
  if (!p.life || typeof p.life !== 'object') p.life = { moments: [] };
  if (!Array.isArray(p.life.moments)) p.life.moments = [];
  if (!p.review || typeof p.review !== 'object') p.review = { entries: [] };
  if (!Array.isArray(p.review.entries)) p.review.entries = [];
  return p;
}

// 当前激活瓶（无激活则取最后一瓶，无则 null）
function activeBottle(state) {
  const bs = state.meds.bottles;
  if (!bs.length) return null;
  return bs.find(b => b.isActive) || bs[bs.length - 1];
}

// 估算吃完日期
function estFinishDate(b, pillsPerDay) {
  if (!b) return '—';
  const perDay = Math.max(1, pillsPerDay || 1);
  const remain = Math.max(0, Number(b.remainingPills) || 0);
  const days = Math.ceil(remain / perDay);
  if (days <= 0) return '今天';
  const d = new Date();
  d.setDate(d.getDate() + days);
  return (d.getMonth() + 1) + '月' + d.getDate() + '日';
}

// 打卡连续天数
function calcMedsStreak(checkins, todayStr) {
  const set = new Set((checkins || []).filter(c => c && c.taken && c.date).map(c => c.date));
  let s = 0;
  const d = new Date();
  // todayStr 形如 'YYYY-MM-DD'
  if (!set.has(todayStr)) d.setDate(d.getDate() - 1);
  let cur = fmtDate(d);
  while (set.has(cur)) {
    s++;
    d.setDate(d.getDate() - 1);
    cur = fmtDate(d);
  }
  return s;
}

// 日记连续天数
function calcDiaryStreak(entries, todayStr) {
  const set = new Set((entries || []).filter(e => e && e.date).map(e => e.date));
  let s = 0;
  const d = new Date();
  if (!set.has(todayStr)) d.setDate(d.getDate() - 1);
  let cur = fmtDate(d);
  while (set.has(cur)) {
    s++;
    d.setDate(d.getDate() - 1);
    cur = fmtDate(d);
  }
  return s;
}

// 格式化日期 YYYY-MM-DD（本地时区）
function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

// ISO 时间串
function nowISO() { return new Date().toISOString(); }

// === 打卡 ===
// 返回 { state: newState, action: 'checkin' | 'cancel', bottle }
function toggleCheckin(state, todayStr) {
  const s = clone(state);
  let b = activeBottle(s);
  if (!b) return { state: s, action: 'noBottle', bottle: null };
  let rec = s.meds.checkins.find(c => c.date === todayStr);
  const perDay = Math.max(1, s.meds.settings.pillsPerDay || 1);
  if (rec && rec.taken) {
    // 取消打卡：药量回补（不超过 totalPills）
    rec.taken = false;
    rec.timestamp = nowISO();
    b.remainingPills = Math.min(Number(b.totalPills) || 0, (Number(b.remainingPills) || 0) + perDay);
    return { state: s, action: 'cancel', bottle: b };
  }
  // 打卡：扣药（不低于 0）
  if (!rec) {
    rec = { date: todayStr, bottleId: b.id, taken: false, timestamp: nowISO() };
    s.meds.checkins.push(rec);
  }
  rec.taken = true;
  rec.bottleId = b.id;
  rec.timestamp = nowISO();
  b.remainingPills = Math.max(0, (Number(b.remainingPills) || 0) - perDay);
  return { state: s, action: 'checkin', bottle: b };
}

// === 开新瓶 ===
// 全局递增计数器，保证 id 绝对唯一（高频创建也不撞）
// 用 Date.now() 作起点 + 严格递增，不混入 random（random 会抵消 seq 的单调性）
let _idCounter = Date.now();
function _genId() {
  _idCounter = _idCounter + 1;
  return _idCounter;
}
// 基于已有记录的最大 id 校准 _idCounter，避免重启后 id 冲突导致 upsert 插入重复行
function _bumpIdCounter(existingIds) {
  for (let i = 0; i < existingIds.length; i++) {
    const n = Number(existingIds[i]);
    if (!isNaN(n) && n >= _idCounter) _idCounter = n;
  }
}
function newBottle(state, todayStr, opts) {
  opts = opts || {};
  const s = clone(state);
  const last = s.meds.bottles[s.meds.bottles.length - 1];
  const nextNo = last ? (Number(last.bottleNumber) || 0) + 1 : 1;
  // 用已有 bottle 的最大 id 校准计数器，确保新 id 大于所有现有 id
  _bumpIdCounter(s.meds.bottles.map(b => b.id));
  s.meds.bottles.forEach(b => { b.isActive = false; });
  const totalPills = Math.max(0, Number(opts.totalPills) || 30);
  const remainingPills = Math.max(0, Number(opts.remainingPills != null ? opts.remainingPills : totalPills));
  s.meds.bottles.push({
    id: _genId(),
    bottleNumber: nextNo,
    totalPills,
    remainingPills,
    startDate: todayStr,
    isActive: true,
    createdAt: nowISO()
  });
  return { state: s, bottleNumber: nextNo };
}

// === 修改余量（同时支持修改瓶号） ===
function savePills(state, todayStr, params) {
  const s = clone(state);
  const no = parseInt(params.bottleNo, 10);
  const pills = parseInt(params.pills, 10);
  if (isNaN(no) || no < 1) return { state: s, error: '瓶号不能小于 1' };
  if (isNaN(pills) || pills < 0) return { state: s, error: '剩余药片数不能为负数' };
  if (pills > 9999) return { state: s, error: '药片数超出合理范围' };

  let b = activeBottle(s);
  if (!b) {
    s.meds.bottles.forEach(x => { x.isActive = false; });
    b = {
      id: _genId(),
      bottleNumber: no,
      totalPills: Math.max(30, pills),
      remainingPills: pills,
      startDate: todayStr,
      isActive: true,
      createdAt: nowISO()
    };
    s.meds.bottles.push(b);
  } else {
    b.bottleNumber = no;
    b.remainingPills = pills;
    if (pills > (Number(b.totalPills) || 0)) b.totalPills = pills;
  }
  return { state: s, error: null };
}

// === 设置更新（带校验） ===
function updateSettings(state, patch) {
  const s = clone(state);
  const set = s.meds.settings;
  if (patch.reminderTime != null) {
    const m = /^(\d{2}):(\d{2})$/.exec(patch.reminderTime);
    if (m) {
      const hh = parseInt(m[1], 10), mm = parseInt(m[2], 10);
      if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) set.reminderTime = patch.reminderTime;
    }
  }
  if (patch.pillsPerDay != null) {
    const v = parseInt(patch.pillsPerDay, 10);
    if (!isNaN(v) && v >= 1 && v <= 10) set.pillsPerDay = v;
  }
  if (patch.lowThreshold != null) {
    const v = parseInt(patch.lowThreshold, 10);
    if (!isNaN(v) && v >= 1 && v <= 999) set.lowThreshold = v;
  }
  if (typeof patch.notificationEnabled === 'boolean') {
    set.notificationEnabled = patch.notificationEnabled;
  }
  return s;
}

// === 日记保存 ===
function saveDiary(state, dateStr, content, mood, tags) {
  const s = clone(state);
  const c = (content || '').trim();
  if (!c) return { state: s, error: '日记内容不能为空' };
  let e = s.diary.entries.find(x => x.date === dateStr);
  const now = nowISO();
  if (e) {
    e.content = c;
    e.mood = mood || 'good';
    e.tags = Array.isArray(tags) ? tags.slice() : [];
    e.updatedAt = now;
  } else {
    // 用已有日记的最大 id 校准计数器，避免重启后 id 冲突
    _bumpIdCounter(s.diary.entries.map(x => x.id));
    e = {
      id: _genId(),
      date: dateStr,
      content: c,
      mood: mood || 'good',
      tags: Array.isArray(tags) ? tags.slice() : [],
      createdAt: now,
      updatedAt: now
    };
    s.diary.entries.push(e);
  }
  return { state: s, error: null };
}

// === 日记删除 ===
function deleteDiary(state, dateStr) {
  const s = clone(state);
  s.diary.entries = s.diary.entries.filter(x => x.date !== dateStr);
  return s;
}

// === 日记搜索 ===
function searchDiary(entries, kw) {
  const k = (kw || '').trim().toLowerCase();
  let list = (entries || []).slice().sort((a, b) => a.date < b.date ? 1 : -1);
  if (k) {
    list = list.filter(e =>
      (e.content || '').toLowerCase().includes(k) ||
      (e.tags || []).some(t => String(t).toLowerCase().includes(k))
    );
  }
  return list;
}

// === 统计 ===
function diaryStats(entries) {
  const arr = entries || [];
  return {
    total: arr.length,
    words: arr.reduce((s, e) => s + (e.content ? e.content.length : 0), 0)
  };
}

// === 历史：打卡列表（已排序，限制条数） ===
function recentCheckins(checkins, limit) {
  limit = limit || 60;
  return (checkins || []).slice().sort((a, b) => a.date < b.date ? 1 : -1).slice(0, limit);
}

// === 历史：瓶次列表（已排序） ===
function sortedBottles(bottles) {
  return (bottles || []).slice().sort((a, b) => (Number(b.bottleNumber) || 0) - (Number(a.bottleNumber) || 0));
}

// === 环形进度计算 ===
function ringPercent(b) {
  if (!b) return 0;
  const total = Number(b.totalPills) || 0;
  const remain = Math.max(0, Number(b.remainingPills) || 0);
  if (total <= 0) return 0;
  const pct = Math.round((remain / total) * 100);
  return Math.max(0, Math.min(100, pct));
}

// === 合并云端与本地数据（按 updatedAt 后写覆盖） ===
// 返回 { state, source: 'local' | 'cloud' | 'equal' }
function mergeWithCloud(localState, cloudData, cloudUpdatedAt, localUpdatedAt) {
  const cloudTs = cloudUpdatedAt ? new Date(cloudUpdatedAt).getTime() : 0;
  const localTs = localUpdatedAt ? new Date(localUpdatedAt).getTime() : 0;
  if (cloudTs > localTs) {
    return { state: reconcile(cloudData), source: 'cloud' };
  }
  return { state: localState, source: 'local' };
}

// ============================================================
// 日记日期选择辅助：按日期读取 / 区间列表 / 月份有日记的日期集合
// ============================================================

// 取某天的日记（无则返回 null）
function getDiaryByDate(state, dateStr) {
  if (!state || !state.diary || !Array.isArray(state.diary.entries)) return null;
  return state.diary.entries.find(x => x.date === dateStr) || null;
}

// 列出 [start, end] 闭区间内的日记，按日期降序
function listDiaryByRange(entries, startDate, endDate) {
  return (entries || [])
    .filter(e => (!startDate || e.date >= startDate) && (!endDate || e.date <= endDate))
    .sort((a, b) => a.date < b.date ? 1 : (a.date > b.date ? -1 : 0));
}

// 返回某月（YYYY-MM）内有日记的日期集合 { 'YYYY-MM-DD': true }
function diaryMonthMap(entries, monthStr) {
  const map = {};
  (entries || []).forEach(e => {
    if (e.date && e.date.indexOf(monthStr) === 0) map[e.date] = true;
  });
  return map;
}

// ============================================================
// 通用条目工厂：add/update/delete（内部复用，避免重复造轮子）
// 各模块条目结构相似：{ id, ...fields, createdAt, updatedAt }
// ============================================================
function _addItem(arr, item) {
  _bumpIdCounter(arr.map(x => x.id));
  const now = nowISO();
  arr.push(Object.assign({ id: _genId(), createdAt: now, updatedAt: now }, item));
  return arr[arr.length - 1];
}
function _updateItem(arr, id, patch) {
  const it = arr.find(x => x.id === id);
  if (!it) return null;
  Object.assign(it, patch, { updatedAt: nowISO() });
  return it;
}
function _deleteItem(arr, id) {
  return arr.filter(x => x.id !== id);
}

// ============================================================
// 工作 Work：tasks [{ id, title, done, priority(1-3), dueDate, createdAt, updatedAt }]
// ============================================================
function addWorkTask(state, task) {
  const s = clone(state);
  const title = (task && task.title || '').trim();
  if (!title) return { state: s, error: '任务标题不能为空' };
  const priority = Math.max(1, Math.min(3, parseInt(task.priority, 10) || 1));
  const it = _addItem(s.work.tasks, {
    title,
    done: false,
    priority,
    dueDate: task.dueDate || ''
  });
  return { state: s, error: null, item: it };
}
function updateWorkTask(state, id, patch) {
  const s = clone(state);
  const p = {};
  if (patch.title != null) {
    const t = String(patch.title).trim();
    if (!t) return { state: s, error: '任务标题不能为空' };
    p.title = t;
  }
  if (patch.priority != null) {
    const v = parseInt(patch.priority, 10);
    if (isNaN(v) || v < 1 || v > 3) return { state: s, error: '优先级需为 1-3' };
    p.priority = v;
  }
  if (patch.dueDate != null) p.dueDate = String(patch.dueDate);
  if (typeof patch.done === 'boolean') p.done = patch.done;
  const it = _updateItem(s.work.tasks, id, p);
  if (!it) return { state: s, error: '任务不存在' };
  return { state: s, error: null, item: it };
}
function toggleWorkTask(state, id) {
  const s = clone(state);
  const it = s.work.tasks.find(x => x.id === id);
  if (!it) return { state: s, error: '任务不存在' };
  it.done = !it.done;
  it.updatedAt = nowISO();
  return { state: s, error: null, item: it };
}
function deleteWorkTask(state, id) {
  const s = clone(state);
  s.work.tasks = _deleteItem(s.work.tasks, id);
  return s;
}
function sortedWorkTasks(tasks) {
  // 未完成在前，按优先级降序；完成的在后
  return (tasks || []).slice().sort((a, b) => {
    if (!!a.done !== !!b.done) return a.done ? 1 : -1;
    const pa = Number(a.priority) || 1, pb = Number(b.priority) || 1;
    if (pb !== pa) return pb - pa;
    return (a.createdAt < b.createdAt) ? -1 : 1;
  });
}

// ============================================================
// 学习 Study：plans [{ id, subject, content, durationMin, completed, date, createdAt, updatedAt }]
// ============================================================
function addStudyPlan(state, plan) {
  const s = clone(state);
  const subject = (plan && plan.subject || '').trim();
  if (!subject) return { state: s, error: '学习主题不能为空' };
  const duration = Math.max(0, parseInt(plan.durationMin, 10) || 0);
  const it = _addItem(s.study.plans, {
    subject,
    content: (plan.content || '').trim(),
    durationMin: duration,
    completed: false,
    date: plan.date || fmtDate(new Date())
  });
  return { state: s, error: null, item: it };
}
function updateStudyPlan(state, id, patch) {
  const s = clone(state);
  const p = {};
  if (patch.subject != null) {
    const v = String(patch.subject).trim();
    if (!v) return { state: s, error: '学习主题不能为空' };
    p.subject = v;
  }
  if (patch.content != null) p.content = String(patch.content);
  if (patch.durationMin != null) {
    const v = parseInt(patch.durationMin, 10);
    if (isNaN(v) || v < 0) return { state: s, error: '时长需为非负数' };
    p.durationMin = v;
  }
  if (patch.date != null) p.date = String(patch.date);
  if (typeof patch.completed === 'boolean') p.completed = patch.completed;
  const it = _updateItem(s.study.plans, id, p);
  if (!it) return { state: s, error: '学习计划不存在' };
  return { state: s, error: null, item: it };
}
function toggleStudyPlan(state, id) {
  const s = clone(state);
  const it = s.study.plans.find(x => x.id === id);
  if (!it) return { state: s, error: '学习计划不存在' };
  it.completed = !it.completed;
  it.updatedAt = nowISO();
  return { state: s, error: null, item: it };
}
function deleteStudyPlan(state, id) {
  const s = clone(state);
  s.study.plans = _deleteItem(s.study.plans, id);
  return s;
}
function sortedStudyPlans(plans) {
  return (plans || []).slice().sort((a, b) => {
    if (!!a.completed !== !!b.completed) return a.completed ? 1 : -1;
    return (a.date < b.date) ? 1 : (a.date > b.date ? -1 : 0);
  });
}
function studyStats(plans) {
  const arr = plans || [];
  return {
    total: arr.length,
    done: arr.filter(x => x.completed).length,
    minutes: arr.reduce((s, x) => s + (Number(x.durationMin) || 0), 0)
  };
}

// ============================================================
// 生活 Life：moments [{ id, content, mood, tags, date, createdAt, updatedAt }]
// ============================================================
function addLifeMoment(state, moment) {
  const s = clone(state);
  const content = (moment && moment.content || '').trim();
  if (!content) return { state: s, error: '内容不能为空' };
  const it = _addItem(s.life.moments, {
    content,
    mood: moment.mood || 'good',
    tags: Array.isArray(moment.tags) ? moment.tags.slice() : [],
    date: moment.date || fmtDate(new Date())
  });
  return { state: s, error: null, item: it };
}
function updateLifeMoment(state, id, patch) {
  const s = clone(state);
  const p = {};
  if (patch.content != null) {
    const v = String(patch.content).trim();
    if (!v) return { state: s, error: '内容不能为空' };
    p.content = v;
  }
  if (patch.mood != null) p.mood = String(patch.mood);
  if (Array.isArray(patch.tags)) p.tags = patch.tags.slice();
  if (patch.date != null) p.date = String(patch.date);
  const it = _updateItem(s.life.moments, id, p);
  if (!it) return { state: s, error: '生活记录不存在' };
  return { state: s, error: null, item: it };
}
function deleteLifeMoment(state, id) {
  const s = clone(state);
  s.life.moments = _deleteItem(s.life.moments, id);
  return s;
}
function sortedLifeMoments(moments) {
  return (moments || []).slice().sort((a, b) => (a.date < b.date ? 1 : (a.date > b.date ? -1 : 0)));
}

// ============================================================
// 复盘 Review：entries [{ id, periodType('week'|'month'), periodStart, periodEnd, content, rating(1-5), tags, createdAt, updatedAt }]
// ============================================================
function addReviewEntry(state, entry) {
  const s = clone(state);
  const content = (entry && entry.content || '').trim();
  if (!content) return { state: s, error: '复盘内容不能为空' };
  const periodType = entry.periodType === 'month' ? 'month' : 'week';
  const rating = Math.max(1, Math.min(5, parseInt(entry.rating, 10) || 3));
  const it = _addItem(s.review.entries, {
    periodType,
    periodStart: entry.periodStart || '',
    periodEnd: entry.periodEnd || '',
    content,
    rating,
    tags: Array.isArray(entry.tags) ? entry.tags.slice() : []
  });
  return { state: s, error: null, item: it };
}
function updateReviewEntry(state, id, patch) {
  const s = clone(state);
  const p = {};
  if (patch.content != null) {
    const v = String(patch.content).trim();
    if (!v) return { state: s, error: '复盘内容不能为空' };
    p.content = v;
  }
  if (patch.periodType != null) p.periodType = patch.periodType === 'month' ? 'month' : 'week';
  if (patch.periodStart != null) p.periodStart = String(patch.periodStart);
  if (patch.periodEnd != null) p.periodEnd = String(patch.periodEnd);
  if (patch.rating != null) {
    const v = parseInt(patch.rating, 10);
    if (isNaN(v) || v < 1 || v > 5) return { state: s, error: '评分需为 1-5' };
    p.rating = v;
  }
  if (Array.isArray(patch.tags)) p.tags = patch.tags.slice();
  const it = _updateItem(s.review.entries, id, p);
  if (!it) return { state: s, error: '复盘不存在' };
  return { state: s, error: null, item: it };
}
function deleteReviewEntry(state, id) {
  const s = clone(state);
  s.review.entries = _deleteItem(s.review.entries, id);
  return s;
}
function sortedReviewEntries(entries) {
  // 按 periodEnd 降序，无则按 createdAt 降序
  return (entries || []).slice().sort((a, b) => {
    const ka = a.periodEnd || a.createdAt || '';
    const kb = b.periodEnd || b.createdAt || '';
    return ka < kb ? 1 : (ka > kb ? -1 : 0);
  });
}
function reviewStats(entries) {
  const arr = entries || [];
  const rated = arr.filter(x => x.rating);
  const avg = rated.length ? Math.round(rated.reduce((s, x) => s + Number(x.rating), 0) / rated.length * 10) / 10 : 0;
  return { total: arr.length, avgRating: avg };
}

// ============================================================
// 模块统计概览：给首页汇总每个模块的数字
// ============================================================
function moduleOverview(state) {
  const s = state || reconcile({});
  const today = fmtDate(new Date());
  const medStreak = calcMedsStreak(s.meds.checkins, today);
  const diaryStreak = calcDiaryStreak(s.diary.entries, today);
  return {
    meds: {
      streak: medStreak,
      remain: s.meds.bottles.length ? (logic_activeRemain(s) || 0) : 0
    },
    diary: {
      total: s.diary.entries.length,
      streak: diaryStreak,
      today: s.diary.entries.some(e => e.date === today)
    },
    work: {
      total: s.work.tasks.length,
      pending: s.work.tasks.filter(t => !t.done).length
    },
    study: {
      total: s.study.plans.length,
      done: s.study.plans.filter(t => t.completed).length
    },
    life: {
      total: s.life.moments.length,
      today: s.life.moments.some(m => m.date === today)
    },
    review: reviewStats(s.review.entries)
  };
}
function logic_activeRemain(s) {
  const b = activeBottle(s);
  return b ? Math.max(0, Number(b.remainingPills) || 0) : 0;
}

module.exports = {
  DEFAULT_DATA,
  clone,
  reconcile,
  activeBottle,
  estFinishDate,
  calcMedsStreak,
  calcDiaryStreak,
  fmtDate,
  nowISO,
  toggleCheckin,
  newBottle,
  savePills,
  updateSettings,
  saveDiary,
  deleteDiary,
  searchDiary,
  diaryStats,
  recentCheckins,
  sortedBottles,
  ringPercent,
  mergeWithCloud,
  // diary 日期选择
  getDiaryByDate,
  listDiaryByRange,
  diaryMonthMap,
  // work
  addWorkTask,
  updateWorkTask,
  toggleWorkTask,
  deleteWorkTask,
  sortedWorkTasks,
  // study
  addStudyPlan,
  updateStudyPlan,
  toggleStudyPlan,
  deleteStudyPlan,
  sortedStudyPlans,
  studyStats,
  // life
  addLifeMoment,
  updateLifeMoment,
  deleteLifeMoment,
  sortedLifeMoments,
  // review
  addReviewEntry,
  updateReviewEntry,
  deleteReviewEntry,
  sortedReviewEntries,
  reviewStats,
  // 首页概览
  moduleOverview
};
