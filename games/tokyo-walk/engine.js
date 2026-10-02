// 東京、歩く。：街のデータと、移動・当たり判定・カメラの壁よけ（Three.js に依存しない）
//
// 座標：x = 東(+)・西(-)、z = 南(+)・北(-)、y = 上。単位はメートル。
// 当たり判定は真上から見た2Dで行う（建物などは高さに関係なく通れない）。

const TokyoWalkEngine = (() => {
  "use strict";

  const FIELD = 40; // フィールドは -40〜40 の正方形
  const ROAD = 4; // 道路の半幅（交差点を中心に東西・南北の2本）
  const SIDEWALK = 7; // 歩道の外側の位置
  const FRONT = 8; // 建物の正面の線（歩道の外側に少しだけ私有地の舗装）
  const CURB = ROAD + 0.55; // 街灯・電柱・街路樹を並べる線（車道寄り。歩く場所をふさがない）

  const PLAYER = {
    radius: 0.4,
    walkSpeed: 3.4, // m/秒（小走りくらい）
    accel: 16, // 歩き出し
    decel: 22, // 止まるとき（指を離したらすぐ止まる）
    gravity: 20,
    jumpSpeed: 6.6, // 最高到達点 約1.1m
  };

  // ---------- 街のデータ ----------

  // 長方形 [x0, x1] × [z0, z1] を中心・幅・奥行きに直す
  const rect = (x0, x1, z0, z1) => ({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 });

  // お店の入った建物（すべて架空の店）。道路に面して建ち並び、すき間は細い路地になる。
  //   face: 正面が東西の向き（"x"）か南北の向き（"z"）か。正面は必ず道路側
  //   style: apartment（マンション）・office（オフィス）・mixed（雑居ビル）・old（古いビル）
  //   shop / vsign（袖看板）/ sign（屋上看板）
  const BUILDINGS = [
    // 北東ブロック（東西の道路沿いにはコインパーキング）
    { ...rect(8, 17.5, -17, -8), h: 14, face: "x", color: "#d9cfc0", style: "mixed", shop: "Cafe こもれび", shopKind: "cafe", vsign: "喫茶", sign: "カフェ" },
    { ...rect(8, 17, -29, -18.5), h: 20, face: "x", color: "#c9d0d4", style: "office", shop: "まちかど不動産", shopKind: "realty", vsign: "不動産", sign: "TOKYO" },
    { ...rect(8, 18, -39.5, -30.2), h: 11, face: "x", color: "#e9e4da", style: "apartment", shop: "さくら歯科", shopKind: "dental", vsign: "歯科" },
    // 北西ブロック
    { ...rect(-17, -8, -16.5, -8), h: 10, face: "z", color: "#9c8571", style: "old", shop: "らーめん 夜なき", shopKind: "ramen", vsign: "ラーメン", sign: "ラーメン" },
    { ...rect(-39.5, -30.3, -18, -8), h: 16, face: "z", color: "#e3d3cf", style: "apartment", shop: "Hair nami", shopKind: "salon", vsign: "美容室" },
    { ...rect(-15.5, -8, -27, -18), h: 8, face: "x", color: "#c7cbc6", style: "old", shop: "しろたえクリーニング", shopKind: "cleaning", vsign: "クリーニング" },
    { ...rect(-29, -18.5, -17, -8), h: 13, face: "z", color: "#a9aaa6", style: "office", shop: "居酒屋 とりあえず", shopKind: "izakaya", vsign: "居酒屋", sign: "居酒屋" },
    // 南東ブロック
    { ...rect(8, 17.5, 8, 17), h: 12, face: "z", color: "#c9b49c", style: "mixed", shop: "本のしおり堂", shopKind: "books", vsign: "古本", sign: "本屋" },
    { ...rect(19, 26, 8, 15), h: 7, face: "z", color: "#efe9df", style: "old", shop: "お弁当 こまち", shopKind: "bento", vsign: "弁当" },
    { ...rect(8, 17, 19, 28.5), h: 9, face: "x", color: "#e2dccf", style: "apartment", shop: "くすりのミドリ", shopKind: "drug", vsign: "薬" },
    { ...rect(27.5, 39.5, 8, 19), h: 17, face: "z", color: "#c4917c", style: "mixed", shop: "富士見湯", shopKind: "sento", vsign: "ゆ", sign: "銭湯" },
    // 南西ブロック（東西の道路沿いは小さな公園）
    { ...rect(-17.5, -8, 8, 16.5), h: 11, face: "x", color: "#e9e4da", style: "office", shop: "ひまマート", shopKind: "conbini", vsign: "コンビニ", sign: "24H" },
    { ...rect(-16, -8, 18, 26.5), h: 9, face: "x", color: "#d8c8b6", style: "apartment", shop: "花のアトリエ", shopKind: "flower", vsign: "花" },
  ];

  // お店のない建物（道路沿いのすき間を埋める）。ground: 1階の見た目（shutter / residence / lobby）
  const INFILL = [
    { ...rect(19, 24, -15.5, -8), h: 7, face: "z", color: "#a3abb1", style: "old", ground: "residence" },
    { ...rect(36.2, 44, -15, -8), h: 9, face: "z", color: "#c8c3ba", style: "apartment", ground: "shutter" },
    { ...rect(-14, -8, -35, -28.2), h: 12, face: "x", color: "#c2a48c", style: "mixed", ground: "shutter" },
    { ...rect(-16, -8, -44, -36.2), h: 9, face: "x", color: "#e9e4da", style: "apartment", ground: "residence" },
    { ...rect(8, 14.5, 30, 36), h: 6, face: "x", color: "#b9c2c0", style: "old", ground: "residence" },
    { ...rect(8, 18, 37.5, 46), h: 14, face: "x", color: "#cdd3d6", style: "office", ground: "lobby" },
    { ...rect(-13.5, -8, 28, 33.5), h: 7, face: "x", color: "#b9a48f", style: "old", ground: "shutter" },
    { ...rect(-17, -8, 35, 44), h: 15, face: "x", color: "#ede6da", style: "apartment", ground: "residence" },
    { ...rect(-44, -36.5, 8, 20), h: 18, face: "z", color: "#c9d0d4", style: "office", ground: "lobby" },
  ];

  // 道路沿いの建物の裏（区画の内側）。上の階が道路から見えて、街の奥行きになる
  const BACKS = [
    { ...rect(17.5, 32, -29.5, -17.6), h: 16, color: "#d8d2c8", style: "apartment" },
    { ...rect(18.5, 34, -44, -30), h: 23, color: "#c9d0d4", style: "office" },
    { ...rect(32, 44, -30, -17.2), h: 12, color: "#bcc6cc", style: "mixed" },
    { ...rect(-31, -16, -30, -17.3), h: 18, color: "#cdbfae", style: "apartment" },
    { ...rect(-44, -30, -44, -19), h: 24, color: "#8f9599", style: "office" },
    { ...rect(-29.5, -16.2, -44, -30.5), h: 15, color: "#e9e4da", style: "apartment" },
    { ...rect(18.5, 27, 16.5, 30), h: 13, color: "#e3d7c6", style: "mixed" },
    { ...rect(27, 44, 20.5, 44), h: 20, color: "#d5d9dc", style: "apartment" },
    { ...rect(18.5, 27, 31.5, 44), h: 11, color: "#c8c3ba", style: "old" },
    { ...rect(-36, -17.5, 26, 44), h: 14, color: "#c6b8a6", style: "apartment" },
    { ...rect(-44, -36.3, 20.5, 44), h: 21, color: "#c9d0d4", style: "office" },
  ];

  // コインパーキング（北東ブロックの空き地）
  const PARKING = { minX: 24.5, maxX: 35.5, minZ: -17, maxZ: -9, spaces: 4 };

  // 小物。当たり判定：{ r } = 円、{ w, d } = 箱（rot 1・3 は90度回転）。
  // solid: false の小物は見た目だけ（歩くのをじゃましない）。当たり判定は見た目より小さくてよい
  const PROPS = [];
  const add = (p) => PROPS.push(p);
  // 道路沿いの「線」：arm = 東(E)・西(W)・南(S)・北(N) の腕、side = 道路のどちら側か(±1)、t = 交差点からの距離
  const onCurb = (arm, side, t, off = CURB) => {
    if (arm === "E") return { x: t, z: side * off };
    if (arm === "W") return { x: -t, z: side * off };
    if (arm === "S") return { x: side * off, z: t };
    return { x: side * off, z: -t };
  };
  const ARMS = ["E", "W", "S", "N"];

  // 街灯：車道寄りに等間隔
  for (const arm of ARMS) for (const side of [-1, 1]) for (const t of [10, 22, 34]) add({ kind: "lamp", ...onCurb(arm, side, t), r: 0.12 });
  // 電柱：車道寄り。同じ側の電柱を電線でつなぐ
  for (const arm of ARMS) for (const side of [-1, 1]) for (const t of [16, 28]) add({ kind: "pole", ...onCurb(arm, side, t), r: 0.18, line: arm + side });
  // 街路樹（車道寄り、街灯と電柱のあいだ）
  for (const [arm, side, t] of [["E", -1, 25], ["E", 1, 13], ["W", -1, 13], ["W", 1, 25], ["N", 1, 25], ["N", -1, 13], ["S", 1, 13], ["S", -1, 25]]) {
    add({ kind: "tree", ...onCurb(arm, side, t, ROAD + 0.75), r: 0.25 });
  }
  // 公園の木
  for (const [x, z] of [[-26, 12], [-33, 16], [-29, 20], [-22, 22], [-34, 10], [-23, 18.5], [-34.5, 21.8]]) {
    add({ kind: "tree", x, z, r: 0.25, park: true });
  }
  // 自動販売機（建物の前の私有地。背中を壁につける）
  for (const [x, z, rot] of [[7.55, -27.2, 3], [-27.8, -7.55, 2], [25, 7.55, 0], [-7.55, 30.8, 1], [37.5, -7.55, 2]]) {
    add({ kind: "vending", x, z, w: 1.0, d: 0.8, rot });
  }
  // 立て看板（お店の入口の横、壁ぎわ）
  for (const [x, z, text] of [[7.3, -10.6, "OPEN"], [-12.3, -7.3, "営業中"], [7.3, -21.2, "← 駅"], [-21.2, 7.3, "公園"]]) {
    add({ kind: "signboard", x, z, w: 0.9, d: 0.5, text, solid: false });
  }
  // 郵便ポスト（車道寄り）
  add({ kind: "mailbox", x: -CURB, z: -24.5, r: 0.3, solid: false });
  add({ kind: "mailbox", x: 13, z: -CURB, r: 0.3, solid: false });
  // ゴミ箱（自販機の横）
  for (const [x, z] of [[7.6, -26.3], [7.6, -25.7], [-26.9, -7.6], [24.1, 7.6]]) add({ kind: "bin", x, z, r: 0.28, solid: false });
  // 自転車（お店の前に壁向きで3台ずつ。見た目だけ）
  add({ kind: "bikes", x: -7.4, z: 13.2, w: 1.0, d: 1.8, count: 3, solid: false });
  add({ kind: "bikes", x: 7.4, z: 24.6, w: 1.0, d: 1.8, count: 3, solid: false });
  // ガードレール（車道との境目。電柱と街灯のあいだに短く）
  for (const [arm, side] of [["E", -1], ["W", 1], ["S", 1], ["N", -1]]) {
    const c = onCurb(arm, side, 31, ROAD + 0.35);
    const along = arm === "E" || arm === "W" ? "x" : "z";
    add({ kind: "guardrail", ...c, w: along === "x" ? 3.6 : 0.14, d: along === "x" ? 0.14 : 3.6, along });
  }
  // カーブミラー（交差点の角）
  add({ kind: "mirror", x: 7.3, z: -CURB, r: 0.07 });
  add({ kind: "mirror", x: -7.3, z: CURB, r: 0.07 });
  // 消火器ボックス（壁ぎわ。見た目だけ）
  add({ kind: "hydrant", x: 22.5, z: -7.75, w: 0.5, d: 0.35, solid: false });
  add({ kind: "hydrant", x: -7.75, z: 24.5, w: 0.35, d: 0.5, solid: false });
  // 植木鉢（お店の前の壁ぎわ。見た目だけ）
  for (const [x, z] of [[7.7, -9.0], [7.7, -15.8], [-9.0, -7.7], [16.6, 7.7], [7.7, 27.8], [-7.7, 26.0]]) add({ kind: "planter", x, z, r: 0.35, solid: false });
  // ベンチ（公園）
  add({ kind: "bench", x: -25, z: 17.9, w: 1.6, d: 0.55 });
  add({ kind: "bench", x: -31.5, z: 22.8, w: 1.6, d: 0.55 });
  // 道路標識（車道寄り）
  for (const [x, z, sign] of [[CURB, -7.0, "crossing"], [-CURB, 7.0, "crossing"], [CURB, -8.6, "stop"], [-CURB, 8.6, "stop"], [CURB, 19, "speed"], [-CURB, -19, "speed"]]) {
    add({ kind: "signpost", x, z, r: 0.07, sign });
  }
  // コインパーキングの柵・精算機・P看板
  add({ kind: "fence", x: (PARKING.minX + PARKING.maxX) / 2, z: PARKING.minZ + 0.1, w: PARKING.maxX - PARKING.minX, d: 0.14 });
  add({ kind: "fence", x: PARKING.minX + 0.1, z: (PARKING.minZ + PARKING.maxZ) / 2 - 0.4, w: 0.14, d: PARKING.maxZ - PARKING.minZ - 0.8 });
  add({ kind: "fence", x: PARKING.maxX - 0.1, z: (PARKING.minZ + PARKING.maxZ) / 2 - 0.4, w: 0.14, d: PARKING.maxZ - PARKING.minZ - 0.8 });
  add({ kind: "meter", x: 25.4, z: -9.9, r: 0.22, solid: false });
  add({ kind: "psign", x: 34.8, z: -9.7, r: 0.15, solid: false });

  // ---------- 当たり判定用の形 ----------

  const boxOf = (p) => {
    const turned = p.rot === 1 || p.rot === 3;
    const w = turned ? p.d : p.w;
    const d = turned ? p.w : p.d;
    return { minX: p.x - w / 2, maxX: p.x + w / 2, minZ: p.z - d / 2, maxZ: p.z + d / 2 };
  };
  const BOX_HEIGHT = { vending: 1.8, guardrail: 0.8, bench: 0.8, fence: 1.2 };
  const solid = (p) => p.solid !== false;

  // 箱（AABB）：建物・自販機・ガードレール・柵・ベンチ。h はカメラの壁よけ用の高さ
  const ALL_BUILDINGS = [...BUILDINGS, ...INFILL, ...BACKS];
  const BOXES = [
    ...ALL_BUILDINGS.map((b) => ({ minX: b.x - b.w / 2, maxX: b.x + b.w / 2, minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2, h: b.h, ref: b })),
    ...PROPS.filter((p) => p.w !== undefined && solid(p)).map((p) => ({ ...boxOf(p), h: BOX_HEIGHT[p.kind] || 1, ref: p })),
  ];

  // 1階のひさし（道路側に張り出す）：見た目とカメラの壁よけで共有する
  const AWNINGS = BUILDINGS.map((b) => {
    const towardX = b.face === "x" ? -Math.sign(b.x) : 0;
    const towardZ = b.face === "z" ? -Math.sign(b.z) : 0;
    const w = towardX ? 0.9 : b.w * 0.7;
    const d = towardZ ? 0.9 : b.d * 0.7;
    const x = b.x + towardX * (b.w / 2 + 0.45);
    const z = b.z + towardZ * (b.d / 2 + 0.45);
    return { x, z, w, d, y: 3.1, towardX, towardZ, ref: b };
  });

  // 円：街灯・木・電柱・ミラー・標識（細い柱だけ。まわりを滑るように避けられる）
  const CIRCLES = PROPS.filter((p) => p.r !== undefined && solid(p)).map((p) => ({ x: p.x, z: p.z, r: p.r, ref: p }));

  // ---------- プレイヤー ----------

  function create() {
    return {
      x: 6.6, // 南の通りの東側の歩道（歩く場所の真ん中）から、北の交差点を向いてスタート
      y: 0,
      z: 19.5,
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

  // 箱の角にかすっただけなら、角の外側へ回り込ませる（角で引っかからない）
  const CORNER = 0.55;

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
        // 進む向きと直角の方向の重なりが浅いときは、近いほうの角へ少しずらす
        const push = Math.abs(dx || dz);
        if (dx) {
          const a = nz - (b.minZ - r);
          const c = b.maxZ + r - nz;
          if (Math.min(a, c) < CORNER) nz += a < c ? -Math.min(a, push) : Math.min(c, push);
        } else {
          const a = nx - (b.minX - r);
          const c = b.maxX + r - nx;
          if (Math.min(a, c) < CORNER) nx += a < c ? -Math.min(a, push) : Math.min(c, push);
        }
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

    // 速度をなめらかに目標へ（止まるときは少し早めに）
    const tx = ix * PLAYER.walkSpeed;
    const tz = iz * PLAYER.walkSpeed;
    const slowing = tx * tx + tz * tz < s.vx * s.vx + s.vz * s.vz;
    const a = Math.min(1, (slowing ? PLAYER.decel : PLAYER.accel) * dt);
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
      const ox = s.x;
      const oz = s.z;
      moveAxis(s, (s.vx * dt) / steps, 0);
      moveAxis(s, 0, (s.vz * dt) / steps);
      // 柱と箱が近い場所でも、どちらにもめり込まない位置に落ち着くまで数回くり返す
      for (let k = 0; k < 3; k++) {
        pushOutOfCircles(s);
        pushOutOfBoxes(s);
      }
      // それでも狭いすき間に挟まったら、この一歩は進まない（直前の位置は必ず空いている）
      if (blocked(s.x, s.z)) {
        s.x = ox;
        s.z = oz;
        s.vx *= 0.5;
        s.vz *= 0.5;
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

  // カメラの視線をさえぎるもの（3Dの箱）：建物・ひさし。
  // 木の葉は入れない（歩道を歩くたびにカメラが寄ったり離れたりして、画面が落ち着かないため）
  const CAMERA_BLOCKERS = [
    ...BOXES.filter((b) => b.h >= 2).map((b) => ({ minX: b.minX - 0.25, maxX: b.maxX + 0.25, minY: 0, maxY: b.h + 0.3, minZ: b.minZ - 0.25, maxZ: b.maxZ + 0.25 })),
    ...AWNINGS.map((a) => ({ minX: a.x - a.w / 2 - 0.1, maxX: a.x + a.w / 2 + 0.1, minY: a.y - 0.2, maxY: a.y + 0.2, minZ: a.z - a.d / 2 - 0.1, maxZ: a.z + a.d / 2 + 0.1 })),
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

  return { FIELD, ROAD, SIDEWALK, FRONT, CURB, PLAYER, BUILDINGS, INFILL, BACKS, PARKING, PROPS, AWNINGS, BOXES, CIRCLES, CAMERA_BLOCKERS, create, step, blocked, cameraClip };
})();

if (typeof module !== "undefined") module.exports = TokyoWalkEngine;
