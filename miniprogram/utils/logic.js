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
  mergeWithCloud
};
