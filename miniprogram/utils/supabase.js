// utils/supabase.js
// Supabase REST API 封装（多表存数据）
//
// 数据按业务拆分到 4 张表（PostgreSQL snake_case 字段）：
//   meds_bottles   主键 (user_id, id)            药瓶
//   meds_checkins  主键 (user_id, date)          打卡记录
//   meds_settings  主键 (user_id)                吃药设置（单行 per user）
//   diary_entries  主键 (user_id, date)          日记条目
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
const storage = require('./storage.js');

const SUPABASE_URL = 'https://cszkekdciqgimsvfgons.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_EgAro7H2v76ZHWTbzeN0vA_SToYDLgx';
const SYNC_USER_ID = 'default';

// 多表定义
const TABLES = {
  bottles: 'meds_bottles',
  checkins: 'meds_checkins',
  settings: 'meds_settings',
  diary: 'diary_entries'
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
      success: (res) => resolve(res),
      fail: (err) => reject(err)
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

// === 推送（防抖 800ms） ===
let _pushTimer = null;
function pushDebounced(state) {
  if (!syncEnabled) return Promise.resolve();
  if (_pushTimer) clearTimeout(_pushTimer);
  return new Promise((resolve) => {
    _pushTimer = setTimeout(() => {
      pushToCloud(state).then(resolve).catch(() => resolve());
    }, 800);
  });
}

async function pushToCloud(state) {
  if (!syncEnabled) return { ok: false, reason: 'disabled' };
  const app = typeof getApp === 'function' ? getApp() : null;
  if (app && app._setSyncStatus) app._setSyncStatus('syncing');
  try {
    const rows = _stateToRows(state);
    // 并发推送 4 张表
    const results = await Promise.all([
      _upsertTable(TABLES.bottles, rows.bottles),
      _upsertTable(TABLES.checkins, rows.checkins),
      _upsertTable(TABLES.settings, rows.settings),
      _upsertTable(TABLES.diary, rows.diary)
    ]);
    const now = new Date().toISOString();
    storage.writeSyncMeta({ updatedAt: now });
    if (app && app._setSyncStatus) app._setSyncStatus('synced');
    return { ok: true, pushed: results };
  } catch (e) {
    console.warn('[sync] push fail', e && e.message);
    if (app && app._setSyncStatus) app._setSyncStatus('offline');
    return { ok: false, reason: 'error', error: e };
  }
}

// === 拉取 ===
async function pullFromCloud() {
  if (!syncEnabled) return { ok: false, reason: 'disabled' };
  const app = typeof getApp === 'function' ? getApp() : null;
  if (app && app._setSyncStatus) app._setSyncStatus('syncing');
  try {
    const [bottles, checkins, settings, diary] = await Promise.all([
      _fetchTable(TABLES.bottles),
      _fetchTable(TABLES.checkins),
      _fetchTable(TABLES.settings),
      _fetchTable(TABLES.diary)
    ]);

    const rows = { bottles, checkins, settings, diary };

    // 云端最新时间戳（取 4 张表中最大 updated_at）
    const cloudTs = Math.max(
      ...bottles.map(_rowTs),
      ...checkins.map(_rowTs),
      ...settings.map(_rowTs),
      ...diary.map(_rowTs),
      0
    );

    const localState = (app && app.globalData && app.globalData.state) || storage.loadData();
    const localMeta = storage.readSyncMeta();
    const localTs = localMeta.updatedAt ? new Date(localMeta.updatedAt).getTime() : 0;

    const hasCloudData = bottles.length || checkins.length || settings.length || diary.length;

    if (hasCloudData && cloudTs > localTs) {
      // 云端较新：覆盖本地
      const cloudState = _rowsToState(rows);
      if (app && app.globalData) app.globalData.state = cloudState;
      storage.saveData(cloudState);
      storage.writeSyncMeta({ updatedAt: new Date(cloudTs).toISOString() });
      if (app && app._setSyncStatus) app._setSyncStatus('synced');
      return { ok: true, source: 'cloud', state: cloudState };
    }

    // 本地较新或云端无数据：推送本地
    await pushToCloud(localState);
    return { ok: true, source: 'local' };
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
  pushDebounced,
  pushToCloud,
  pullFromCloud,
  _stateToRows,
  _rowsToState,
  _injectMockFetch,
  _resetMockFetch,
  _setSyncEnabled,
  _isSyncEnabled: () => syncEnabled
};
