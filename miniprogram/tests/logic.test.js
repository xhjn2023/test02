// tests/logic.test.js
// Node 单测：覆盖用户要求的多场景压力自测
//   1. 高频反复修改药量、频繁切换新药瓶、连续几十天每日打卡和记录、删除日记
//   2. 边界测试：药片0颗、药片30颗、瓶号改1、批量历史记录加载
// 运行：cd /workspace/miniprogram && node tests/logic.test.js

const path = require('path');
const logic = require('../utils/logic.js');
const storage = require('../utils/storage.js');
const supabase = require('../utils/supabase.js');

let pass = 0, fail = 0;
const fails = [];

function assert(cond, msg) {
  if (cond) { pass++; }
  else { fail++; fails.push(msg); console.error('  ✗ FAIL: ' + msg); }
}
function assertEq(a, b, msg) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (ok) { pass++; }
  else {
    fail++; fails.push(msg);
    console.error(`  ✗ FAIL: ${msg}\n    expect: ${JSON.stringify(b)}\n    actual: ${JSON.stringify(a)}`);
  }
}
function section(name) { console.log('\n=== ' + name + ' ==='); }

function makeState() {
  return logic.reconcile({
    meds: {
      bottles: [{
        id: 1, bottleNumber: 1, totalPills: 30, remainingPills: 30,
        startDate: '2026-01-01', isActive: true, createdAt: '2026-01-01T00:00:00.000Z'
      }],
      checkins: [],
      settings: { reminderTime: '08:00', notificationEnabled: false, lowThreshold: 5, pillsPerDay: 1 }
    },
    diary: { entries: [] }
  });
}

// 生成连续 N 天的日期串
function genDates(n, endDateStr) {
  const end = endDateStr ? new Date(endDateStr) : new Date();
  const arr = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    arr.push(logic.fmtDate(d));
  }
  return arr;
}

/* =========================================================== */
section('1. 数据补全 reconcile —— 损坏/空字段不崩');
assertEq(logic.reconcile(null), logic.DEFAULT_DATA, 'null → 默认');
assertEq(logic.reconcile(undefined), logic.DEFAULT_DATA, 'undefined → 默认');
assertEq(logic.reconcile({}).meds.bottles, [], '空对象 → bottles=[]');
assertEq(logic.reconcile({ meds: {} }).meds.settings.pillsPerDay, 1, '缺 settings → 默认');
assertEq(logic.reconcile({ meds: { settings: { pillsPerDay: 'bad' } } }).meds.settings.pillsPerDay, 1, '非法数值 → 默认');
assertEq(logic.reconcile({ meds: { bottles: 'notarr' } }).meds.bottles, [], 'bottles 非数组 → []');

/* =========================================================== */
section('2. 高频反复修改药量（100 次）');
{
  let s = makeState();
  for (let i = 0; i < 100; i++) {
    const pills = i % 31; // 0..30 循环
    const r = logic.savePills(s, '2026-01-01', { bottleNo: 1, pills });
    assert(!r.error, `savePills #${i} 无错误`);
    s = r.state;
    const b = logic.activeBottle(s);
    assert(b.remainingPills === pills, `#${i} 余量正确 (${b.remainingPills}===${pills})`);
  }
  // 最终一瓶
  assert(s.meds.bottles.length === 1, '反复修改不新增瓶');
  console.log('  ✓ 100 次修改完成，仅 1 瓶，最终余量 = ' + logic.activeBottle(s).remainingPills);
}

/* =========================================================== */
section('3. 边界：药片 0 / 30 / 9999+ 越界');
{
  let s = makeState();
  // 0 颗
  let r = logic.savePills(s, '2026-01-01', { bottleNo: 1, pills: 0 });
  assert(!r.error && logic.activeBottle(r.state).remainingPills === 0, '0 颗 OK');
  // 30 颗
  r = logic.savePills(s, '2026-01-01', { bottleNo: 1, pills: 30 });
  assert(!r.error && logic.activeBottle(r.state).remainingPills === 30, '30 颗 OK');
  // 瓶号改 1
  r = logic.savePills(s, '2026-01-01', { bottleNo: 1, pills: 5 });
  assert(!r.error && logic.activeBottle(r.state).bottleNumber === 1, '瓶号改 1 OK');
  // 越界：负数
  r = logic.savePills(s, '2026-01-01', { bottleNo: 1, pills: -1 });
  assert(r.error, '负数拒绝');
  // 越界：>9999
  r = logic.savePills(s, '2026-01-01', { bottleNo: 1, pills: 10000 });
  assert(r.error, '10000 拒绝');
  // 瓶号 0
  r = logic.savePills(s, '2026-01-01', { bottleNo: 0, pills: 5 });
  assert(r.error, '瓶号 0 拒绝');
  // pills 改 > totalPills → totalPills 自动扩
  r = logic.savePills(s, '2026-01-01', { bottleNo: 1, pills: 50 });
  assert(logic.activeBottle(r.state).totalPills === 50, 'pills>total → 扩 total');
}

/* =========================================================== */
section('4. 频繁切换新药瓶（连开 50 瓶）');
{
  let s = makeState();
  for (let i = 0; i < 50; i++) {
    const r = logic.newBottle(s, '2026-01-01', { totalPills: 30 });
    s = r.state;
  }
  assert(s.meds.bottles.length === 51, '50 瓶新增后共 51 瓶');
  const actives = s.meds.bottles.filter(b => b.isActive);
  assert(actives.length === 1, '仅 1 瓶 isActive');
  assert(actives[0].bottleNumber === 51, '最新瓶号 = 51');
  // id 唯一性
  const ids = new Set(s.meds.bottles.map(b => b.id));
  assert(ids.size === 51, '所有 id 唯一');
}

/* =========================================================== */
section('5. 连续 60 天每日打卡 + 取消 + 再打卡');
{
  let s = makeState();
  // 给第一瓶足够药量
  s.meds.bottles[0].totalPills = 100;
  s.meds.bottles[0].remainingPills = 100;
  const dates = genDates(60);
  for (let i = 0; i < dates.length; i++) {
    const r = logic.toggleCheckin(s, dates[i]);
    assert(r.action === 'checkin', `第${i + 1}天打卡成功`);
    s = r.state;
  }
  assert(s.meds.checkins.length === 60, '60 条打卡记录');
  // 连续天数
  const streak = logic.calcMedsStreak(s.meds.checkins, logic.fmtDate(new Date()));
  assert(streak === 60, `连续 60 天 (实际 ${streak})`);
  // 药量扣减 = 60 * pillsPerDay(1) = 60
  assert(logic.activeBottle(s).remainingPills === 40, `60 天后余量 40 (实际 ${logic.activeBottle(s).remainingPills})`);

  // 取消中间一天，连续应断
  const midDate = dates[30];
  let r = logic.toggleCheckin(s, midDate);
  assert(r.action === 'cancel', '取消中间天');
  s = r.state;
  const streak2 = logic.calcMedsStreak(s.meds.checkins, logic.fmtDate(new Date()));
  assert(streak2 === 29, `断后连续 29 天 (实际 ${streak2})`);

  // 再补回打卡
  r = logic.toggleCheckin(s, midDate);
  assert(r.action === 'checkin', '补回打卡');
  s = r.state;
  const streak3 = logic.calcMedsStreak(s.meds.checkins, logic.fmtDate(new Date()));
  assert(streak3 === 60, `补回后连续 60 天 (实际 ${streak3})`);
}

/* =========================================================== */
section('6. 连续 60 天日记 + 删除 + 统计');
{
  let s = makeState();
  const dates = genDates(60);
  for (let i = 0; i < dates.length; i++) {
    const r = logic.saveDiary(s, dates[i], `第${i + 1}天日记内容`, 'good', ['工作', '生活']);
    assert(!r.error, `第${i + 1}天日记保存`);
    s = r.state;
  }
  const stats = logic.diaryStats(s.diary.entries);
  assert(stats.total === 60, `共 60 篇 (实际 ${stats.total})`);
  // i=0..8 (9个) "第N天日记内容" 7字符；i=9..59 (51个) 8字符 → 9*7 + 51*8 = 471
  assert(stats.words === 471, `总字数 471 (实际 ${stats.words})`);

  // 删除一半
  for (let i = 0; i < 30; i++) {
    s = logic.deleteDiary(s, dates[i]);
  }
  const stats2 = logic.diaryStats(s.diary.entries);
  assert(stats2.total === 30, `删后剩 30 篇 (实际 ${stats2.total})`);

  // 连续天数（最后 30 天还在）
  const streak = logic.calcDiaryStreak(s.diary.entries, logic.fmtDate(new Date()));
  assert(streak === 30, `连续 30 天 (实际 ${streak})`);
}

/* =========================================================== */
section('7. 日记空内容/异常入参拒绝');
{
  let s = makeState();
  assert(logic.saveDiary(s, '2026-01-01', '', 'good', []).error, '空内容拒绝');
  assert(logic.saveDiary(s, '2026-01-01', '   ', 'good', []).error, '纯空格拒绝');
  assert(!logic.saveDiary(s, '2026-01-01', '内容', 'good', null).error, 'tags=null OK');
  assert(!logic.saveDiary(s, '2026-01-01', '内容', null, []).error, 'mood=null OK');
}

/* =========================================================== */
section('8. 批量历史记录加载性能（1000 条打卡 + 1000 篇日记）');
{
  let s = makeState();
  s.meds.bottles[0].totalPills = 100000;
  s.meds.bottles[0].remainingPills = 100000;
  const dates = genDates(1000, '2026-12-31');
  const t0 = Date.now();
  for (let i = 0; i < dates.length; i++) {
    s = logic.toggleCheckin(s, dates[i]).state;
  }
  for (let i = 0; i < dates.length; i++) {
    s = logic.saveDiary(s, dates[i], `日记${i}`, 'good', ['tag']).state;
  }
  const t1 = Date.now();
  console.log(`  ✓ 1000 条打卡 + 1000 篇日记生成耗时 ${t1 - t0}ms`);

  // recentCheckins 限制 60 条
  const t2 = Date.now();
  const recent = logic.recentCheckins(s.meds.checkins, 60);
  const t3 = Date.now();
  assert(recent.length === 60, `recentCheckins 限制 60 (实际 ${recent.length})`);
  console.log(`  ✓ recentCheckins(60) 耗时 ${t3 - t2}ms`);

  // diaryStats 性能
  const t4 = Date.now();
  const stats = logic.diaryStats(s.diary.entries);
  const t5 = Date.now();
  assert(stats.total === 1000, `stats total 1000`);
  console.log(`  ✓ diaryStats(1000) 耗时 ${t5 - t4}ms`);

  // 搜索
  const t6 = Date.now();
  const found = logic.searchDiary(s.diary.entries, '日记999');
  const t7 = Date.now();
  assert(found.length >= 1, '搜索能找到');
  console.log(`  ✓ searchDiary(1000) 耗时 ${t7 - t6}ms`);
}

/* =========================================================== */
section('9. 云端合并 mergeWithCloud —— 后写覆盖');
{
  const localState = makeState();
  localState.meds.bottles[0].remainingPills = 10;
  const cloudState = makeState();
  cloudState.meds.bottles[0].remainingPills = 20;

  // 云端较新 → 取云端
  let r = logic.mergeWithCloud(localState, cloudState, '2026-02-01T00:00:00Z', '2026-01-01T00:00:00Z');
  assert(r.source === 'cloud', '云端较新 → cloud');
  assert(r.state.meds.bottles[0].remainingPills === 20, '取云端余量');

  // 本地较新 → 保留本地
  r = logic.mergeWithCloud(localState, cloudState, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z');
  assert(r.source === 'local', '本地较新 → local');
  assert(r.state.meds.bottles[0].remainingPills === 10, '保留本地余量');

  // 时间相等 → 本地
  r = logic.mergeWithCloud(localState, cloudState, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
  assert(r.source === 'local', '时间相等 → local');

  // 云端损坏数据 → 走 reconcile
  r = logic.mergeWithCloud(localState, { garbage: true }, '2026-02-01T00:00:00Z', null);
  assert(r.source === 'cloud', '云端损坏仍取 cloud');
  assert(Array.isArray(r.state.meds.bottles), 'reconcile 修复结构');
}

/* =========================================================== */
section('10. 环形进度 ringPercent 边界');
assert(logic.ringPercent(null) === 0, 'null → 0%');
assert(logic.ringPercent({ totalPills: 0, remainingPills: 0 }) === 0, 'total=0 → 0%');
assert(logic.ringPercent({ totalPills: 30, remainingPills: 0 }) === 0, '余 0 → 0%');
assert(logic.ringPercent({ totalPills: 30, remainingPills: 30 }) === 100, '余满 → 100%');
assert(logic.ringPercent({ totalPills: 30, remainingPills: 15 }) === 50, '余 15 → 50%');
assert(logic.ringPercent({ totalPills: 30, remainingPills: -5 }) === 0, '余负 → 0%');
assert(logic.ringPercent({ totalPills: 30, remainingPills: 999 }) === 100, '余超 → 截 100');

/* =========================================================== */
section('11. storage 读写 + 兼容旧字符串');
{
  storage._resetMem();
  // 默认数据
  const d = storage.loadData();
  assert(d.meds.bottles.length === 0, '空 storage → 默认空');
  // 写入
  const s = makeState();
  storage.saveData(s);
  const d2 = storage.loadData();
  assert(d2.meds.bottles.length === 1, '写入后读取');
  // syncMeta
  storage.writeSyncMeta({ updatedAt: '2026-05-01T00:00:00Z' });
  assert(storage.readSyncMeta().updatedAt === '2026-05-01T00:00:00Z', 'syncMeta 读写');
}

/* =========================================================== */
// section 12 同步测试用例单独抽到下方 async IIFE，避免 CommonJS 顶层 await 冲突
section('12. Supabase mock 网络测试（拉取/推送）—— 见文件末尾 async 块');

/* =========================================================== */
section('13. toggleCheckin 无瓶场景');
{
  const s = logic.reconcile({}); // 无瓶
  const r = logic.toggleCheckin(s, '2026-01-01');
  assert(r.action === 'noBottle', '无瓶 → noBottle');
  assert(r.state.meds.checkins.length === 0, '不产生打卡记录');
}

/* =========================================================== */
section('14. 打卡药量扣减边界（剩余不足时）');
{
  let s = makeState();
  s.meds.bottles[0].remainingPills = 1; // 只剩 1 颗
  s.meds.settings.pillsPerDay = 3;      // 每日 3 颗
  const r = logic.toggleCheckin(s, '2026-01-01');
  s = r.state;
  assert(logic.activeBottle(s).remainingPills === 0, '扣减不低于 0');
  // 取消打卡 → 回补不超过 totalPills(30)
  const r2 = logic.toggleCheckin(s, '2026-01-01');
  s = r2.state;
  assert(logic.activeBottle(s).remainingPills === 3, `取消回补 3 (实际 ${logic.activeBottle(s).remainingPills})`);
}

/* =========================================================== */
section('15. settings 非法入参被忽略');
{
  let s = makeState();
  s = logic.updateSettings(s, { pillsPerDay: 'abc' });
  assert(s.meds.settings.pillsPerDay === 1, '非法 pillsPerDay 忽略');
  s = logic.updateSettings(s, { pillsPerDay: 0 });
  assert(s.meds.settings.pillsPerDay === 1, '0 忽略');
  s = logic.updateSettings(s, { pillsPerDay: 11 });
  assert(s.meds.settings.pillsPerDay === 1, '>10 忽略');
  s = logic.updateSettings(s, { pillsPerDay: 5 });
  assert(s.meds.settings.pillsPerDay === 5, '合法 5 接受');
  s = logic.updateSettings(s, { reminderTime: '25:99' });
  assert(s.meds.settings.reminderTime === '08:00', '非法时间忽略');
  s = logic.updateSettings(s, { reminderTime: '09:30' });
  assert(s.meds.settings.reminderTime === '09:30', '合法时间接受');
}

/* =========================================================== */
// 异步测试单独跑，避免 CommonJS 顶层 await
(async () => {
  section('12-async. Supabase mock 网络测试（拉取/推送）');
  storage._resetMem();
  let lastPushBody = null;
  let lastPushHeaders = null;
  let mockResponse = { statusCode: 200, data: [{ user_id: 'default', data: { meds: { bottles: [] } }, updated_at: '2026-06-01T00:00:00Z' }] };

  const origGetApp = global.getApp;
  global.getApp = () => ({
    globalData: { state: makeState(), syncStatus: 'offline', syncListeners: [] },
    _setSyncStatus: function (s) { this.globalData.syncStatus = s; }
  });

  supabase._setSyncEnabled(true);
  supabase._injectMockFetch(async (opts) => {
    if (opts.method === 'POST') {
      lastPushBody = opts.data;
      lastPushHeaders = opts.header;
      return { statusCode: 200, data: [{ user_id: 'default', data: opts.data.data, updated_at: '2026-06-02T00:00:00Z' }] };
    }
    return mockResponse;
  });

  const pushRes = await supabase.pushToCloud(makeState());
  assert(pushRes.ok, '推送成功');
  assert(lastPushBody && lastPushBody.user_id === 'default', '推送 user_id 正确');
  assert(lastPushHeaders && lastPushHeaders.apikey, '推送带 apikey header');

  // 拉取前用一个比 push 返回的 06-02 更新的云端时间戳，确保 cloud 较新
  mockResponse = { statusCode: 200, data: [{ user_id: 'default', data: { meds: { bottles: [] } }, updated_at: '2026-06-03T00:00:00Z' }] };
  const pullRes = await supabase.pullFromCloud();
  assert(pullRes.ok, '拉取成功');
  assert(pullRes.source === 'cloud', '云端较新 → cloud');

  mockResponse = { statusCode: 200, data: [] };
  const pullRes2 = await supabase.pullFromCloud();
  assert(pullRes2.ok, '云端无记录 → 推本地成功');

  supabase._setSyncEnabled(false);
  const r = await supabase.pushToCloud(makeState());
  assert(!r.ok, '关闭后 push 返回 disabled');

  supabase._resetMockFetch();
  supabase._setSyncEnabled(true);
  global.getApp = origGetApp;

  reportAndExit();
})();

function reportAndExit() {
  console.log('\n========================================');
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  if (fail > 0) {
    console.log('\n失败列表：');
    fails.forEach(f => console.log('  - ' + f));
    process.exit(1);
  } else {
    console.log('全部通过 ✓');
    process.exit(0);
  }
}
