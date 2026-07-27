// utils/storage.js
// 本地存储封装（小程序 wx.setStorage + 单测环境兼容）

const logic = require('./logic.js');

const STORAGE_KEY = 'workbenchData';
const SYNC_META_KEY = 'workbenchSyncMeta';

// 单测环境无 wx，用内存 Map 模拟
const _memStore = {};
function hasWx() { return typeof wx !== 'undefined' && wx && typeof wx.setStorageSync === 'function'; }

function _getSync(key) {
  if (hasWx()) {
    try { return wx.getStorageSync(key); } catch (e) { return ''; }
  }
  return _memStore[key];
}
function _setSync(key, val) {
  if (hasWx()) {
    try { wx.setStorageSync(key, val); } catch (e) { console.warn('[storage] setStorageSync fail', e); }
  } else {
    _memStore[key] = val;
  }
}

function loadData() {
  let raw = _getSync(STORAGE_KEY);
  if (!raw) return logic.clone(logic.DEFAULT_DATA);
  // wx.getStorageSync 已自动反序列化；单测环境存的是字符串需手动 parse
  let p = raw;
  if (typeof raw === 'string') {
    try { p = JSON.parse(raw); } catch (e) { console.warn('[storage] JSON parse fail'); return logic.clone(logic.DEFAULT_DATA); }
  }
  return logic.reconcile(p);
}

function saveData(state) {
  _setSync(STORAGE_KEY, state);
}

function readSyncMeta() {
  let raw = _getSync(SYNC_META_KEY);
  if (!raw) return {};
  let p = raw;
  if (typeof raw === 'string') {
    try { p = JSON.parse(raw); } catch (e) { return {}; }
  }
  return p || {};
}

function writeSyncMeta(patch) {
  const next = Object.assign({}, readSyncMeta(), patch || {});
  _setSync(SYNC_META_KEY, next);
}

// 暴露给单测直接清空内存
function _resetMem() {
  Object.keys(_memStore).forEach(k => delete _memStore[k]);
}

module.exports = {
  STORAGE_KEY,
  SYNC_META_KEY,
  loadData,
  saveData,
  readSyncMeta,
  writeSyncMeta,
  _resetMem
};
