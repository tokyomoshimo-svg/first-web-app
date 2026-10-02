// 東京、歩く。：街のデータと、移動・当たり判定・カメラの壁よけ（Three.js に依存しない）
//
// 座標：x = 東(+)・西(-)、z = 南(+)・北(-)、y = 上。単位はメートル。
// 当たり判定は真上から見た2Dで行う（建物などは高さに関係なく通れない）。

const TokyoWalkEngine = (() => {
  "use strict";

  const FIELD = 40; // フィールドは -40〜40 の正方形
  const ROAD = 4; // 道路の半幅（交差点を中心に東西・南北の2本）
  const SIDEWALK = 7; // 歩道の外側の位置

  const PLAYER = {
    radius: 0.4,
    walkSpeed: 3.4, // m/秒（小走りくらい）
    accel: 14,
    gravity: 20,
    jumpSpeed: 6.6, // 最高到達点 約1.1m
  };

  // ---------- 街のデータ ----------

  // 建物：中心(x,z)、幅w(東西)、奥行きd(南北)、高さh、色、屋上の看板
  const BUILDINGS = [
    // 北東ブロック
    { x: 14, z: -14, w: 10, d: 9, h: 14, color: "#f2b5a6", sign: "カフェ" },
    { x: 30, z: -13, w: 11, d: 8, h: 9, color: "#a9d3e8" },
    { x: 13, z: -30, w: 9, d: 11, h: 20, color: "#d8d2f0", sign: "TOKYO" },
    { x: 29, z: -30, w: 12, d: 11, h: 11, color: "#f6dfa0" },
    // 北西ブロック
    { x: -14, z: -13, w: 10, d: 8, h: 10, color: "#bfe3c4", sign: "ラーメン" },
    { x: -30, z: -14, w: 11, d: 10, h: 16, color: "#f3c7d8" },
    { x: -14, z: -30, w: 10, d: 11, h: 8, color: "#f0d6b4" },
    { x: -30, z: -30, w: 11, d: 11, h: 13, color: "#c4cdea", sign: "24H" },
    // 南東ブロック
    { x: 14, z: 14, w: 10, d: 10, h: 12, color: "#c6e2f3", sign: "本屋" },
    { x: 30, z: 13, w: 11, d: 9, h: 7, color: "#f4c8b0" },
    { x: 14, z: 30, w: 10, d: 11, h: 9, color: "#e3e6b8" },
    { x: 30, z: 30, w: 11, d: 11, h: 17, color: "#e8c2e6", sign: "銭湯" },
    // 南西ブロック（半分は小さな公園）
    { x: -14, z: 14, w: 10, d: 9, h: 11, color: "#f7d2a8", sign: "コンビニ" },
    { x: -30, z: 30, w: 11, d: 11, h: 9, color: "#bfd8c9" },
  ];

  // 小物：kind = lamp | tree | vending | signboard
  const PROPS = [];
  // 街灯：歩道の外側に等間隔
  for (const s of [-1, 1]) {
    for (const t of [-34, -22, -10, 10, 22, 34]) {
      PROPS.push({ kind: "lamp", x: t, z: s * (SIDEWALK - 0.5), r: 0.2 });
      PROPS.push({ kind: "lamp", x: s * (SIDEWALK - 0.5), z: t, r: 0.2 });
    }
  }
  // 街路樹
  for (const [x, z] of [[-16, 6], [16, -6], [6, 30], [-6, -18], [-6, 30], [6, -32], [28, 6], [-28, -6]]) {
    PROPS.push({ kind: "tree", x, z, r: 0.55 });
  }
  // 公園の木
  for (const [x, z] of [[-26, 12], [-33, 16], [-29, 20], [-22, 22], [-34, 10], [-12, 28], [-17, 33]]) {
    PROPS.push({ kind: "tree", x, z, r: 0.55, park: true });
  }
  // 自動販売機（建物の前）
  for (const [x, z, rot] of [[9.6, -9, 0], [-8.4, 9.6, 1], [26, 8.0, 2], [-21, -8.4, 2], [8.0, 26, 3]]) {
    PROPS.push({ kind: "vending", x, z, w: 1.0, d: 0.8, rot });
  }
  // 立て看板
  for (const [x, z, text] of [[12.5, 7.6, "OPEN"], [-12.5, -7.6, "ラーメン"], [7.6, -24, "→ 駅"], [-24, 7.6, "公園"]]) {
    PROPS.push({ kind: "signboard", x, z, w: 0.9, d: 0.5, text });
  }

  // ---------- 当たり判定用の形 ----------

  // 箱（AABB）：建物・自販機・立て看板。h はカメラの壁よけ用の高さ
  const BOXES = [
    ...BUILDINGS.map((b) => ({ minX: b.x - b.w / 2, maxX: b.x + b.w / 2, minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2, h: b.h, ref: b })),
    ...PROPS.filter((p) => p.kind === "vending" || p.kind === "signboard").map((p) => {
      const turned = p.rot === 1 || p.rot === 3;
      const w = turned ? p.d : p.w;
      const d = turned ? p.w : p.d;
      return { minX: p.x - w / 2, maxX: p.x + w / 2, minZ: p.z - d / 2, maxZ: p.z + d / 2, h: p.kind === "vending" ? 1.8 : 1.1, ref: p };
    }),
  ];

  // 1階のひさし（道路側に張り出す）：見た目とカメラの壁よけで共有する
  const AWNINGS = BUILDINGS.map((b) => {
    const towardX = Math.abs(b.x) < Math.abs(b.z) ? 0 : -Math.sign(b.x);
    const towardZ = towardX === 0 ? -Math.sign(b.z) : 0;
    const w = towardX ? 0.9 : b.w * 0.7;
    const d = towardZ ? 0.9 : b.d * 0.7;
    const x = b.x + towardX * (b.w / 2 + 0.45);
    const z = b.z + towardZ * (b.d / 2 + 0.45);
    return { x, z, w, d, y: 3.1, towardX, towardZ, ref: b };
  });

  // 円：街灯の柱・木の幹
  const CIRCLES = PROPS.filter((p) => p.kind === "lamp" || p.kind === "tree").map((p) => ({ x: p.x, z: p.z, r: p.r, ref: p }));

  // ---------- プレイヤー ----------

  function create() {
    return {
      x: 5.6, // 東側の歩道から北を向いてスタート
      y: 0,
      z: 14,
      vx: 0,
      vz: 0,
      vy: 0,
      onGround: true,
      facing: Math.PI, // -z（北）向き
      moving: 0, // 0〜1：歩きアニメの強さ
      jumps: 0,
    };
  }

  // 点が建物などに埋まっていないか（テスト用）
  function blocked(x, z, r = PLAYER.radius) {
    if (Math.abs(x) > FIELD - r + 1e-6 || Math.abs(z) > FIELD - r + 1e-6) return true;
    for (const b of BOXES) {
      if (x > b.minX - r + 1e-6 && x < b.maxX + r - 1e-6 && z > b.minZ - r + 1e-6 && z < b.maxZ + r - 1e-6) return true;
    }
    for (const c of CIRCLES) {
      if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + r) ** 2 - 1e-6) return true;
    }
    return false;
  }

  // x方向・z方向に分けて動かし、ぶつかったら手前で止める（壁に沿って滑れる）
  function moveAxis(s, dx, dz) {
    const r = PLAYER.radius;
    let nx = s.x + dx;
    let nz = s.z + dz;
    for (const b of BOXES) {
      if (nx > b.minX - r && nx < b.maxX + r && nz > b.minZ - r && nz < b.maxZ + r) {
        if (dx > 0) nx = b.minX - r;
        else if (dx < 0) nx = b.maxX + r;
        if (dz > 0) nz = b.minZ - r;
        else if (dz < 0) nz = b.maxZ + r;
      }
    }
    s.x = nx;
    s.z = nz;
  }

  function pushOutOfCircles(s) {
    const r = PLAYER.radius;
    for (const c of CIRCLES) {
      const dx = s.x - c.x;
      const dz = s.z - c.z;
      const dist = Math.hypot(dx, dz);
      const min = c.r + r;
      if (dist < min) {
        if (dist < 1e-6) {
          s.x += min; // ちょうど中心に重なったときは東へ押し出す
        } else {
          const k = (min - dist) / dist;
          s.x += dx * k;
          s.z += dz * k;
        }
      }
    }
  }

  // 箱に重なっていたら、いちばん浅い方向へ押し出す（柱に押されて箱へ入った場合の保険）
  function pushOutOfBoxes(s) {
    const r = PLAYER.radius;
    for (const b of BOXES) {
      if (s.x > b.minX - r && s.x < b.maxX + r && s.z > b.minZ - r && s.z < b.maxZ + r) {
        const left = s.x - (b.minX - r);
        const right = b.maxX + r - s.x;
        const top = s.z - (b.minZ - r);
        const bottom = b.maxZ + r - s.z;
        const m = Math.min(left, right, top, bottom);
        if (m === left) s.x = b.minX - r;
        else if (m === right) s.x = b.maxX + r;
        else if (m === top) s.z = b.minZ - r;
        else s.z = b.maxZ + r;
      }
    }
  }

  // 入力 ix, iz は「ワールド座標での向き」（長さ0〜1）。app.js がカメラの向きから変換して渡す
  function step(s, dt, ix, iz, jump) {
    dt = Math.min(dt, 0.05);
    const len = Math.hypot(ix, iz);
    if (len > 1) {
      ix /= len;
      iz /= len;
    }

    // 速度をなめらかに目標へ
    const tx = ix * PLAYER.walkSpeed;
    const tz = iz * PLAYER.walkSpeed;
    const a = Math.min(1, PLAYER.accel * dt);
    s.vx += (tx - s.vx) * a;
    s.vz += (tz - s.vz) * a;

    // ジャンプ
    if (jump && s.onGround) {
      s.vy = PLAYER.jumpSpeed;
      s.onGround = false;
      s.jumps++;
    }
    if (!s.onGround) {
      s.vy -= PLAYER.gravity * dt;
      s.y += s.vy * dt;
      if (s.y <= 0) {
        s.y = 0;
        s.vy = 0;
        s.onGround = true;
      }
    }

    // 移動と当たり判定（大きく動くときは分割）
    const steps = Math.max(1, Math.ceil((Math.hypot(s.vx, s.vz) * dt) / 0.2));
    for (let i = 0; i < steps; i++) {
      moveAxis(s, (s.vx * dt) / steps, 0);
      moveAxis(s, 0, (s.vz * dt) / steps);
      // 柱と箱が近い場所でも、どちらにもめり込まない位置に落ち着くまで数回くり返す
      for (let k = 0; k < 3; k++) {
        pushOutOfCircles(s);
        pushOutOfBoxes(s);
      }
    }

    // フィールドの外には出られない
    const lim = FIELD - PLAYER.radius;
    s.x = Math.max(-lim, Math.min(lim, s.x));
    s.z = Math.max(-lim, Math.min(lim, s.z));

    // 向きと歩きアニメ
    const speed = Math.hypot(s.vx, s.vz);
    if (speed > 0.3) {
      const target = Math.atan2(s.vx, s.vz);
      let diff = target - s.facing;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      s.facing += diff * Math.min(1, 12 * dt);
    }
    s.moving = Math.min(1, speed / PLAYER.walkSpeed);
  }

  // ---------- カメラの壁よけ ----------

  // カメラの視線をさえぎるもの（3Dの箱）：建物・ひさし・木の葉
  const CAMERA_BLOCKERS = [
    ...BOXES.filter((b) => b.h >= 2).map((b) => ({ minX: b.minX - 0.25, maxX: b.maxX + 0.25, minY: 0, maxY: b.h + 0.3, minZ: b.minZ - 0.25, maxZ: b.maxZ + 0.25 })),
    ...AWNINGS.map((a) => ({ minX: a.x - a.w / 2 - 0.1, maxX: a.x + a.w / 2 + 0.1, minY: a.y - 0.2, maxY: a.y + 0.2, minZ: a.z - a.d / 2 - 0.1, maxZ: a.z + a.d / 2 + 0.1 })),
    ...PROPS.filter((p) => p.kind === "tree").map((p) => ({ minX: p.x - 1.4, maxX: p.x + 1.4, minY: 1.0, maxY: 3.8, minZ: p.z - 1.4, maxZ: p.z + 1.4 })),
  ];

  // from → to の線分が最初にさえぎられる位置を 0〜1 で返す（何もなければ 1）
  function cameraClip(fx, fy, fz, tx, ty, tz) {
    let best = 1;
    const d = [tx - fx, ty - fy, tz - fz];
    for (const b of CAMERA_BLOCKERS) {
      let t0 = 0;
      let t1 = 1;
      const mins = [b.minX, b.minY, b.minZ];
      const maxs = [b.maxX, b.maxY, b.maxZ];
      const o = [fx, fy, fz];
      let hit = true;
      for (let k = 0; k < 3 && hit; k++) {
        if (Math.abs(d[k]) < 1e-9) {
          if (o[k] < mins[k] || o[k] > maxs[k]) hit = false;
        } else {
          let a1 = (mins[k] - o[k]) / d[k];
          let a2 = (maxs[k] - o[k]) / d[k];
          if (a1 > a2) [a1, a2] = [a2, a1];
          t0 = Math.max(t0, a1);
          t1 = Math.min(t1, a2);
          if (t0 > t1) hit = false;
        }
      }
      if (hit && t0 < best) best = t0;
    }
    return best;
  }

  return { FIELD, ROAD, SIDEWALK, PLAYER, BUILDINGS, PROPS, AWNINGS, BOXES, CIRCLES, CAMERA_BLOCKERS, create, step, blocked, cameraClip };
})();

if (typeof module !== "undefined") module.exports = TokyoWalkEngine;
