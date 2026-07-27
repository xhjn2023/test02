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
section('4b. 重启后新瓶 id 不与已有 id 冲突（回归 bug）');
{
  // 模拟从云端拉取下来的已有 bottle：id 较大（如 Date.now() 量级）
  const existing = logic.clone(logic.DEFAULT_DATA);
  existing.meds.bottles.push({
    id: 1785162961773,    // 模拟云端已有最大 id
    bottleNumber: 1,
    totalPills: 30,
    remainingPills: 29,
    startDate: '2026-07-27',
    isActive: true,
    createdAt: '2026-07-27T00:00:00Z'
  });
  // 此时本地 _idCounter 可能小于已有 id，新开瓶不应该产生重复或更小的 id
  const r = logic.newBottle(existing, '2026-07-28', { totalPills: 30 });
  const newB = r.state.meds.bottles[r.state.meds.bottles.length - 1];
  assert(newB.id > 1785162961773, '新瓶 id > 已有最大 id');
  const idSet = new Set(r.state.meds.bottles.map(b => b.id));
  assert(idSet.size === r.state.meds.bottles.length, '新瓶 id 不与已有 id 重复');
}

/* =========================================================== */
section('4c. 重启后新日记 id 不与已有 id 冲突（回归 bug）');
{
  const existing = logic.clone(logic.DEFAULT_DATA);
  existing.diary.entries.push({
    id: 1785162961774,    // 模拟云端已有最大 id
    date: '2026-07-27',
    content: '云端日记',
    mood: 'good',
    tags: [],
    createdAt: '2026-07-27T00:00:00Z',
    updatedAt: '2026-07-27T00:00:00Z'
  });
  const r = logic.saveDiary(existing, '2026-07-28', '本地新日记', 'good', []);
  const newE = r.state.diary.entries.find(e => e.date === '2026-07-28');
  assert(newE && newE.id > 1785162961774, '新日记 id > 已有最大 id');
  const idSet = new Set(r.state.diary.entries.map(e => e.id));
  assert(idSet.size === r.state.diary.entries.length, '新日记 id 不与已有 id 重复');
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
section('16. 新模块 reconcile 兼容损坏数据');
{
  // 空对象 → 新模块都为空数组
  const r1 = logic.reconcile({});
  assert(Array.isArray(r1.work.tasks), 'work.tasks 默认 []');
  assert(Array.isArray(r1.study.plans), 'study.plans 默认 []');
  assert(Array.isArray(r1.life.moments), 'life.moments 默认 []');
  assert(Array.isArray(r1.review.entries), 'review.entries 默认 []');

  // 部分字段损坏
  const r2 = logic.reconcile({ work: { tasks: 'bad' }, study: null, life: { moments: 123 }, review: 'bad' });
  assert(Array.isArray(r2.work.tasks) && r2.work.tasks.length === 0, 'work.tasks 非数组 → []');
  assert(Array.isArray(r2.study.plans) && r2.study.plans.length === 0, 'study 缺失 → 默认');
  assert(Array.isArray(r2.life.moments) && r2.life.moments.length === 0, 'life.moments 非数组 → []');
  assert(Array.isArray(r2.review.entries) && r2.review.entries.length === 0, 'review 非对象 → 默认');

  // null/undefined → 默认
  assert(Array.isArray(logic.reconcile(null).work.tasks), 'null → 默认 work');
  assert(Array.isArray(logic.reconcile(undefined).review.entries), 'undefined → 默认 review');
}

/* =========================================================== */
section('17. Work 任务高频压力测试（200 任务 / 切换 / 删除）');
{
  let s = makeState();
  const t0 = Date.now();
  // 200 个任务
  for (let i = 0; i < 200; i++) {
    const r = logic.addWorkTask(s, {
      title: `任务 ${i}`,
      priority: (i % 3) + 1,
      dueDate: '2026-08-01'
    });
    assert(!r.error, `任务 #${i} 添加无错误`);
    s = r.state;
  }
  assert(s.work.tasks.length === 200, `共 200 任务 (实际 ${s.work.tasks.length})`);

  // id 全唯一
  const idSet = new Set(s.work.tasks.map(t => t.id));
  assert(idSet.size === 200, '所有 id 唯一');

  // 切换偶数任务为完成
  s.work.tasks.slice(0, 100).forEach((t, idx) => {
    const r = logic.toggleWorkTask(s, t.id);
    assert(!r.error, `切换 #${idx} 无错误`);
    s = r.state;
  });
  const done = s.work.tasks.filter(t => t.done).length;
  assert(done === 100, `完成数 100 (实际 ${done})`);

  // 排序：未完成在前
  const sorted = logic.sortedWorkTasks(s.work.tasks);
  let firstDoneIdx = sorted.findIndex(t => t.done);
  assert(firstDoneIdx === 100, `未完成在前 firstDoneIdx=${firstDoneIdx} (应 100)`);

  // 删除一半
  const idsToDelete = s.work.tasks.slice(0, 50).map(t => t.id);
  idsToDelete.forEach(id => { s = logic.deleteWorkTask(s, id); });
  assert(s.work.tasks.length === 150, `删后剩 150 (实际 ${s.work.tasks.length})`);

  // 边界：空标题拒绝
  assert(logic.addWorkTask(s, { title: '', priority: 1 }).error, '空标题拒绝');
  assert(logic.addWorkTask(s, { title: '   ', priority: 1 }).error, '纯空格标题拒绝');
  // 边界：非法优先级被截断
  let r = logic.addWorkTask(s, { title: '低优先', priority: 0 });
  assert(!r.error && r.item.priority === 1, 'priority 0 → 截断到 1');
  r = logic.addWorkTask(s, { title: '高优先', priority: 99 });
  assert(!r.error && r.item.priority === 3, 'priority 99 → 截断到 3');
  // 边界：更新不存在
  assert(logic.updateWorkTask(s, 999999, { title: 'x' }).error, '更新不存在任务 → 错误');
  assert(logic.toggleWorkTask(s, 999999).error, '切换不存在任务 → 错误');

  const t1 = Date.now();
  console.log(`  ✓ Work 压测耗时 ${t1 - t0}ms，最终 ${s.work.tasks.length} 任务`);
}

/* =========================================================== */
section('18. Study 计划高频压力测试（150 计划 / 统计）');
{
  let s = makeState();
  const t0 = Date.now();
  for (let i = 0; i < 150; i++) {
    const r = logic.addStudyPlan(s, {
      subject: `主题 ${i}`,
      content: `内容 ${i}`,
      durationMin: 30 + i,
      date: `2026-08-${String((i % 28) + 1).padStart(2, '0')}`
    });
    assert(!r.error, `计划 #${i} 添加`);
    s = r.state;
  }
  assert(s.study.plans.length === 150, `共 150 计划 (实际 ${s.study.plans.length})`);

  // 完成 50 个
  s.study.plans.slice(0, 50).forEach((p, i) => {
    const r = logic.toggleStudyPlan(s, p.id);
    assert(!r.error, `切换 #${i}`);
    s = r.state;
  });

  // 统计
  const stats = logic.studyStats(s.study.plans);
  assert(stats.total === 150, `stats.total 150 (实际 ${stats.total})`);
  assert(stats.done === 50, `stats.done 50 (实际 ${stats.done})`);
  assert(stats.minutes === (150 * 30 + (149 * 150) / 2), `stats.minutes 正确 (实际 ${stats.minutes})`);

  // 排序：未完成在前
  const sorted = logic.sortedStudyPlans(s.study.plans);
  assert(!sorted[0].completed, '未完成在前');
  assert(sorted[sorted.length - 1].completed, '已完成在后');

  // 边界：空主题拒绝
  assert(logic.addStudyPlan(s, { subject: '' }).error, '空主题拒绝');
  assert(logic.addStudyPlan(s, { subject: '   ' }).error, '纯空格主题拒绝');
  // 负时长被截断到 0
  const r = logic.addStudyPlan(s, { subject: '负时长', durationMin: -10 });
  assert(!r.error && r.item.durationMin === 0, '负时长 → 0');
  // 切换/更新不存在
  assert(logic.toggleStudyPlan(s, 999999).error, '切换不存在计划');
  assert(logic.updateStudyPlan(s, 999999, { subject: 'x' }).error, '更新不存在计划');

  // 删除
  const id = s.study.plans[0].id;
  const before = s.study.plans.length;
  s = logic.deleteStudyPlan(s, id);
  assert(s.study.plans.length === before - 1, '删除一条');

  const t1 = Date.now();
  console.log(`  ✓ Study 压测耗时 ${t1 - t0}ms，最终 ${s.study.plans.length} 计划`);
}

/* =========================================================== */
section('19. Life 生活记录高频压力测试（100 条记录）');
{
  let s = makeState();
  const t0 = Date.now();
  for (let i = 0; i < 100; i++) {
    const r = logic.addLifeMoment(s, {
      content: `生活记录 ${i}`,
      mood: ['great', 'good', 'ok', 'bad', 'sad'][i % 5],
      tags: ['生活', i % 2 === 0 ? '运动' : '美食'],
      date: `2026-07-${String((i % 28) + 1).padStart(2, '0')}`
    });
    assert(!r.error, `记录 #${i} 添加`);
    s = r.state;
  }
  assert(s.life.moments.length === 100, `共 100 条 (实际 ${s.life.moments.length})`);

  // id 唯一
  const idSet = new Set(s.life.moments.map(m => m.id));
  assert(idSet.size === 100, '所有 id 唯一');

  // 排序：日期降序
  const sorted = logic.sortedLifeMoments(s.life.moments);
  assert(sorted[0].date >= sorted[1].date, '日期降序');

  // 更新
  const first = s.life.moments[0];
  const r = logic.updateLifeMoment(s, first.id, { content: '更新后的内容', mood: 'great' });
  assert(!r.error && r.item.content === '更新后的内容', '更新成功');
  s = r.state;
  assert(s.life.moments[0].content === '更新后的内容', '更新持久化');

  // 边界
  assert(logic.addLifeMoment(s, { content: '' }).error, '空内容拒绝');
  assert(logic.addLifeMoment(s, { content: '  ' }).error, '纯空格内容拒绝');
  assert(logic.updateLifeMoment(s, 999999, { content: 'x' }).error, '更新不存在记录');

  // 删除
  const id = s.life.moments[0].id;
  const before = s.life.moments.length;
  s = logic.deleteLifeMoment(s, id);
  assert(s.life.moments.length === before - 1, '删除一条');

  const t1 = Date.now();
  console.log(`  ✓ Life 压测耗时 ${t1 - t0}ms，最终 ${s.life.moments.length} 条`);
}

/* =========================================================== */
section('20. Review 复盘高频压力测试（100 篇 + 评分统计）');
{
  let s = makeState();
  const t0 = Date.now();
  for (let i = 0; i < 100; i++) {
    const r = logic.addReviewEntry(s, {
      periodType: i % 4 === 0 ? 'month' : 'week',
      periodStart: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      periodEnd: `2026-01-${String(((i + 6) % 28) + 1).padStart(2, '0')}`,
      content: `复盘 #${i}`,
      rating: (i % 5) + 1, // 1-5
      tags: ['总结', '反思']
    });
    assert(!r.error, `复盘 #${i} 添加`);
    s = r.state;
  }
  assert(s.review.entries.length === 100, `共 100 篇 (实际 ${s.review.entries.length})`);

  // id 唯一
  const idSet = new Set(s.review.entries.map(r => r.id));
  assert(idSet.size === 100, '所有 id 唯一');

  // 评分统计：1+2+3+4+5 = 15，每 5 篇循环 20 次 → 平均 3.0
  const stats = logic.reviewStats(s.review.entries);
  assert(stats.total === 100, `stats.total 100 (实际 ${stats.total})`);
  assert(stats.avgRating === 3, `stats.avgRating 3 (实际 ${stats.avgRating})`);

  // periodType 默认值
  const r2 = logic.addReviewEntry(s, { content: 'x', periodType: 'invalid' });
  assert(r2.item.periodType === 'week', '非法 periodType → week');

  // rating 边界
  const r3 = logic.addReviewEntry(s, { content: 'x', rating: 0 });
  assert(r3.item.rating === 1, 'rating 0 → 截到 1');
  const r4 = logic.addReviewEntry(s, { content: 'x', rating: 99 });
  assert(r4.item.rating === 5, 'rating 99 → 截到 5');

  // 排序：periodEnd 降序
  const sorted = logic.sortedReviewEntries(s.review.entries);

  // 更新
  const first = s.review.entries[0];
  const r5 = logic.updateReviewEntry(s, first.id, { content: '更新', rating: 5 });
  assert(!r5.error && r5.item.rating === 5, '更新评分成功');
  s = r5.state;
  assert(s.review.entries[0].content === '更新', '更新持久化');

  // 边界：空内容拒绝
  assert(logic.addReviewEntry(s, { content: '' }).error, '空复盘内容拒绝');
  assert(logic.updateReviewEntry(s, 999999, { content: 'x' }).error, '更新不存在复盘');

  // 删除一半（r2/r3/r4 仅校验 item 未回写 s，故仍为 100 篇，删 50 剩 50）
  const ids = s.review.entries.slice(0, 50).map(r => r.id);
  ids.forEach(id => { s = logic.deleteReviewEntry(s, id); });
  assert(s.review.entries.length === 50, `删后剩 50 (实际 ${s.review.entries.length})`);

  const t1 = Date.now();
  console.log(`  ✓ Review 压测耗时 ${t1 - t0}ms，最终 ${s.review.entries.length} 篇`);
}

/* =========================================================== */
section('21. 日记日期选择辅助：getDiaryByDate / listDiaryByRange / diaryMonthMap');
{
  let s = makeState();
  // 准备数据：2026-07 月 5 篇，2026-08 月 3 篇
  const julDates = ['2026-07-01', '2026-07-15', '2026-07-20', '2026-07-25', '2026-07-31'];
  const augDates = ['2026-08-05', '2026-08-10', '2026-08-15'];
  julDates.forEach(d => { s = logic.saveDiary(s, d, `内容-${d}`, 'good', []).state; });
  augDates.forEach(d => { s = logic.saveDiary(s, d, `内容-${d}`, 'good', []).state; });

  // getDiaryByDate
  const e1 = logic.getDiaryByDate(s, '2026-07-15');
  assert(e1 && e1.content === '内容-2026-07-15', 'getDiaryByDate 命中');
  const e2 = logic.getDiaryByDate(s, '2026-07-02');
  assert(e2 === null, 'getDiaryByDate 无日记返回 null');

  // listDiaryByRange：7 月全部
  const julList = logic.listDiaryByRange(s.diary.entries, '2026-07-01', '2026-07-31');
  assert(julList.length === 5, `7 月 5 篇 (实际 ${julList.length})`);
  // 排序：降序
  assert(julList[0].date === '2026-07-31', '区间列表降序首条');
  assert(julList[julList.length - 1].date === '2026-07-01', '区间列表降序末条');

  // 跨月区间
  const all = logic.listDiaryByRange(s.diary.entries, '2026-07-15', '2026-08-10');
  // 7-15, 7-20, 7-25, 7-31, 8-05, 8-10 → 6 篇
  assert(all.length === 6, `跨月区间 6 篇 (实际 ${all.length})`);

  // diaryMonthMap
  const julMap = logic.diaryMonthMap(s.diary.entries, '2026-07');
  assert(Object.keys(julMap).length === 5, '7 月有 5 个日期');
  assert(julMap['2026-07-15'] === true, '7-15 在 map 中');
  const augMap = logic.diaryMonthMap(s.diary.entries, '2026-08');
  assert(Object.keys(augMap).length === 3, '8 月有 3 个日期');
  const emptyMap = logic.diaryMonthMap(s.diary.entries, '2026-09');
  assert(Object.keys(emptyMap).length === 0, '9 月无日记');
}

/* =========================================================== */
section('22. moduleOverview 各模块统计聚合');
{
  let s = makeState();
  // 准备：1 瓶药 + 今日打卡 + 1 篇日记 + 2 工作任务（1 完成 1 未完成）+ 1 学习（完成）+ 1 生活记录 + 1 复盘
  const today = logic.fmtDate(new Date());
  // 打卡
  let r = logic.toggleCheckin(s, today);
  s = r.state;
  s.meds.bottles[0].remainingPills = 30; // 重置余量
  // 日记
  let r2 = logic.saveDiary(s, today, '今日内容', 'good', []);
  s = r2.state;
  // 工作
  let r3 = logic.addWorkTask(s, { title: '完成', priority: 1 });
  s = r3.state;
  s = logic.toggleWorkTask(s, r3.item.id).state;
  let r4 = logic.addWorkTask(s, { title: '待办', priority: 2 });
  s = r4.state;
  // 学习
  let r5 = logic.addStudyPlan(s, { subject: '已学', durationMin: 60 });
  s = r5.state;
  s = logic.toggleStudyPlan(s, r5.item.id).state;
  // 生活
  let r6 = logic.addLifeMoment(s, { content: '今日生活' });
  s = r6.state;
  // 复盘
  let r7 = logic.addReviewEntry(s, { content: '复盘', rating: 4 });
  s = r7.state;

  const ov = logic.moduleOverview(s);
  assert(ov.meds.streak === 1, `meds.streak 1 (实际 ${ov.meds.streak})`);
  assert(ov.diary.total === 1 && ov.diary.today === true, `diary 今日已记`);
  assert(ov.work.total === 2 && ov.work.pending === 1, `work 2/待 1`);
  assert(ov.study.total === 1 && ov.study.done === 1, `study 1/完成 1`);
  assert(ov.life.total === 1 && ov.life.today === true, `life 今日已记`);
  assert(ov.review.total === 1 && ov.review.avgRating === 4, `review 1 篇/均 4`);

  // 空状态
  const empty = logic.moduleOverview(logic.reconcile({}));
  assert(empty.meds.streak === 0 && empty.diary.total === 0 && empty.work.pending === 0, '空状态概览安全');
}

/* =========================================================== */
// 异步测试单独跑，避免 CommonJS 顶层 await
(async () => {
  section('12-async. Supabase 多表 mock 网络测试（拉取/推送）');

  // 记录每次 POST 请求（按表分组）
  let pushCalls = [];
  // 云端各表当前数据（mock 数据库）
  let cloudRows = { bottles: [], checkins: [], settings: [], diary: [], work: [], study: [], life: [], review: [] };

  // 路由 URL 中的表名
  function tableOf(url) {
    if (url.indexOf('meds_bottles') >= 0) return 'bottles';
    if (url.indexOf('meds_checkins') >= 0) return 'checkins';
    if (url.indexOf('meds_settings') >= 0) return 'settings';
    if (url.indexOf('diary_entries') >= 0) return 'diary';
    if (url.indexOf('work_tasks') >= 0) return 'work';
    if (url.indexOf('study_plans') >= 0) return 'study';
    if (url.indexOf('life_moments') >= 0) return 'life';
    if (url.indexOf('review_entries') >= 0) return 'review';
    return null;
  }

  const origGetApp = global.getApp;
  global.getApp = () => ({
    globalData: { state: makeState(), syncStatus: 'offline', syncListeners: [] },
    _setSyncStatus: function (s) { this.globalData.syncStatus = s; }
  });

  supabase._setSyncEnabled(true);
  supabase._injectMockFetch(async (opts) => {
    if (opts.method === 'POST') {
      pushCalls.push({ url: opts.url, data: opts.data, header: opts.header });
      return { statusCode: 200, data: opts.data };
    }
    // GET 按 URL 路由返回云端各表数据
    const t = tableOf(opts.url);
    return { statusCode: 200, data: t ? cloudRows[t] : [] };
  });

  // 1. push：makeState 有 1 bottle + 1 settings（checkins/diary 为空不发请求）
  const pushRes = await supabase.pushToCloud(makeState());
  assert(pushRes.ok, '推送成功');
  assert(pushCalls.length === 2, `推送触发 2 个表请求 (实际 ${pushCalls.length})`);
  assert(pushCalls.some(c => c.url.indexOf('meds_bottles') >= 0), '包含 bottles 表');
  assert(pushCalls.some(c => c.url.indexOf('meds_settings') >= 0), '包含 settings 表');
  assert(pushCalls[0].header && pushCalls[0].header.apikey, '推送带 apikey header');
  assert(pushCalls[0].data[0].user_id === 'default', '推送 user_id 正确');
  // 字段为 snake_case
  assert(pushCalls.find(c => c.url.indexOf('meds_bottles') >= 0).data[0].bottle_number === 1, '字段转 snake_case');
  assert(pushCalls.find(c => c.url.indexOf('meds_settings') >= 0).data[0].reminder_time === '08:00', 'settings 字段转 snake_case');

  // 2. pull：云端各表都有数据 → 按表合并，云端 diary 进入本地
  pushCalls = [];
  global.getApp = () => ({
    globalData: { state: makeState(), syncStatus: 'offline', syncListeners: [] },
    _setSyncStatus: function (s) { this.globalData.syncStatus = s; }
  });
  cloudRows = {
    bottles: [{ user_id: 'default', id: 99, bottle_number: 1, total_pills: 30, remaining_pills: 5, start_date: '2026-01-01', is_active: true, created_at: '2026-06-05T00:00:00Z', updated_at: '2026-06-05T00:00:00Z' }],
    checkins: [],
    settings: [{ user_id: 'default', reminder_time: '09:30', notification_enabled: true, low_threshold: 5, pills_per_day: 2, updated_at: '2026-06-05T00:00:00Z' }],
    diary: [{ user_id: 'default', id: 7, date: '2026-06-04', content: '云端日记', mood: 'good', tags: ['x'], created_at: '2026-06-04T00:00:00Z', updated_at: '2026-06-05T00:00:00Z' }]
  };
  const pullRes = await supabase.pullFromCloud();
  assert(pullRes.ok, '拉取成功');
  assert(pullRes.source === 'merged', '按表合并 → merged');
  assert(pullRes.state.diary.entries[0].content === '云端日记', '云端 diary 合并到本地');
  assert(pullRes.state.meds.settings.pillsPerDay === 2, '云端 settings 合并');
  assert(pullRes.state.meds.settings.reminderTime === '09:30', 'reminderTime 还原');
  assert(pushCalls.length === 0, '云端各表都有数据时不触发补推');

  // 3. pull：云端 diary 空，本地有 diary → 保留本地 diary + 补推到云端
  pushCalls = [];
  const localState3 = makeState();
  localState3.diary.entries.push({ id: 42, date: '2026-07-27', content: '本地日记', mood: 'good', tags: [], createdAt: '2026-07-27T00:00:00Z', updatedAt: '2026-07-27T00:00:00Z' });
  global.getApp = () => ({
    globalData: { state: localState3, syncStatus: 'offline', syncListeners: [] },
    _setSyncStatus: function (s) { this.globalData.syncStatus = s; }
  });
  cloudRows = { bottles: [], checkins: [], settings: [], diary: [] };
  const pullRes2 = await supabase.pullFromCloud();
  assert(pullRes2.ok, '拉取成功');
  assert(pullRes2.source === 'merged', '合并 → merged');
  assert(pullRes2.state.diary.entries.some(e => e.content === '本地日记'), '本地 diary 保留（不被云端空覆盖）');
  assert(pushCalls.some(c => c.url.indexOf('diary_entries') >= 0), '本地 diary 补推到云端');

  // 4. 转换器：往返一致性
  const orig = makeState();
  orig.meds.bottles[0].remainingPills = 17;
  orig.meds.checkins.push({ date: '2026-06-01', bottleId: 1, taken: true, timestamp: '2026-06-01T08:00:00Z' });
  orig.diary.entries.push({ id: 42, date: '2026-06-01', content: 'hello', mood: 'good', tags: ['t1'], createdAt: '2026-06-01T08:00:00Z', updatedAt: '2026-06-01T08:00:00Z' });
  const roundTrip = supabase._rowsToState(supabase._stateToRows(orig));
  assert(roundTrip.meds.bottles[0].remainingPills === 17, '往返：bottle 余量保留');
  assert(roundTrip.meds.checkins[0].date === '2026-06-01' && roundTrip.meds.checkins[0].taken === true, '往返：checkin 保留');
  assert(roundTrip.meds.settings.pillsPerDay === 1, '往返：settings 保留');
  assert(roundTrip.diary.entries[0].content === 'hello' && roundTrip.diary.entries[0].id === 42, '往返：diary 保留');

  // 5. 关闭同步
  supabase._setSyncEnabled(false);
  const r = await supabase.pushToCloud(makeState());
  assert(!r.ok, '关闭后 push 返回 disabled');

  supabase._resetMockFetch();
  supabase._setSyncEnabled(true);
  global.getApp = origGetApp;

  // ============================================================
  // section 12-async-B: 8 表多模块推送 / 拉取 / 往返一致性
  // ============================================================
  section('12-async-B. 8 表多模块 mock 推送 / 拉取 / 往返');

  let pushCalls2 = [];
  let cloudRows2 = { bottles: [], checkins: [], settings: [], diary: [], work: [], study: [], life: [], review: [] };

  global.getApp = () => ({
    globalData: { state: logic.clone(logic.DEFAULT_DATA), syncStatus: 'offline', syncListeners: [] },
    _setSyncStatus: function (s) { this.globalData.syncStatus = s; }
  });
  supabase._setSyncEnabled(true);
  supabase._injectMockFetch(async (opts) => {
    if (opts.method === 'POST') {
      pushCalls2.push({ url: opts.url, data: opts.data });
      return { statusCode: 200, data: opts.data };
    }
    const t = tableOf(opts.url);
    return { statusCode: 200, data: t ? (cloudRows2[t] || []) : [] };
  });

  // 1. 构造含所有新模块的 state，push 后应触发 8 个表请求
  let allState = makeState();
  allState = logic.addWorkTask(allState, { title: '任务1', priority: 1, dueDate: '2026-08-01' }).state;
  allState = logic.addWorkTask(allState, { title: '任务2', priority: 2, dueDate: '2026-08-02' }).state;
  allState = logic.addStudyPlan(allState, { subject: '主题', durationMin: 60 }).state;
  allState = logic.addLifeMoment(allState, { content: '生活', mood: 'good', tags: ['x'], date: '2026-07-27' }).state;
  allState = logic.addReviewEntry(allState, { content: '复盘', rating: 4, periodType: 'week', periodStart: '2026-07-21', periodEnd: '2026-07-27' }).state;

  const pushB = await supabase.pushToCloud(allState);
  assert(pushB.ok, '8 表推送成功');
  // makeState 已有 bottles + settings，新模块各贡献 1-2 条 → 至少 7 个表请求
  // (bottles, settings, work, study, life, review) = 6 个表（checkins/diary 为空不发）
  const tableSet = new Set(pushCalls2.map(c => tableOf(c.url)));
  assert(tableSet.has('bottles') && tableSet.has('settings'), '包含 bottles+settings');
  assert(tableSet.has('work') && tableSet.has('study') && tableSet.has('life') && tableSet.has('review'), '包含 work+study+life+review');
  assert(!tableSet.has('checkins') && !tableSet.has('diary'), '空表不发请求');
  // 验证字段 snake_case
  const workPush = pushCalls2.find(c => c.url.indexOf('work_tasks') >= 0);
  assert(workPush && workPush.data[0].title === '任务1' && workPush.data[0].due_date === '2026-08-01', 'work 字段转 snake_case');
  assert(workPush && workPush.data[0].user_id === 'default', 'work user_id 正确');
  const reviewPush = pushCalls2.find(c => c.url.indexOf('review_entries') >= 0);
  assert(reviewPush && reviewPush.data[0].period_type === 'week' && reviewPush.data[0].period_end === '2026-07-27', 'review 字段转 snake_case');

  // 2. 拉取：云端有新模块数据，本地空 → 合并到本地
  pushCalls2 = [];
  cloudRows2 = {
    bottles: [{ user_id: 'default', id: 1, bottle_number: 1, total_pills: 30, remaining_pills: 20, start_date: '2026-07-01', is_active: true, created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z' }],
    checkins: [],
    settings: [{ user_id: 'default', reminder_time: '08:00', notification_enabled: false, low_threshold: 5, pills_per_day: 1, updated_at: '2026-07-01T00:00:00Z' }],
    diary: [],
    work: [
      { user_id: 'default', id: 100, title: '云端任务', done: false, priority: 2, due_date: '2026-08-15', created_at: '2026-07-15T00:00:00Z', updated_at: '2026-07-15T00:00:00Z' }
    ],
    study: [
      { user_id: 'default', id: 200, subject: '云端主题', content: '', duration_min: 90, completed: true, date: '2026-07-15', created_at: '2026-07-15T00:00:00Z', updated_at: '2026-07-15T00:00:00Z' }
    ],
    life: [
      { user_id: 'default', id: 300, content: '云端生活', mood: 'great', tags: ['cloud'], date: '2026-07-15', created_at: '2026-07-15T00:00:00Z', updated_at: '2026-07-15T00:00:00Z' }
    ],
    review: [
      { user_id: 'default', id: 400, period_type: 'month', period_start: '2026-07-01', period_end: '2026-07-31', content: '云端月度复盘', rating: 5, tags: ['月度'], created_at: '2026-07-31T00:00:00Z', updated_at: '2026-07-31T00:00:00Z' }
    ]
  };
  global.getApp = () => ({
    globalData: { state: logic.clone(logic.DEFAULT_DATA), syncStatus: 'offline', syncListeners: [] },
    _setSyncStatus: function (s) { this.globalData.syncStatus = s; }
  });
  const pullB = await supabase.pullFromCloud();
  assert(pullB.ok, '拉取成功');
  assert(pullB.state.work.tasks.length === 1 && pullB.state.work.tasks[0].title === '云端任务', '云端 work 合并');
  assert(pullB.state.study.plans.length === 1 && pullB.state.study.plans[0].subject === '云端主题', '云端 study 合并');
  assert(pullB.state.life.moments.length === 1 && pullB.state.life.moments[0].content === '云端生活', '云端 life 合并');
  assert(pullB.state.review.entries.length === 1 && pullB.state.review.entries[0].periodType === 'month', '云端 review 合并 + periodType camelCase 还原');

  // 3. 拉取：云端新模块空，本地有数据 → 保留 + 补推
  pushCalls2 = [];
  const localOnly = logic.clone(logic.DEFAULT_DATA);
  localOnly.work.tasks.push({ id: 555, title: '本地任务', done: false, priority: 1, dueDate: '2026-09-01', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z' });
  localOnly.review.entries.push({ id: 666, periodType: 'week', periodStart: '2026-08-25', periodEnd: '2026-08-31', content: '本地复盘', rating: 3, tags: [], createdAt: '2026-08-31T00:00:00Z', updatedAt: '2026-08-31T00:00:00Z' });
  global.getApp = () => ({
    globalData: { state: localOnly, syncStatus: 'offline', syncListeners: [] },
    _setSyncStatus: function (s) { this.globalData.syncStatus = s; }
  });
  cloudRows2 = { bottles: [], checkins: [], settings: [], diary: [], work: [], study: [], life: [], review: [] };
  const pullB2 = await supabase.pullFromCloud();
  assert(pullB2.ok, '拉取成功');
  assert(pullB2.state.work.tasks.some(t => t.title === '本地任务'), '本地 work 保留');
  assert(pullB2.state.review.entries.some(r => r.content === '本地复盘'), '本地 review 保留');
  assert(pushCalls2.some(c => c.url.indexOf('work_tasks') >= 0), '本地 work 补推');
  assert(pushCalls2.some(c => c.url.indexOf('review_entries') >= 0), '本地 review 补推');

  // 4. 转换器：8 表往返一致性
  const orig8 = makeState();
  orig8.meds.bottles[0].remainingPills = 17;
  orig8.work.tasks.push({ id: 111, title: '往返任务', done: true, priority: 2, dueDate: '2026-09-09', createdAt: '2026-09-09T00:00:00Z', updatedAt: '2026-09-09T00:00:00Z' });
  orig8.study.plans.push({ id: 222, subject: '往返主题', content: '内容', durationMin: 45, completed: false, date: '2026-09-09', createdAt: '2026-09-09T00:00:00Z', updatedAt: '2026-09-09T00:00:00Z' });
  orig8.life.moments.push({ id: 333, content: '往返生活', mood: 'good', tags: ['tag1'], date: '2026-09-09', createdAt: '2026-09-09T00:00:00Z', updatedAt: '2026-09-09T00:00:00Z' });
  orig8.review.entries.push({ id: 444, periodType: 'week', periodStart: '2026-09-01', periodEnd: '2026-09-07', content: '往返复盘', rating: 4, tags: ['t'], createdAt: '2026-09-07T00:00:00Z', updatedAt: '2026-09-07T00:00:00Z' });
  const roundTrip8 = supabase._rowsToState(supabase._stateToRows(orig8));
  assert(roundTrip8.meds.bottles[0].remainingPills === 17, '往返：bottle 余量');
  assert(roundTrip8.work.tasks[0].title === '往返任务' && roundTrip8.work.tasks[0].dueDate === '2026-09-09', '往返：work');
  assert(roundTrip8.study.plans[0].durationMin === 45 && roundTrip8.study.plans[0].subject === '往返主题', '往返：study');
  assert(roundTrip8.life.moments[0].content === '往返生活' && roundTrip8.life.moments[0].tags[0] === 'tag1', '往返：life');
  assert(roundTrip8.review.entries[0].periodType === 'week' && roundTrip8.review.entries[0].rating === 4, '往返：review');

  // 5. 高频压力：8 表同时大量数据 push/pull
  pushCalls2 = [];
  let stressState = makeState();
  for (let i = 0; i < 100; i++) {
    stressState = logic.addWorkTask(stressState, { title: `T${i}`, priority: 1 }).state;
    stressState = logic.addStudyPlan(stressState, { subject: `S${i}`, durationMin: i }).state;
    stressState = logic.addLifeMoment(stressState, { content: `L${i}`, mood: 'good', date: '2026-07-27' }).state;
    stressState = logic.addReviewEntry(stressState, { content: `R${i}`, rating: 3 }).state;
  }
  const stressPush = await supabase.pushToCloud(stressState);
  assert(stressPush.ok, '8 表压测推送成功');
  const workPushCount = pushCalls2.filter(c => c.url.indexOf('work_tasks') >= 0).length;
  const studyPushCount = pushCalls2.filter(c => c.url.indexOf('study_plans') >= 0).length;
  const lifePushCount = pushCalls2.filter(c => c.url.indexOf('life_moments') >= 0).length;
  const reviewPushCount = pushCalls2.filter(c => c.url.indexOf('review_entries') >= 0).length;
  assert(workPushCount === 1 && studyPushCount === 1 && lifePushCount === 1 && reviewPushCount === 1, `8 表并发 1 次请求/表 (work=${workPushCount},study=${studyPushCount},life=${lifePushCount},review=${reviewPushCount})`);
  // 验证各表推送的行数
  const workData = pushCalls2.find(c => c.url.indexOf('work_tasks') >= 0).data;
  assert(workData.length === 100, `work 一次推 100 行 (实际 ${workData.length})`);

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
