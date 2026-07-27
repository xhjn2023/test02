// app.js - 全局逻辑
const logic = require('./utils/logic.js');
const supabase = require('./utils/supabase.js');

const STORAGE_KEY = 'workbench_state_cache';

App({
  globalData: {
    state: null,        // 全局状态（meds + diary）
    syncStatus: 'offline', // offline | syncing | synced
    syncListeners: [],
    ready: false        // 云端拉取完成前为 false，期间禁止 saveData 推送
  },

  onLaunch() {
    // 先从本地缓存恢复，避免 pull 失败（如体验版域名未配/无网络）时显示空白
    try {
      const cached = wx.getStorageSync(STORAGE_KEY);
      if (cached && typeof cached === 'object') {
        this.globalData.state = logic.reconcile(cached);
        console.log('[app] 从本地缓存恢复 state');
      } else {
        this.globalData.state = logic.clone(logic.DEFAULT_DATA);
      }
    } catch (e) {
      this.globalData.state = logic.clone(logic.DEFAULT_DATA);
    }
    supabase.pullFromCloud().then(() => {
      this.globalData.ready = true;
      this._notifySync();
    }).catch(() => {
      // 拉取失败也允许后续保存（避免无网络时完全不可用）
      this.globalData.ready = true;
      this._notifySync();
    });
  },

  // 保存数据（直接推云）。ready 之前丢弃，避免空 state 覆盖云端
  saveData() {
    if (!this.globalData.ready) {
      console.warn('[app] saveData 被丢弃：云端尚未拉取完成');
      return Promise.resolve({ ok: false, reason: 'not-ready' });
    }
    this._saveCache();
    return supabase.pushToCloud(this.globalData.state);
  },

  // 写入本地缓存（离线回退用，云端为主）
  _saveCache() {
    try {
      wx.setStorageSync(STORAGE_KEY, this.globalData.state);
    } catch (e) {
      console.warn('[app] 写入本地缓存失败:', e);
    }
  },

  // 获取最新状态（页面 onShow 时调用，确保拿到云端同步后的最新数据）
  getState() {
    return this.globalData.state;
  },

  // 同步状态变更通知
  onSyncChange(cb) {
    this.globalData.syncListeners.push(cb);
    cb(this.globalData.syncStatus);
    return () => {
      const i = this.globalData.syncListeners.indexOf(cb);
      if (i >= 0) this.globalData.syncListeners.splice(i, 1);
    };
  },
  _setSyncStatus(s) {
    this.globalData.syncStatus = s;
    this._notifySync();
  },
  _notifySync() {
    this.globalData.syncListeners.forEach(cb => {
      try { cb(this.globalData.syncStatus); } catch (e) { console.warn(e); }
    });
  },

  // 手动触发一次拉取
  manualSync() {
    return supabase.pullFromCloud();
  }
});
