// utils/supabase.js
// Supabase REST API 封装（多表存数据）
//
// 数据按业务拆分到 8 张表（PostgreSQL snake_case 字段）：
//   meds_bottles      主键 (user_id, id)            药瓶
//   meds_checkins     主键 (user_id, date)          打卡记录
//   meds_settings     主键 (user_id)                吃药设置（单行 per user）
//   diary_entries     主键 (user_id, date)          日记条目
//   work_tasks        主键 (user_id, id)            工作任务
//   study_plans       主键 (user_id, id)            学习计划
//   life_moments      主键 (user_id, id)            生活记录
//   review_entries    主键 (user_id, id)            复盘记录
//
// REST 端点：
//   GET  {URL}/rest/v1/{table}?user_id=eq.{uid}
//   POST {URL}/rest/v1/{table}  (upsert via Prefer header)
//
// 必需 Headers：
//   apikey: <anon_key>
//   Authorization: Bearer <anon_key>
//   Content-Type: application/json
//   Prefer: return=representation; resolution=merge-duplicates  (upsert)

const logic = require('./logic.js');

const SUPABASE_URL = 'https://cszkekdciqgimsvfgons.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_EgAro7H2v76ZHWTbzeN0vA_SToYDLgx';
const SYNC_USER_ID = 'default';

// 多表定义
const TABLES = {
  bottles: 'meds_bottles',
  checkins: 'meds_checkins',
  settings: 'meds_settings',
  diary: 'diary_entries',
  work: 'work_tasks',
  study: 'study_plans',
  life: 'life_moments',
  review: 'review_entries'
};

let syncEnabled = !!SUPABASE_ANON_KEY;

// 真正发请求：小程序用 wx.request；Node 单测用注入的 mockFetch
let mockFetch = null;
function _http(options) {
  if (mockFetch) return mockFetch(options);
  return new Promise((resolve, reject) => {
    if (typeof wx === 'undefined' || !wx.request) {
      reject(new Error('wx.request unavailable'));
      return;
    }
    wx.request({
      url: options.url,
      method: options.method || 'GET',
      data: options.data,
      header: options.header,
      timeout: options.timeout || 10000,
      success: (res) => {
        // 详细日志，便于体验版 vConsole 排查
        console.log('[supabase]', options.method, options.url, '->', res.statusCode);
        resolve(res);
      },
      fail: (err) => {
        console.error('[supabase] 请求失败:', options.method, options.url, err);
        reject(new Error('wx.request fail: ' + (err && err.errMsg ? err.errMsg : 'unknown')));
      }
    });
  });
}

function _headers(extra) {
  return Object.assign({
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
    'Content-Type': 'application/json'
  }, extra || {});
}

// === state ↔ 各表行的转换 ===
function _stateToRows(state) {
  const uid = SYNC_USER_ID;
  const now = new Date().toISOString();
  const s = state || {};
  const meds = s.meds || {};
  const diary = s.diary || {};
  const work = s.work || {};
  const study = s.study || {};
  const life = s.life || {};
  const review = s.review || {};
  return {
    bottles: (meds.bottles || []).map(b => ({
      user_id: uid,
      id: b.id,
      bottle_number: b.bottleNumber,
      total_pills: b.totalPills,
      remaining_pills: b.remainingPills,
      start_date: b.startDate,
      is_active: !!b.isActive,
      created_at: b.createdAt || now,
      updated_at: b.updatedAt || now
    })),
    checkins: (meds.checkins || []).map(c => ({
      user_id: uid,
      date: c.date,
      bottle_id: c.bottleId,
      taken: !!c.taken,
      timestamp: c.timestamp,
      updated_at: c.timestamp || now
    })),
    settings: [{
      user_id: uid,
      reminder_time: (meds.settings || {}).reminderTime,
      notification_enabled: !!(meds.settings || {}).notificationEnabled,
      low_threshold: (meds.settings || {}).lowThreshold,
      pills_per_day: (meds.settings || {}).pillsPerDay,
      updated_at: now
    }],
    diary: (diary.entries || []).map(e => ({
      user_id: uid,
      id: e.id,
      date: e.date,
      content: e.content,
      mood: e.mood,
      tags: Array.isArray(e.tags) ? e.tags : [],
      created_at: e.createdAt || now,
      updated_at: e.updatedAt || now
    })),
    work: (work.tasks || []).map(t => ({
      user_id: uid,
      id: t.id,
      title: t.title,
      done: !!t.done,
      priority: t.priority,
      due_date: t.dueDate,
      created_at: t.createdAt || now,
      updated_at: t.updatedAt || now
    })),
    study: (study.plans || []).map(p => ({
      user_id: uid,
      id: p.id,
      subject: p.subject,
      content: p.content,
      duration_min: p.durationMin,
      completed: !!p.completed,
      date: p.date,
      created_at: p.createdAt || now,
      updated_at: p.updatedAt || now
    })),
    life: (life.moments || []).map(m => ({
      user_id: uid,
      id: m.id,
      content: m.content,
      mood: m.mood,
      tags: Array.isArray(m.tags) ? m.tags : [],
      date: m.date,
      created_at: m.createdAt || now,
      updated_at: m.updatedAt || now
    })),
    review: (review.entries || []).map(r => ({
      user_id: uid,
      id: r.id,
      period_type: r.periodType,
      period_start: r.periodStart,
      period_end: r.periodEnd,
      content: r.content,
      rating: r.rating,
      tags: Array.isArray(r.tags) ? r.tags : [],
      created_at: r.createdAt || now,
      updated_at: r.updatedAt || now
    }))
  };
}

function _rowsToState(rows) {
  const settingsRow = (rows.settings && rows.settings[0]) || {};
  return logic.reconcile({
    meds: {
      bottles: ((rows.bottles || []).map(r => ({
        id: r.id,
        bottleNumber: r.bottle_number,
        totalPills: r.total_pills,
        remainingPills: r.remaining_pills,
        startDate: r.start_date,
        isActive: !!r.is_active,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      })).sort((a, b) => (Number(a.bottleNumber) || 0) - (Number(b.bottleNumber) || 0))),
      checkins: (rows.checkins || []).map(r => ({
        date: r.date,
        bottleId: r.bottle_id,
        taken: !!r.taken,
        timestamp: r.timestamp
      })).sort((a, b) => a.date < b.date ? -1 : (a.date > b.date ? 1 : 0)),
      settings: {
        reminderTime: typeof settingsRow.reminder_time === 'string' ? settingsRow.reminder_time : '08:00',
        notificationEnabled: !!settingsRow.notification_enabled,
        lowThreshold: (typeof settingsRow.low_threshold === 'number' && isFinite(settingsRow.low_threshold)) ? settingsRow.low_threshold : 5,
        pillsPerDay: (typeof settingsRow.pills_per_day === 'number' && isFinite(settingsRow.pills_per_day)) ? settingsRow.pills_per_day : 1
      }
    },
    diary: {
      entries: (rows.diary || []).map(r => ({
        id: r.id,
        date: r.date,
        content: r.content,
        mood: r.mood,
        tags: Array.isArray(r.tags) ? r.tags : [],
        createdAt: r.created_at,
        updatedAt: r.updated_at
      })).sort((a, b) => a.date < b.date ? 1 : (a.date > b.date ? -1 : 0))
    },
    work: {
      tasks: (rows.work || []).map(r => ({
        id: r.id,
        title: r.title,
        done: !!r.done,
        priority: r.priority,
        dueDate: r.due_date,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      })).sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0))
    },
    study: {
      plans: (rows.study || []).map(r => ({
        id: r.id,
        subject: r.subject,
        content: r.content,
        durationMin: r.duration_min,
        completed: !!r.completed,
        date: r.date,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      })).sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0))
    },
    life: {
      moments: (rows.life || []).map(r => ({
        id: r.id,
        content: r.content,
        mood: r.mood,
        tags: Array.isArray(r.tags) ? r.tags : [],
        date: r.date,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      })).sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0))
    },
    review: {
      entries: (rows.review || []).map(r => ({
        id: r.id,
        periodType: r.period_type,
        periodStart: r.period_start,
        periodEnd: r.period_end,
        content: r.content,
        rating: r.rating,
        tags: Array.isArray(r.tags) ? r.tags : [],
        createdAt: r.created_at,
        updatedAt: r.updated_at
      })).sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0))
    }
  });
}

// === 表级 REST 操作 ===
async function _upsertTable(table, rows) {
  if (!rows || !rows.length) return { table, count: 0 };
  const url = SUPABASE_URL + '/rest/v1/' + table;
  const res = await _http({
    url: url,
    method: 'POST',
    data: rows,
    header: _headers({
      'Prefer': 'return=representation, resolution=merge-duplicates'
    })
  });
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error('HTTP ' + res.statusCode + ' ' + JSON.stringify(res.data).slice(0, 200));
  }
  return { table, count: rows.length };
}

async function _fetchTable(table) {
  const url = SUPABASE_URL + '/rest/v1/' + table + '?user_id=eq.' + encodeURIComponent(SYNC_USER_ID);
  const res = await _http({
    url: url,
    method: 'GET',
    header: _headers({ 'Accept': 'application/json' })
  });
  if (res.statusCode !== 200) throw new Error('HTTP ' + res.statusCode);
  return Array.isArray(res.data) ? res.data : [];
}

// 取一行 updated_at 的毫秒时间戳
function _rowTs(r) {
  return r && r.updated_at ? new Date(r.updated_at).getTime() || 0 : 0;
}

async function pushToCloud(state) {
  if (!syncEnabled) return { ok: false, reason: 'disabled' };
  const app = typeof getApp === 'function' ? getApp() : null;
  if (app && app._setSyncStatus) app._setSyncStatus('syncing');
  try {
    const rows = _stateToRows(state);
    // 并发推送 8 张表（空数组不发请求）。用 allSettled 容错：
    // 单表失败（如表不存在/权限）不阻断其他表，避免整体失败导致用户以为没保存
    const settled = await Promise.allSettled([
      _upsertTable(TABLES.bottles, rows.bottles),
      _upsertTable(TABLES.checkins, rows.checkins),
      _upsertTable(TABLES.settings, rows.settings),
      _upsertTable(TABLES.diary, rows.diary),
      _upsertTable(TABLES.work, rows.work),
      _upsertTable(TABLES.study, rows.study),
      _upsertTable(TABLES.life, rows.life),
      _upsertTable(TABLES.review, rows.review)
    ]);
    const failures = settled.filter(r => r.status === 'rejected');
    const okCount = settled.length - failures.length;
    if (failures.length) {
      console.warn('[sync] push 部分失败:', failures.length + '/' + settled.length,
        failures.map(f => f.reason && f.reason.message).join('|'));
    }
    // 只要有一张表写成功就认为部分成功，避免完全失败时让用户重试覆盖数据
    if (okCount === 0) {
      if (app && app._setSyncStatus) app._setSyncStatus('offline');
      return { ok: false, reason: 'all-failed', errors: failures.map(f => f.reason) };
    }
    if (app && app._setSyncStatus) app._setSyncStatus('synced');
    return { ok: true, partial: failures.length > 0, pushed: settled };
  } catch (e) {
    console.warn('[sync] push fail', e && e.message);
    if (app && app._setSyncStatus) app._setSyncStatus('offline');
    return { ok: false, reason: 'error', error: e };
  }
}

// === 拉取 ===
// 按表合并：云端某表空时保留本地该表数据，避免整体覆盖导致本地数据丢失
function _mergeTable(cloudRows, localRows) {
  if (!cloudRows || !cloudRows.length) return localRows || [];
  if (!localRows || !localRows.length) return cloudRows;
  // 都有数据：按主键合并，冲突时取 updated_at 较大者
  const byKey = new Map();
  const keyOf = (r) => r.user_id + '|' + (r.date != null ? r.date : r.id);
  localRows.forEach(r => byKey.set(keyOf(r), r));
  cloudRows.forEach(r => {
    const k = keyOf(r);
    const exist = byKey.get(k);
    if (!exist || _rowTs(r) > _rowTs(exist)) byKey.set(k, r);
  });
  return Array.from(byKey.values());
}

async function pullFromCloud() {
  if (!syncEnabled) return { ok: false, reason: 'disabled' };
  const app = typeof getApp === 'function' ? getApp() : null;
  if (app && app._setSyncStatus) app._setSyncStatus('syncing');
  try {
    // 用 allSettled 容错：单表失败（如表不存在/网络）不阻断其他表
    // 否则 8 张表中任意一张 404 会让整个 Promise.all reject，导致 state 保持空默认值，
    // 用户重启小程序后看不到任何已保存数据
    const settled = await Promise.allSettled([
      _fetchTable(TABLES.bottles),
      _fetchTable(TABLES.checkins),
      _fetchTable(TABLES.settings),
      _fetchTable(TABLES.diary),
      _fetchTable(TABLES.work),
      _fetchTable(TABLES.study),
      _fetchTable(TABLES.life),
      _fetchTable(TABLES.review)
    ]);
    const bottles  = settled[0].status === 'fulfilled' ? settled[0].value : [];
    const checkins = settled[1].status === 'fulfilled' ? settled[1].value : [];
    const settings = settled[2].status === 'fulfilled' ? settled[2].value : [];
    const diary    = settled[3].status === 'fulfilled' ? settled[3].value : [];
    const work     = settled[4].status === 'fulfilled' ? settled[4].value : [];
    const study    = settled[5].status === 'fulfilled' ? settled[5].value : [];
    const life     = settled[6].status === 'fulfilled' ? settled[6].value : [];
    const review   = settled[7].status === 'fulfilled' ? settled[7].value : [];

    const failures = settled.filter(r => r.status === 'rejected');
    if (failures.length) {
      console.warn('[sync] pull 部分失败:', failures.length + '/' + settled.length,
        failures.map(f => f.reason && f.reason.message).join('|'));
    }

    // 本地 state 直接取内存中的（app.globalData.state），不再读 storage
    const localState = (app && app.globalData && app.globalData.state) || logic.clone(logic.DEFAULT_DATA);
    const localRows = _stateToRows(localState);

    // 按表合并：云端空则保留本地，都有时按主键合并 + 时间戳取新
    const merged = {
      bottles: _mergeTable(bottles, localRows.bottles),
      checkins: _mergeTable(checkins, localRows.checkins),
      settings: settings.length ? settings : localRows.settings,
      diary: _mergeTable(diary, localRows.diary),
      work: _mergeTable(work, localRows.work),
      study: _mergeTable(study, localRows.study),
      life: _mergeTable(life, localRows.life),
      review: _mergeTable(review, localRows.review)
    };

    const mergedState = _rowsToState(merged);
    if (app && app.globalData) app.globalData.state = mergedState;

    // 若本地有云端没有的数据，把合并后的 state 推上去补齐云端
    const hasLocalOnlyData =
      (!bottles.length && localRows.bottles.length) ||
      (!checkins.length && localRows.checkins.length) ||
      (!diary.length && localRows.diary.length) ||
      (!work.length && localRows.work.length) ||
      (!study.length && localRows.study.length) ||
      (!life.length && localRows.life.length) ||
      (!review.length && localRows.review.length);
    if (hasLocalOnlyData) {
      await pushToCloud(mergedState);
    }

    if (app && app._setSyncStatus) app._setSyncStatus('synced');
    return { ok: true, source: 'merged', state: mergedState, partial: failures.length > 0 };
  } catch (e) {
    console.warn('[sync] pull fail', e && e.message);
    if (app && app._setSyncStatus) app._setSyncStatus('offline');
    return { ok: false, reason: 'error', error: e };
  }
}

// 单测注入
function _injectMockFetch(fn) { mockFetch = fn; }
function _resetMockFetch() { mockFetch = null; }
function _setSyncEnabled(v) { syncEnabled = !!v; }

module.exports = {
  SUPABASE_URL,
  TABLES,
  SYNC_USER_ID,
  pushToCloud,
  pullFromCloud,
  _stateToRows,
  _rowsToState,
  _injectMockFetch,
  _resetMockFetch,
  _setSyncEnabled,
  _isSyncEnabled: () => syncEnabled
};
