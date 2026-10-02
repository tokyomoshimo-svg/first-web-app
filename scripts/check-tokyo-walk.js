// 東京、歩く。：移動と当たり判定のチェック
// 使い方: node scripts/check-tokyo-walk.js

const E = require("../games/tokyo-walk/engine.js");

const DT = 1 / 60;
let failed = 0;
const check = (ok, msg) => { if (!ok) { failed++; console.error("NG: " + msg); } };

// 一定の向きに歩き続け、そのあいだ一度も建物などに埋まらないか
function walk(s, ix, iz, seconds, label) {
  for (let i = 0; i < seconds * 60; i++) {
    E.step(s, DT, ix, iz, false);
    if (E.blocked(s.x, s.z)) {
      check(false, `${label}: (${s.x.toFixed(2)}, ${s.z.toFixed(2)}) で障害物にめり込んだ`);
      return s;
    }
  }
  return s;
}

// 1. スタート地点は空いている
const s0 = E.create();
check(!E.blocked(s0.x, s0.z), "スタート地点がふさがっている");

// 2. どの建物にも、4方向から歩いてぶつかってみる → すり抜けない・手前で止まる
let wallHits = 0;
for (const b of E.BUILDINGS) {
  const cx = b.x, cz = b.z;
  const tries = [
    { x: b.x - b.w / 2 - 1.5, z: cz, ix: 1, iz: 0, stop: (s) => s.x <= b.x - b.w / 2 - E.PLAYER.radius + 1e-6 },
    { x: b.x + b.w / 2 + 1.5, z: cz, ix: -1, iz: 0, stop: (s) => s.x >= b.x + b.w / 2 + E.PLAYER.radius - 1e-6 },
    { x: cx, z: b.z - b.d / 2 - 1.5, ix: 0, iz: 1, stop: (s) => s.z <= b.z - b.d / 2 - E.PLAYER.radius + 1e-6 },
    { x: cx, z: b.z + b.d / 2 + 1.5, ix: 0, iz: -1, stop: (s) => s.z >= b.z + b.d / 2 + E.PLAYER.radius - 1e-6 },
  ];
  for (const t of tries) {
    if (E.blocked(t.x, t.z) || Math.abs(t.x) > E.FIELD - 1 || Math.abs(t.z) > E.FIELD - 1) continue; // 置けない場所は飛ばす
    const s = Object.assign(E.create(), { x: t.x, z: t.z });
    walk(s, t.ix, t.iz, 4, `建物(${b.x},${b.z})へ突進`);
    check(t.stop(s), `建物(${b.x},${b.z})をすり抜けた: (${s.x.toFixed(2)}, ${s.z.toFixed(2)})`);
    wallHits++;
  }
}

// 3. 壁に斜めに当たると、壁に沿って滑る（止まりきらない）
{
  const b = E.BUILDINGS[0];
  const s = Object.assign(E.create(), { x: b.x - b.w / 2 - 1, z: b.z });
  walk(s, 1, 1, 1.5, "斜めに壁へ");
  check(s.z > b.z + 1, "壁に沿って滑らない");
}

// 4. 街灯・木をすり抜けない
for (const c of E.CIRCLES.slice(0, 10)) {
  const s = Object.assign(E.create(), { x: c.x - 2, z: c.z });
  if (E.blocked(s.x, s.z)) continue;
  walk(s, 1, 0, 2, `${c.ref.kind}へ突進`);
  check(Math.hypot(s.x - c.x, s.z - c.z) >= c.r + E.PLAYER.radius - 1e-6, `${c.ref.kind}(${c.x},${c.z}) をすり抜けた`);
}

// 5. フィールドの外に出られない（道路の先＝4方向の端）
for (const [ix, iz, x, z] of [[1, 0, 30, 0], [-1, 0, -30, 0], [0, 1, 0, 30], [0, -1, 0, -30]]) {
  const s = Object.assign(E.create(), { x, z });
  walk(s, ix, iz, 8, "端へ");
  const lim = E.FIELD - E.PLAYER.radius;
  check(Math.abs(s.x) <= lim + 1e-9 && Math.abs(s.z) <= lim + 1e-9, `フィールドの外に出た: (${s.x}, ${s.z})`);
  check(Math.abs(ix ? s.x : s.z) > lim - 0.01, `端まで歩けない: (${s.x}, ${s.z})`);
}

// 6. 速さの上限・ジャンプの高さ・空中で連打しても跳ばない
{
  const s = Object.assign(E.create(), { x: 0, z: 0 });
  let maxSpeed = 0;
  for (let i = 0; i < 120; i++) { E.step(s, DT, 1, 1, false); maxSpeed = Math.max(maxSpeed, Math.hypot(s.vx, s.vz)); }
  check(maxSpeed <= E.PLAYER.walkSpeed + 1e-6, `速すぎる: ${maxSpeed}`);

  const j = Object.assign(E.create(), { x: 0, z: 0 });
  E.step(j, DT, 0, 0, true);
  let apex = 0;
  for (let i = 0; i < 90; i++) { E.step(j, DT, 0, 0, i < 20); apex = Math.max(apex, j.y); }
  check(j.jumps === 1, `空中でもう一度跳べてしまう（${j.jumps}回）`);
  check(apex > 0.8 && apex < 1.4, `ジャンプの高さが想定外: ${apex.toFixed(2)}m`);
  check(j.onGround && j.y === 0, "着地しない");
  var jumpApex = apex;
}

// 7. ランダムに歩き回っても、一度も埋まらない・外に出ない
var wander = 0;
for (let run = 1; run <= 10; run++) {
  let seed = run * 7919;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const s = E.create();
  let ix = 0, iz = 0, maxDist = 0;
  for (let i = 0; i < 20000; i++) {
    if (i % 90 === 0) { const a = rnd() * Math.PI * 2; ix = Math.cos(a); iz = Math.sin(a); }
    E.step(s, DT, ix, iz, rnd() < 0.01);
    maxDist = Math.max(maxDist, Math.hypot(s.x, s.z));
    if (E.blocked(s.x, s.z)) { check(false, `ランダム歩行${run}で (${s.x.toFixed(2)}, ${s.z.toFixed(2)}) にめり込んだ`); break; }
  }
  wander = Math.max(wander, maxDist);
}

// 8. カメラの壁よけ：建物の向こう側にカメラがあると、手前で止まる
{
  const b = E.BUILDINGS[0];
  const t = E.cameraClip(b.x - b.w / 2 - 1, 1.4, b.z, b.x + b.w / 2 + 3, 4, b.z);
  check(t < 0.2, `建物越しのカメラが手前に来ない: t=${t}`);
  check(E.cameraClip(0, 1.4, 0, 0, 4.2, 7) === 1, "何もない道路でカメラが寄ってしまう");
}

if (failed) {
  console.error(`\n${failed} 件の NG`);
  process.exit(1);
}
console.log(`OK: 建物${E.BUILDINGS.length}棟に${wallHits}方向から突進してもすり抜けない / 壁ずり / 街灯・木 / 4方向の端で停止 / 最高速 ${E.PLAYER.walkSpeed}m/s / ジャンプ ${jumpApex.toFixed(2)}m・空中ジャンプなし / ランダム歩行2万歩×10回（最遠 ${wander.toFixed(1)}m） / カメラの壁よけ`);
