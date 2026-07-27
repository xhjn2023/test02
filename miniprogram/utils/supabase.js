// utils/supabase.js
// Supabase REST API 封装（小程序 wx.request + Node 单测兼容）
//
// REST 端点：
//   GET  {URL}/rest/v1/{table}?user_id=eq.{uid}&select=data,updated_at
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
const SYNC_TABLE = 'workbench_state';
const SYNC_USER_ID = 'default';

const REST_BASE = SUPABASE_URL + '/rest/v1/' + SYNC_TABLE;

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
    const res = await _http({
      url: REST_BASE + '?user_id=eq.' + encodeURIComponent(SYNC_USER_ID),
      method: 'POST',
      data: { user_id: SYNC_USER_ID, data: state },
      header: _headers({
        'Prefer': 'return=representation, resolution=merge-duplicates'
      })
    });
    if (res.statusCode >= 200 && res.statusCode < 300) {
      const row = Array.isArray(res.data) ? res.data[0] : res.data;
      if (row && row.updated_at) {
        storage.writeSyncMeta({ updatedAt: row.updated_at });
      }
      if (app && app._setSyncStatus) app._setSyncStatus('synced');
      return { ok: true };
    }
    throw new Error('HTTP ' + res.statusCode + ' ' + JSON.stringify(res.data).slice(0, 200));
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
    const res = await _http({
      url: REST_BASE + '?user_id=eq.' + encodeURIComponent(SYNC_USER_ID) + '&select=data,updated_at',
      method: 'GET',
      header: _headers({ 'Accept': 'application/json' })
    });
    if (res.statusCode !== 200) throw new Error('HTTP ' + res.statusCode);
    const arr = Array.isArray(res.data) ? res.data : [];
    const row = arr[0];
    if (!row) {
      // 云端无记录：把当前本地推上去
      if (app && app.globalData && app.globalData.state) {
        await pushToCloud(app.globalData.state);
      }
      return { ok: true, source: 'pushed' };
    }
    const localState = (app && app.globalData && app.globalData.state) || storage.loadData();
    const localMeta = storage.readSyncMeta();
    const merged = logic.mergeWithCloud(localState, row.data, row.updated_at, localMeta.updatedAt);
    if (merged.source === 'cloud') {
      // 云端较新：覆盖本地 + 全局 state
      if (app && app.globalData) app.globalData.state = merged.state;
      storage.saveData(merged.state);
      storage.writeSyncMeta({ updatedAt: row.updated_at });
      if (app && app._setSyncStatus) app._setSyncStatus('synced');
      return { ok: true, source: 'cloud', state: merged.state };
    }
    // 本地较新或相等：推送本地
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
  SYNC_TABLE,
  SYNC_USER_ID,
  pushDebounced,
  pushToCloud,
  pullFromCloud,
  _injectMockFetch,
  _resetMockFetch,
  _setSyncEnabled,
  _isSyncEnabled: () => syncEnabled
};
