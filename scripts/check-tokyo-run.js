// 東京を走れ：エンジンのチェック
// 使い方: node scripts/check-tokyo-run.js
//
// 1. 空中で何度押しても、ジャンプは1回分しか効かないこと
// 2. 先読みで最適にジャンプするボットが、どの乱数でも60秒走り切れること
//    （＝ジャンプしても絶対に避けられない配置が出ないこと）
// 3. 時間とともに速く・忙しくなること

const E = require("../games/tokyo-run/engine.js");

let failed = 0;
function check(ok, message) {
  if (!ok) {
    failed++;
    console.error("NG: " + message);
  }
}

const DT = 1 / 60;
const clone = (s) => JSON.parse(JSON.stringify(s));

// ---- 1. 空中ジャンプ不可 ----
function jumpHeight(mash) {
  const s = E.create(1);
  s.untilNext = 1e9; // 障害物なし
  check(E.jump(s) === true, "地面でジャンプできない");
  let maxY = 0;
  for (let i = 0; i < 60; i++) {
    if (mash && i % 3 === 0 && i < 24) check(E.jump(s) === false, "空中でジャンプできてしまう");
    E.step(s, DT);
    maxY = Math.max(maxY, s.runner.y);
  }
  return { maxY, jumps: s.runner.jumps };
}
const single = jumpHeight(false);
const mashed = jumpHeight(true);
check(Math.abs(mashed.maxY - single.maxY) < 0.01, `空中連打で高さが変わった（${mashed.maxY.toFixed(1)} / 通常 ${single.maxY.toFixed(1)}）`);
check(mashed.jumps === 1, `空中連打でジャンプ回数が増えた（${mashed.jumps}回）`);

// ---- 2. 先読みボット ----

// delayフレーム待ってから跳んだら、着地後の次の障害物まで含めて生き残れるか
function survives(s, delayFrames, depth) {
  const c = clone(s);
  for (let i = 0; i < delayFrames; i++) {
    E.step(c, DT);
    if (c.over) return false;
  }
  E.jump(c);
  const start = c.t;
  while (!(c.runner.onGround && c.t - start > 0.05)) {
    E.step(c, DT);
    if (c.over) return false;
  }
  if (depth === 0) return true;
  // 着地後：しばらく跳ばずに済む or どこかで跳べば越えられる
  for (let d = 0; d <= 30; d += 2) {
    if (survives(c, d, depth - 1)) return true;
  }
  const w = clone(c);
  for (let i = 0; i < 30; i++) {
    E.step(w, DT);
    if (w.over) return false;
  }
  return true;
}

function obstacleAhead(s) {
  return s.obstacles.some((o) => o.x + o.w > E.RUNNER.x && o.x < E.RUNNER.x + 260);
}

function runBot(seed, seconds) {
  const s = E.create(seed);
  const log = { speedAt3: 0, speedAt30: 0, spawns: new Set(), maxGroup: 1 };
  let seen = 0;
  while (s.t < seconds && !s.over) {
    if (s.runner.onGround && obstacleAhead(s)) {
      // 次のフレームまで待っても大丈夫なら待つ。待つと危ないなら今跳ぶ
      if (!survives(s, 1, 1) && survives(s, 0, 1)) E.jump(s);
    }
    E.step(s, DT);
    s.obstacles.forEach((o) => {
      if (o.id > seen) {
        seen = o.id;
        log.spawns.add(o.type);
      }
    });
    if (!log.speedAt3 && s.t >= 3) log.speedAt3 = s.speed;
    if (!log.speedAt30 && s.t >= 30) log.speedAt30 = s.speed;
  }
  return { s, log };
}

const SEEDS = 40;
const seen = (s) => s.nextId - 1;
let minSurvive = Infinity;
const allTypes = new Set();
for (let seed = 1; seed <= SEEDS; seed++) {
  const { s, log } = runBot(seed * 7919, 60);
  minSurvive = Math.min(minSurvive, s.t);
  log.spawns.forEach((t) => allTypes.add(t));
  if (seed <= 3) console.log(`  seed ${seed}: ${s.t.toFixed(1)}秒 ${s.meters}m ジャンプ${s.runner.jumps}回 障害物${seen(s)}個 速度 ${log.speedAt3.toFixed(0)}→${log.speedAt30.toFixed(0)}`);
  check(!s.over, `seed ${seed}: ボットが ${s.t.toFixed(1)} 秒で ${s.hit && s.hit.type} に衝突（避けられない配置の可能性）`);
  check(log.speedAt30 > log.speedAt3 * 1.8, `seed ${seed}: 速度が上がっていない`);
}
check(allTypes.size === Object.keys(E.TYPES).length, `出てこない障害物がある: ${[...allTypes]}`);

// ---- 3. 序盤はやさしい：最初の8秒は小さい障害物だけ、間隔も広い ----
{
  const s = E.create(42);
  const early = [];
  while (s.t < 8) {
    s.runner.y = 999; // 当たらないように浮かせておく
    E.step(s, DT);
    s.obstacles.forEach((o) => early.includes(o.id) || early.push(o.id) && check(["cone", "bag", "puddle"].includes(o.type) && (o.type !== "puddle" || s.t >= 5), `序盤に ${o.type} が出た`));
  }
}

if (failed) {
  console.error(`\n${failed} 件の NG`);
  process.exit(1);
}
console.log(`OK: 空中ジャンプ不可 / ボットが ${SEEDS} 通りの乱数すべてで60秒走破（最短 ${minSurvive.toFixed(1)} 秒）/ 速度 ${E.speedAt(3).toFixed(0)}→${E.speedAt(30).toFixed(0)} / 障害物 ${allTypes.size} 種すべて出現`);
