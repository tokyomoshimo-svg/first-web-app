// 東京、歩く。：移動と当たり判定のチェック
// 使い方: node scripts/check-tokyo-walk.js

const E = require("../games/tokyo-walk/engine.js");
const MS = require("../games/tokyo-walk/mission.js");

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
for (const b of [...E.BUILDINGS, ...E.INFILL, ...E.BACKS]) {
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

// 9. 小物が増えても、街じゅうに歩いて行ける（0.25m 刻みの格子で、スタートから幅優先探索）
var reachTargets = 0;
{
  const STEP = 0.25;
  const N = Math.round((E.FIELD * 2) / STEP);
  const idx = (x, z) => Math.round((x + E.FIELD) / STEP) * (N + 1) + Math.round((z + E.FIELD) / STEP);
  const seen = new Uint8Array((N + 1) * (N + 1));
  const s0 = E.create();
  const sx = Math.round(s0.x / STEP) * STEP, sz = Math.round(s0.z / STEP) * STEP;
  const queue = [[sx, sz]];
  seen[idx(sx, sz)] = 1;
  while (queue.length) {
    const [x, z] = queue.pop();
    for (const [dx, dz] of [[STEP, 0], [-STEP, 0], [0, STEP], [0, -STEP]]) {
      const nx = +(x + dx).toFixed(3), nz = +(z + dz).toFixed(3);
      if (Math.abs(nx) > E.FIELD || Math.abs(nz) > E.FIELD) continue;
      const k = idx(nx, nz);
      if (seen[k] || E.blocked(nx, nz)) continue;
      seen[k] = 1;
      queue.push([nx, nz]);
    }
  }
  const reach = (x, z, label) => {
    reachTargets++;
    // 目標のまわり 0.75m 以内のどこかに行ければよい
    for (let dx = -0.75; dx <= 0.75; dx += STEP) for (let dz = -0.75; dz <= 0.75; dz += STEP) if (seen[idx(x + dx, z + dz)]) return;
    check(false, `${label} (${x}, ${z}) に歩いて行けない`);
  };
  // 4つの区画の歩道と、道路の向こう側
  for (const [x, z] of [[20, -5.5], [-20, -5.5], [20, 5.5], [-20, 5.5], [5.5, -20], [-5.5, -20], [5.5, 20], [-5.5, 20], [30, 0], [-30, 0], [0, 30], [0, -30]]) reach(x, z, "歩道・道路");
  // すべてのお店の正面（ひさしの下）
  for (const a of E.AWNINGS) reach(+(a.x + a.towardX * 0.9).toFixed(2), +(a.z + a.towardZ * 0.9).toFixed(2), `お店「${a.ref.shop}」の前`);
  // 公園・コインパーキングの中・横断歩道
  reach(-27, 20, "公園");
  reach(30, -13, "コインパーキングの中");
  for (const [x, z] of [[0, 5.4], [0, -5.4], [5.4, 0], [-5.4, 0]]) reach(x, z, "横断歩道");
}

// 10. 歩きやすさ：歩道の「歩く場所」（車道の端から 1.2〜3.0m）を、まっすぐ端から端まで一度も減速せずに歩ける
//     （電柱・街灯・街路樹は車道寄り、小物は壁ぎわに置いてあるので、よけながら進まなくてよい）
var laneCount = 0;
for (const arm of ["E", "W", "S", "N"]) for (const side of [-1, 1]) for (let off = 1.2; off <= 3.01; off += 0.3) for (const dir of [1, -1]) {
  const pos = (t) => (arm === "E" ? [t, side * (E.ROAD + off)] : arm === "W" ? [-t, side * (E.ROAD + off)] : arm === "S" ? [side * (E.ROAD + off), t] : [side * (E.ROAD + off), -t]);
  const [x0, z0] = pos(dir > 0 ? 8 : 38);
  const [x1, z1] = pos(dir > 0 ? 38 : 8);
  const s = Object.assign(E.create(), { x: x0, z: z0 });
  const len = Math.hypot(x1 - x0, z1 - z0);
  const ix = (x1 - x0) / len, iz = (z1 - z0) / len;
  let slow = 0, ok = false;
  for (let f = 0; f < 60 * 15 && !ok; f++) {
    E.step(s, DT, ix, iz, false);
    if (f > 30 && Math.hypot(s.vx, s.vz) < E.PLAYER.walkSpeed * 0.85) slow++;
    ok = (s.x - x1) * ix + (s.z - z1) * iz >= 0;
  }
  laneCount++;
  if (!ok || slow) check(false, `歩道(${arm}${side > 0 ? "+" : "-"}, 車道から${off.toFixed(1)}m)をまっすぐ歩くと引っかかる（減速 ${slow} フレーム）`);
}

// 11. 歩道を歩いている間、カメラが壁よけで寄ったり離れたりしない（カメラの位置は app.js と同じ：後ろ 6.4m・高さ 3.4m）
{
  let clipped = 0, samples = 0;
  for (const arm of ["E", "W", "S", "N"]) for (const side of [-1, 1]) for (let t = 10; t <= 38; t += 0.5) {
    const off = E.ROAD + 2.2;
    const [x, z] = arm === "E" ? [t, side * off] : arm === "W" ? [-t, side * off] : arm === "S" ? [side * off, t] : [side * off, -t];
    // 進む向きの真後ろにカメラ
    const back = arm === "E" ? [-1, 0] : arm === "W" ? [1, 0] : arm === "S" ? [0, -1] : [0, 1];
    samples++;
    if (E.cameraClip(x, 1.55, z, x + back[0] * 6.4, 3.4, z + back[1] * 6.4) < 1) clipped++;
  }
  check(clipped === 0, `歩道を歩くとカメラが寄ってしまう（${samples}か所中 ${clipped}か所）`);
  var camSamples = samples;
}

// 12. ダッシュ：少しずつ速くなり、上限は dashSpeed。スタミナが減り、切れると走れず、休むと戻る
var dashInfo = {};
{
  const s = Object.assign(E.create(), { x: 0, z: 30 });
  let t5 = null, maxSpeed = 0, emptyAt = null;
  for (let i = 0; i < 60 * 8; i++) {
    E.step(s, DT, 0, -1, false, true);
    maxSpeed = Math.max(maxSpeed, s.speed);
    if (t5 === null && s.speed > 5.3) t5 = i / 60;
    if (emptyAt === null && s.tired) emptyAt = i / 60;
    if (s.z < -30) { s.z = 30; } // 道路の上を往復するかわりに、位置だけ戻す
  }
  check(maxSpeed <= E.PLAYER.dashSpeed + 1e-6, `ダッシュが速すぎる: ${maxSpeed}`);
  check(maxSpeed > E.PLAYER.walkSpeed * 1.5, `ダッシュが遅い: ${maxSpeed}`);
  check(t5 !== null && t5 > 0.25 && t5 < 1.2, `走り出しが急すぎる／遅すぎる: ${t5}秒`);
  check(emptyAt !== null && emptyAt > 3 && emptyAt < 5.5, `スタミナが切れるまでの時間が想定外: ${emptyAt}秒`);
  // 切れた直後はボタンを押していても歩く速さ
  const tired = Object.assign(E.create(), { x: 0, z: 30, stamina: 0, tired: true });
  let sp = 0;
  for (let i = 0; i < 30; i++) { E.step(tired, DT, 0, -1, false, true); sp = Math.max(sp, tired.speed); }
  check(sp <= E.PLAYER.walkSpeed + 1e-6, `スタミナ切れなのに走れる: ${sp}`);
  // 休むと戻る：立ち止まって満タンまで
  let full = null;
  const rest = Object.assign(E.create(), { x: 0, z: 30, stamina: 0, tired: true });
  for (let i = 0; i < 60 * 6 && full === null; i++) { E.step(rest, DT, 0, 0, false, false); if (rest.stamina >= 1) full = i / 60; }
  check(full !== null && full < 4, `スタミナが戻らない: ${full}`);
  // 走って止まる：指を離してから 0.4 秒でほぼ止まる
  const stop = Object.assign(E.create(), { x: 0, z: 30 });
  for (let i = 0; i < 90; i++) E.step(stop, DT, 0, -1, false, true);
  for (let i = 0; i < 24; i++) E.step(stop, DT, 0, 0, false, false);
  check(stop.speed < 0.3, `止まるまで滑りすぎる: ${stop.speed}`);
  dashInfo = { maxSpeed, t5, emptyAt, full };
}

// 13. ダッシュ・ダッシュジャンプでも建物をすり抜けない／外に出ない
{
  let n = 0;
  for (const b of [...E.BUILDINGS, ...E.INFILL, ...E.BACKS]) {
    for (const [ix, iz, x, z] of [[1, 0, b.x - b.w / 2 - 6, b.z], [-1, 0, b.x + b.w / 2 + 6, b.z], [0, 1, b.x, b.z - b.d / 2 - 6], [0, -1, b.x, b.z + b.d / 2 + 6]]) {
      if (Math.abs(x) > E.FIELD - 1 || Math.abs(z) > E.FIELD - 1 || E.blocked(x, z)) continue;
      for (const jumpAt of [-1, 20]) {
        const s = Object.assign(E.create(), { x, z });
        for (let i = 0; i < 60 * 4; i++) {
          E.step(s, DT, ix, iz, i === jumpAt, true);
          if (E.blocked(s.x, s.z)) { check(false, `ダッシュで建物(${b.x},${b.z})にめり込んだ`); break; }
        }
        const inside = s.x > b.x - b.w / 2 && s.x < b.x + b.w / 2 && s.z > b.z - b.d / 2 && s.z < b.z + b.d / 2;
        check(!inside, `ダッシュで建物(${b.x},${b.z})をすり抜けた`);
        n++;
      }
    }
  }
  // ダッシュ＋ジャンプを混ぜてランダムに走り回る
  for (let run = 1; run <= 6; run++) {
    let seed = run * 104729;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const s = E.create();
    let ix = 0, iz = 0, dash = false;
    for (let i = 0; i < 20000; i++) {
      if (i % 70 === 0) { const a = rnd() * Math.PI * 2; ix = Math.cos(a); iz = Math.sin(a); dash = rnd() < 0.6; }
      E.step(s, DT, ix, iz, rnd() < 0.02, dash);
      if (E.blocked(s.x, s.z)) { check(false, `ダッシュのランダム走行${run}で (${s.x.toFixed(2)}, ${s.z.toFixed(2)}) にめり込んだ`); break; }
      if (s.y < 0 || s.y > 1.2) { check(false, `高さがおかしい: ${s.y}`); break; }
    }
  }
  // ダッシュジャンプの距離：歩きジャンプより遠く、でも 4.5m 以内（建物は飛び越えられない）
  const dist = (dash) => {
    const s = Object.assign(E.create(), { x: 0, z: 30 });
    for (let i = 0; i < 90; i++) E.step(s, DT, 0, -1, false, dash);
    const z0 = s.z;
    E.step(s, DT, 0, -1, true, dash);
    let apex = 0;
    while (!s.onGround) { E.step(s, DT, 0, -1, false, dash); apex = Math.max(apex, s.y); }
    return { d: z0 - s.z, apex, landed: s.landed };
  };
  const wj = dist(false), dj = dist(true);
  check(dj.d > wj.d + 0.8 && dj.d < 4.5, `ダッシュジャンプの距離が想定外: 歩き ${wj.d.toFixed(2)}m / 走り ${dj.d.toFixed(2)}m`);
  check(Math.abs(dj.apex - wj.apex) < 0.01, "ダッシュで高く跳べてしまう");
  check(dj.landed > wj.landed, "ダッシュジャンプの着地が弱い");
  dashInfo.dashCases = n;
  dashInfo.jump = `歩き ${wj.d.toFixed(1)}m / 走り ${dj.d.toFixed(1)}m`;
}

// 14. 探索ミッション：すべての候補地点が、建物・壁・外でなく、ほかの小物と重ならず、歩いて行ける
//     （0.25m の格子でスタートから幅優先探索。道のりも求める）
var missionInfo = {};
{
  const STEP = 0.25;
  const N = Math.round((E.FIELD * 2) / STEP) + 1;
  const ix = (v) => Math.round((v + E.FIELD) / STEP);
  const dist = new Float32Array(N * N).fill(-1);
  const parent = new Int32Array(N * N).fill(-1);
  const s0 = E.create();
  const k0 = ix(s0.x) * N + ix(s0.z);
  dist[k0] = 0;
  const queue = [k0];
  for (let qi = 0; qi < queue.length; qi++) {
    const k = queue[qi];
    const gx = Math.floor(k / N), gz = k % N;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = gx + dx, nz = gz + dz;
      if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
      const nk = nx * N + nz;
      if (dist[nk] >= 0 || E.blocked(nx * STEP - E.FIELD, nz * STEP - E.FIELD)) continue;
      dist[nk] = dist[k] + STEP;
      parent[nk] = k;
      queue.push(nk);
    }
  }
  // 目的物を見つけられる（発見の範囲に入れる）いちばん近い格子
  const goalOf = (m) => {
    let best = -1;
    for (let k = 0; k < N * N; k++) {
      if (dist[k] < 0) continue;
      const x = Math.floor(k / N) * STEP - E.FIELD, z = (k % N) * STEP - E.FIELD;
      // 範囲のふちぎりぎりではなく、0.3m 内側まで入れること
      const inside = m.area ? MS.isFound(m, x, z) && MS.isFound(m, x - 0.3, z - 0.3) && MS.isFound(m, x + 0.3, z + 0.3) : Math.hypot(x - m.x, z - m.z) <= m.r - 0.3;
      if (inside && (best < 0 || dist[k] < dist[best])) best = k;
    }
    return best;
  };
  const all = MS.allMissions(E);
  const types = new Set(all.map((m) => m.type));
  check(types.size === MS.TYPES.length, `目的の種類が足りない: ${[...types]}`);
  const pathLen = {};
  for (const m of all) {
    if (m.spawn) {
      // 置く物が建物の中・フィールドの外・ほかの小物の上にない
      check(Math.abs(m.x) < E.FIELD - 0.5 && Math.abs(m.z) < E.FIELD - 0.5, `${m.key} がフィールドの外`);
      const inBuilding = E.BOXES.some((b) => b.ref.h && m.x > b.minX && m.x < b.maxX && m.z > b.minZ && m.z < b.maxZ);
      check(!inBuilding, `${m.key} が建物の中`);
      const near = E.PROPS.find((p) => Math.hypot(p.x - m.x, p.z - m.z) < (p.kind === "bikes" ? 1.6 : 1.0));
      check(!near, `${m.key} が ${near && near.kind}(${near && near.x},${near && near.z}) と重なる`);
      if (m.spawn === "vending") {
        // 自販機は背中を壁につける（壁から 0.45m 以内に建物がある）
        const back = [[0, -1], [1, 0], [0, 1], [-1, 0]][m.rot];
        const wall = E.BOXES.some((b) => b.ref.h && m.x - back[0] * 0.6 > b.minX && m.x - back[0] * 0.6 < b.maxX && m.z - back[1] * 0.6 > b.minZ && m.z - back[1] * 0.6 < b.maxZ);
        check(wall, `${m.key} の背中に壁がない`);
      }
    }
    const g = goalOf(m);
    check(g >= 0, `${m.key}（${m.label}）に歩いて行けない`);
    if (g >= 0) {
      pathLen[m.key] = dist[g];
      check(dist[g] >= 18 && dist[g] <= 110, `${m.key} の道のりが近すぎる／遠すぎる: ${dist[g]}m`);
    }
  }

  // 15. 100回ランダムに目的を選び、道順どおりに歩く・走るボットで本当に見つけられるか（3分以内・走ると早い）
  const pathTo = (g) => { const out = []; for (let k = g; k >= 0; k = parent[k]) out.push(k); return out.reverse().map((k) => [Math.floor(k / N) * STEP - E.FIELD, (k % N) * STEP - E.FIELD]); };
  const play = (m, dash) => {
    const path = pathTo(goalOf(m));
    const way = path.filter((_, i) => i % 4 === 0 || i === path.length - 1);
    const s = E.create();
    let w = 0, t = 0, lastProgress = 0, best = 1e9;
    while (t < MS.TIME_LIMIT) {
      while (w < way.length - 1 && Math.hypot(way[w][0] - s.x, way[w][1] - s.z) < 0.7) w++;
      const dx = way[w][0] - s.x, dz = way[w][1] - s.z;
      const len = Math.hypot(dx, dz) || 1;
      E.step(s, DT, dx / len, dz / len, false, dash);
      t += DT;
      if (E.blocked(s.x, s.z)) return { ok: false, why: "めり込み" };
      if (MS.isFound(m, s.x, s.z)) return { ok: true, t };
      const left = (way.length - w) * 100 + len;
      if (left < best - 0.05) { best = left; lastProgress = t; }
      if (t - lastProgress > 4) return { ok: false, why: `引っかかって進めない (${s.x.toFixed(1)}, ${s.z.toFixed(1)})` };
    }
    return { ok: false, why: "時間切れ" };
  };
  let seed = 20261002;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const seenKeys = new Set(), seenTypes = new Set();
  let last = null, sumWalk = 0, sumDash = 0, maxWalk = 0, minWalk = 1e9, faster = 0, repeats = 0;
  const RUNS = 100;
  for (let r = 0; r < RUNS; r++) {
    const m = MS.pick(E, rnd, last);
    if (last && m.key === last) repeats++;
    last = m.key;
    seenKeys.add(m.key);
    seenTypes.add(m.type);
    const wk = play(m, false), dh = play(m, true);
    check(wk.ok, `ボット(歩き)が ${m.key} を見つけられない: ${wk.why}`);
    check(dh.ok, `ボット(ダッシュ)が ${m.key} を見つけられない: ${dh.why}`);
    if (wk.ok && dh.ok) {
      sumWalk += wk.t; sumDash += dh.t;
      maxWalk = Math.max(maxWalk, wk.t); minWalk = Math.min(minWalk, wk.t);
      if (dh.t < wk.t) faster++;
    }
  }
  check(repeats === 0, `同じ目的が続けて出た: ${repeats}回`);
  check(seenTypes.size === MS.TYPES.length, `100回で出なかった種類がある: ${[...seenTypes]}`);
  check(maxWalk < MS.TIME_LIMIT * 0.4, `歩きで道順どおりでも時間がかかりすぎる: ${maxWalk.toFixed(1)}秒`);
  check(minWalk > 5, `すぐ見つかってしまう目的がある: ${minWalk.toFixed(1)}秒`);
  check(faster >= RUNS * 0.95, `ダッシュしても早くならない目的が多い: ${faster}/${RUNS}`);
  // 点数
  check(MS.score(150).total === 200 && MS.score(120).total === 200 && MS.score(119.9).total === 150 && MS.score(60).total === 150 && MS.score(59).total === 125 && MS.score(30).total === 125 && MS.score(29.9).total === 100, "時間ボーナスの計算が違う");
  // 発見判定（公園は中に入ったら、ほかは半径の中）
  const pk = MS.allMissions(E).find((m) => m.type === "park");
  check(MS.isFound(pk, -27, 16) && !MS.isFound(pk, -27, 7.0), "公園の発見判定が違う");
  const lens = Object.values(pathLen);
  missionInfo = { spots: all.length, types: types.size, minPath: Math.min(...lens), maxPath: Math.max(...lens), keys: seenKeys.size, walk: sumWalk / RUNS, dash: sumDash / RUNS, minWalk, maxWalk, faster };
}

if (failed) {
  console.error(`\n${failed} 件の NG`);
  process.exit(1);
}
console.log(`OK: 建物${E.BUILDINGS.length + E.INFILL.length + E.BACKS.length}棟（お店${E.BUILDINGS.length}軒）に${wallHits}方向から突進してもすり抜けない / 壁ずり / 街灯・木 / 4方向の端で停止 / 最高速 ${E.PLAYER.walkSpeed}m/s / ジャンプ ${jumpApex.toFixed(2)}m・空中ジャンプなし / ランダム歩行2万歩×10回（最遠 ${wander.toFixed(1)}m） / カメラの壁よけ / 街の${reachTargets}か所すべてに歩いて行ける / 歩道の${laneCount}レーンを減速せずに歩ける / 歩道${camSamples}か所でカメラが寄らない / ダッシュ 最高 ${dashInfo.maxSpeed.toFixed(1)}m/s（${dashInfo.t5.toFixed(2)}秒で加速）・スタミナ ${dashInfo.emptyAt.toFixed(1)}秒で切れて ${dashInfo.full.toFixed(1)}秒で回復 / ダッシュ・ダッシュジャンプで${dashInfo.dashCases}回突進・ランダム走行6回 すり抜けなし / ジャンプ距離 ${dashInfo.jump}`);
console.log(`OK: 探索の目的 ${missionInfo.types}種類・候補 ${missionInfo.spots}か所すべてに歩いて行ける（道のり ${missionInfo.minPath.toFixed(0)}〜${missionInfo.maxPath.toFixed(0)}m） / 100回のランダム選択で${missionInfo.keys}か所が出た・同じ目的は連続しない / 道順どおりのボット：歩き 平均${missionInfo.walk.toFixed(1)}秒（${missionInfo.minWalk.toFixed(1)}〜${missionInfo.maxWalk.toFixed(1)}秒）・ダッシュ 平均${missionInfo.dash.toFixed(1)}秒（${missionInfo.faster}/100回で短縮） / 時間ボーナス・発見判定`);
