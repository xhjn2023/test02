// app.js - 全局逻辑
const logic = require('./utils/logic.js');
const supabase = require('./utils/supabase.js');

App({
  globalData: {
    state: null,        // 全局状态（meds + diary）
    syncStatus: 'offline', // offline | syncing | synced
    syncListeners: []   // 同步状态变化监听器
  },

  onLaunch() {
    // 直接从云端拉取，不再读本地缓存
    this.globalData.state = logic.clone(logic.DEFAULT_DATA);
    supabase.pullFromCloud().then(() => {
      this._notifySync();
    });
  },

  // 保存数据（直接推云，不再写本地）
  saveData() {
    return supabase.pushToCloud(this.globalData.state);
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
