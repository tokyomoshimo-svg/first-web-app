// ラーメンを伸ばすな：ゲームバランスのチェック
// 使い方: node scripts/check-ramen.js
//
// ・何もしなくても約10秒は遊べる
// ・どんな遊び方でも 30秒前後までには終わる
// ・連打より、飲み込むリズムに合わせて食べるほうが高得点

const R = require("../games/ramen/engine.js");

const DT = 1 / 60;
let failed = 0;
const check = (ok, msg) => { if (!ok) { failed++; console.error("NG: " + msg); } };

// hz回/秒で食べる。jitter は間隔のゆらぎ（人間っぽさ）
function play(hz, jitter = 0, seed = 1) {
  const s = R.create();
  let next = 0;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  while (!s.over && s.t < 120) {
    if (hz > 0 && s.t >= next) {
      R.bite(s);
      next = s.t + (1 / hz) * (1 - jitter + 2 * jitter * rnd());
    }
    R.step(s, DT);
  }
  return s;
}

const idle = play(0);
check(idle.t >= 9 && idle.t <= 11, `何もしないときの時間が想定外: ${idle.t.toFixed(1)}秒`);

const rows = [];
for (const hz of [1.5, 2, 2.5, 3, 5, 8, 12]) {
  const runs = [1, 2, 3, 4, 5].map((seed) => play(hz, 0.4, seed));
  const avg = (f) => runs.reduce((a, s) => a + f(s), 0) / runs.length;
  const row = { hz, sec: avg((s) => s.t), score: avg((s) => s.score), chokes: avg((s) => s.chokes) };
  rows.push(row);
  check(row.sec <= 32, `${hz}回/秒で長く続きすぎる: ${row.sec.toFixed(1)}秒`);
}
const best = (list) => Math.max(...list.map((r) => r.score));
const rhythm = best(rows.filter((r) => r.hz <= 2.5));
const mash = best(rows.filter((r) => r.hz >= 5));
check(rhythm > mash * 1.3, `連打が強すぎる: リズム ${rhythm.toFixed(0)} / 連打 ${mash.toFixed(0)}`);

// むせたら少しの間食べられない
const s = R.create();
let r;
for (let i = 0; i < 10 && (!r || r.type !== "choke"); i++) r = R.bite(s);
check(r.type === "choke", "連続で食べてもむせない");
check(R.bite(s).type === "blocked", "むせている間に食べられてしまう");

rows.forEach((r) => console.log(`  ${String(r.hz).padStart(4)}回/秒: ${r.sec.toFixed(1)}秒 ${Math.round(r.score)}点 むせ${r.chokes.toFixed(1)}回`));
if (failed) {
  console.error(`\n${failed} 件の NG`);
  process.exit(1);
}
console.log(`OK: 放置 ${idle.t.toFixed(1)}秒 / リズム最高 ${rhythm.toFixed(0)}点 > 連打最高 ${mash.toFixed(0)}点 / むせ判定OK`);
