// 東京、歩く。5.0：探索ミッションのルール（Three.js に依存しない。node でもテストできる）
//
// ・目的（何を探すか）と、その置き場所（候補地点）を、ゲームごとにランダムに選ぶ
// ・目的物に近づいたら「発見」。点数は 基本100 ＋ 残り時間のボーナス
// ・候補地点は、建物の中・壁の中・行けない場所・フィールドの外・スタートのすぐそばには置かない
//   （scripts/check-tokyo-walk.js で全候補を歩いて確かめる）

const TokyoWalkMission = (() => {
  "use strict";

  const TIME_LIMIT = 180; // 秒
  const BASE_POINT = 100;
  const HINT_TIMES = [60, 120]; // 開始から何秒でヒントを出すか
  const MIN_DIST = 20; // スタート地点からこれより近い候補は使わない（すぐ見つかってしまう）
  const FIRST_HINT = "まだ見つかりません。少し遠くまで行ってみよう。";

  // 残り時間のボーナス
  function timeBonus(remaining) {
    if (remaining >= 120) return 100;
    if (remaining >= 60) return 50;
    if (remaining >= 30) return 25;
    return 0;
  }

  // ---------- 探す物の種類 ----------
  //   spawn：その物を1つだけ街に置く（赤い自販機・黄色い看板・ポスト・ねこ）
  //   ふだんの街には、まぎらわしい同じ物を置いていない（赤い自販機・ポストは街から外してある）
  //   spawn なし：もとからある街のお店・公園・看板が目的物
  const VEND = [
    // [x, z, 向き(0:-z 1:+x 2:+z 3:-x)]  建物の壁ぎわ
    [12.5, -7.55, 2], [-7.55, -25.6, 1], [-38.3, -7.55, 2], [-7.55, 37.5, 1],
    [37.8, 7.55, 0], [-38.5, 7.55, 0], [7.55, -37.8, 3], [-7.55, -31.5, 1],
  ];
  const BOARD = [
    // お店の前の壁ぎわ
    [-7.3, -20.2], [20.3, 7.3], [-21.5, -7.3], [-7.3, 20.0], [30.5, 7.3], [-33.0, -7.3], [7.3, -32.5], [15.5, 7.3],
  ];
  const MAILBOX = [
    // 車道寄り（街灯・電柱・街路樹のあいだ）
    [13, -4.55], [25, 4.55], [-25, -4.55], [-13, 4.55], [4.55, -13], [-4.55, -25], [4.55, 37], [-4.55, 31],
  ];
  const CAT = [
    // 路地・建物のすき間・公園（大通りからは少し見えにくい）
    [18.25, -10.5], [21.2, -16.6], [-17.75, -10.5], [-11.5, -17.25], [-30.5, 12.5], [-23.5, 22.5],
    [-17.8, 21.5], [12.5, 18.0], [18.25, 10.5], [-12.0, 17.25], [12.5, -17.75], [-36.0, 23.0],
  ];

  const TYPES = [
    { id: "vending", label: "赤い自販機を探せ！", short: "赤い自販機", hint: "建物の壁ぎわに置いてあるよ。", spawn: "vending", spots: VEND, r: 2.5 },
    { id: "board", label: "黄色い立て看板を探せ！", short: "黄色い立て看板", hint: "お店の前の歩道に立っているよ。", spawn: "board", spots: BOARD, r: 2.5 },
    { id: "mailbox", label: "赤い郵便ポストを探せ！", short: "郵便ポスト", hint: "車道のそば、歩道のはしっこにあるよ。", spawn: "mailbox", spots: MAILBOX, r: 2.5 },
    { id: "cat", label: "ひなたぼっこ中の黒ねこを探せ！", short: "黒ねこ", hint: "大通りより、建物のすき間や公園が好きみたい。", spawn: "cat", spots: CAT, r: 2.5 },
    { id: "shop", label: null, hint: "大通りに面したお店です。1階の看板の文字をよく見てみよう。" },
    { id: "vsign", label: null, hint: "建物の壁から突き出した、縦長の看板です。少し上のほうも見てみよう。" },
    { id: "ramen", label: "ラーメン屋さんを探せ！", short: "ラーメン屋さん", hint: "のれんと、屋上の看板が目印。" },
    { id: "sento", label: "銭湯を探せ！", short: "銭湯", hint: "のれんの『ゆ』の文字が目印。" },
    { id: "park", label: "小さな公園を探せ！", short: "小さな公園", hint: "木がたくさん生えているところを探してみよう。" },
  ];

  // お店の正面（ひさしの少し前）
  function frontOf(E, i) {
    const a = E.AWNINGS[i];
    return { x: a.x + a.towardX * 0.9, z: a.z + a.towardZ * 0.9 };
  }

  const PARK = { minX: -36, maxX: -19.5, minZ: 8, maxZ: 24 };

  // すべての目的（種類×場所）を並べる。スタートのすぐそばのものは除く
  function allMissions(E) {
    const start = E.create();
    const list = [];
    const push = (m) => {
      if (Math.hypot(m.x - start.x, m.z - start.z) >= MIN_DIST) list.push(m);
    };
    for (const t of TYPES) {
      if (t.spawn) {
        t.spots.forEach(([x, z, rot = 0], k) => push({ type: t.id, key: `${t.id}:${k}`, label: t.label, short: t.short, hint: t.hint, spawn: t.spawn, x, z, rot, r: t.r }));
      } else if (t.id === "shop" || t.id === "vsign") {
        E.BUILDINGS.forEach((b, i) => {
          if (b.shopKind === "ramen" || b.shopKind === "sento") return; // 専用の目的がある
          if (t.id === "vsign" && !(b.h > 8)) return; // 袖看板があるのは背の高い建物だけ
          const f = frontOf(E, i);
          const label = t.id === "shop" ? `お店「${b.shop}」を探せ！` : `「${b.vsign}」の袖看板を探せ！`;
          const short = t.id === "shop" ? `「${b.shop}」` : `「${b.vsign}」の袖看板`;
          push({ type: t.id, key: `${t.id}:${i}`, label, short, hint: t.hint, x: f.x, z: f.z, r: t.id === "shop" ? 3 : 3.5, building: i });
        });
      } else if (t.id === "ramen" || t.id === "sento") {
        const i = E.BUILDINGS.findIndex((b) => b.shopKind === t.id);
        const f = frontOf(E, i);
        push({ type: t.id, key: t.id, label: t.label, short: t.short, hint: t.hint, x: f.x, z: f.z, r: 3, building: i });
      } else if (t.id === "park") {
        push({ type: "park", key: "park", label: t.label, short: t.short, hint: t.hint, x: (PARK.minX + PARK.maxX) / 2, z: (PARK.minZ + PARK.maxZ) / 2, area: PARK, r: 0 });
      }
    }
    return list;
  }

  // 目的を1つ選ぶ：まず種類を同じ確率で選び、その中から場所を選ぶ。前回と同じ目的は避ける
  function pick(E, rnd = Math.random, lastKey = null) {
    const all = allMissions(E);
    const types = [...new Set(all.map((m) => m.type))];
    for (let tries = 0; tries < 20; tries++) {
      const type = types[Math.floor(rnd() * types.length)];
      const spots = all.filter((m) => m.type === type);
      const m = spots[Math.floor(rnd() * spots.length)];
      if (m.key !== lastKey || all.length === 1) return m;
    }
    return all.find((m) => m.key !== lastKey);
  }

  // 発見したか（毎フレーム呼んでも軽い：距離1回か、四角の判定1回）
  function isFound(m, x, z) {
    if (m.area) return x >= m.area.minX && x <= m.area.maxX && z >= m.area.minZ && z <= m.area.maxZ;
    const dx = x - m.x;
    const dz = z - m.z;
    return dx * dx + dz * dz <= m.r * m.r;
  }

  function score(remaining) {
    const bonus = timeBonus(remaining);
    return { base: BASE_POINT, bonus, total: BASE_POINT + bonus };
  }

  return { TIME_LIMIT, BASE_POINT, HINT_TIMES, MIN_DIST, FIRST_HINT, TYPES, PARK, timeBonus, allMissions, pick, isFound, score };
})();

if (typeof module !== "undefined") module.exports = TokyoWalkMission;
