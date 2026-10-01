// 東京を走れ：ゲームエンジン（画面に依存しない純粋な処理）
//
// 座標は 400×400 の仮想ワールド。y は「地面からの高さ」。
// 状態はただのオブジェクトなので、テストではコピーして先読みシミュレーションできる。

const TokyoRunEngine = (() => {
  "use strict";

  const WORLD_W = 400;
  const RUNNER = { x: 64, w: 26, h: 40 };
  const RUNNER_HIT = { left: 6, right: 6, top: 5 }; // 当たり判定は見た目より少し小さく（やさしめ）
  const OBSTACLE_HIT = 3; // 障害物の当たり判定も左右・上を少し削る

  const GRAVITY = 2450;
  const JUMP_V = 800;
  const AIR_TIME = (2 * JUMP_V) / GRAVITY; // 約0.65秒
  const APEX = (JUMP_V * JUMP_V) / (2 * GRAVITY); // 約131
  const JUMP_BUFFER = 0.12; // 着地直前に押したジャンプは、着地した瞬間に実行する（空中ジャンプではない）

  const UNITS_PER_METER = 30;
  const SPEED_UP_AT = [8, 15, 22, 30]; // 「SPEED UP!」を出すタイミング（秒）

  // 障害物の種類。from = 出てくるようになる秒数
  const TYPES = {
    cone: { w: 18, h: 26, from: 0 },
    bag: { w: 26, h: 22, from: 0 },
    puddle: { w: 40, h: 5, from: 5 },
    sign: { w: 24, h: 34, from: 8 },
    bike: { w: 44, h: 30, from: 8 },
    pigeon: { w: 22, h: 18, from: 10, extraSpeed: 40 },
    taxi: { w: 80, h: 38, from: 14, minSpeed: 330 },
    fence: { w: 30, h: 42, from: 15 },
  };
  const SMALL = ["cone", "bag"];

  // ---------- 乱数（状態に持たせて、コピーしても同じ続きになるように） ----------

  function rand(s) {
    s.seed = (s.seed + 0x6d2b79f5) | 0;
    let t = Math.imul(s.seed ^ (s.seed >>> 15), 1 | s.seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function between(s, min, max) {
    return min + rand(s) * (max - min);
  }

  // ---------- 速さと難易度 ----------

  function speedAt(t) {
    return Math.min(580, 230 + 8.5 * t); // 30秒で約485、40秒以降は最高速
  }

  // 高さ h の障害物の上を、1回のジャンプで越えられる横幅
  function clearableSpan(h, speed) {
    if (h >= APEX) return 0;
    const timeAbove = 2 * Math.sqrt((2 * (APEX - h)) / GRAVITY);
    return speed * timeAbove - (RUNNER.w - RUNNER_HIT.left - RUNNER_HIT.right);
  }

  // ---------- 生成 ----------

  function create(seed) {
    return {
      seed: seed | 0,
      t: 0,
      speed: speedAt(0),
      distance: 0,
      meters: 0,
      score: 0,
      level: 0,
      runner: { y: 0, vy: 0, onGround: true, bufferedAt: -1, jumps: 0, landedAt: 0 },
      obstacles: [],
      nextId: 1,
      untilNext: speedAt(0) * 1.5, // 最初の障害物は少し待ってから
      over: false,
      hit: null,
    };
  }

  function availableTypes(s) {
    return Object.keys(TYPES).filter((k) => {
      const ty = TYPES[k];
      return s.t >= ty.from && (!ty.minSpeed || s.speed >= ty.minSpeed);
    });
  }

  // 次に出す障害物のまとまり（1〜3個）を決める
  function pickGroup(s) {
    const comboChance = s.t < 10 ? 0 : Math.min(0.45, (s.t - 10) * 0.03);
    if (rand(s) < comboChance) {
      const count = s.t >= 22 && rand(s) < 0.4 ? 3 : 2;
      const items = [];
      let x = 0;
      for (let i = 0; i < count; i++) {
        const type = SMALL[Math.floor(rand(s) * SMALL.length)];
        items.push({ type, dx: x });
        x += TYPES[type].w + between(s, 14, 26);
      }
      const last = items[items.length - 1];
      const span = last.dx + TYPES[last.type].w;
      const maxH = Math.max(...items.map((it) => TYPES[it.type].h));
      // 1回のジャンプで確実に越えられる幅（余裕をみて7割）に収まるときだけ連続配置にする
      if (span <= clearableSpan(maxH, s.speed) * 0.7) return { items, span };
    }

    const types = availableTypes(s);
    // 新しく解禁された障害物ほど少し出やすく
    const weights = types.map((k) => 1 + Math.max(0, Math.min(1.5, (s.t - TYPES[k].from) / 10)));
    let r = rand(s) * weights.reduce((a, b) => a + b, 0);
    let type = types[0];
    for (let i = 0; i < types.length; i++) {
      r -= weights[i];
      if (r <= 0) {
        type = types[i];
        break;
      }
    }
    return { items: [{ type, dx: 0 }], span: TYPES[type].w };
  }

  // まとまりとまとまりの間隔：
  // 前の障害物をいちばん遅いタイミングで跳んでも、着地してから次を跳ぶまでに反応する時間が残るようにする
  const MIN_GAP_SEC = AIR_TIME + 0.42;

  function gapAfter(s, group) {
    const base = s.speed * MIN_GAP_SEC;
    let extraSec;
    if (s.t < 8) extraSec = between(s, 0.7, 1.3);
    else if (s.t < 18) extraSec = between(s, 0.35, 0.9);
    else if (s.t < 30) extraSec = between(s, 0.12, 0.5);
    else extraSec = between(s, 0.0, 0.3);
    const pigeonMargin = group.items.some((it) => it.type === "pigeon") ? 70 : 0;
    return group.span + base + s.speed * extraSec + pigeonMargin;
  }

  function spawn(s, overshoot) {
    const group = pickGroup(s);
    group.items.forEach((it) => {
      const ty = TYPES[it.type];
      s.obstacles.push({ id: s.nextId++, type: it.type, x: WORLD_W + 8 + it.dx - overshoot, w: ty.w, h: ty.h, extraSpeed: ty.extraSpeed || 0 });
    });
    s.untilNext = gapAfter(s, group) - overshoot;
  }

  // ---------- 操作 ----------

  function doJump(s) {
    const r = s.runner;
    r.vy = JUMP_V;
    r.onGround = false;
    r.bufferedAt = -1;
    r.jumps++;
  }

  // ジャンプ。地面にいるときだけ跳べる（空中での連打は無効。着地直前の入力だけ予約される）
  function jump(s) {
    if (s.over) return false;
    if (s.runner.onGround) {
      doJump(s);
      return true;
    }
    s.runner.bufferedAt = s.t;
    return false;
  }

  // ---------- 1ステップ進める ----------

  function hits(s, o) {
    const r = s.runner;
    const rx1 = RUNNER.x + RUNNER_HIT.left;
    const rx2 = RUNNER.x + RUNNER.w - RUNNER_HIT.right;
    const ox1 = o.x + OBSTACLE_HIT;
    const ox2 = o.x + o.w - OBSTACLE_HIT;
    const top = Math.max(2, o.h - 2);
    return rx1 < ox2 && rx2 > ox1 && r.y < top;
  }

  function stepOnce(s, dt) {
    s.t += dt;
    s.speed = speedAt(s.t);
    const move = s.speed * dt;
    s.distance += move;
    s.meters = Math.floor(s.distance / UNITS_PER_METER);
    s.score = s.meters * 10;
    s.level = SPEED_UP_AT.filter((sec) => s.t >= sec).length;

    // 走者
    const r = s.runner;
    if (!r.onGround) {
      r.vy -= GRAVITY * dt;
      r.y += r.vy * dt;
      if (r.y <= 0) {
        r.y = 0;
        r.vy = 0;
        r.onGround = true;
        r.landedAt = s.t;
        if (r.bufferedAt >= 0 && s.t - r.bufferedAt <= JUMP_BUFFER) doJump(s);
      }
    }

    // 障害物
    s.obstacles.forEach((o) => {
      o.x -= move + o.extraSpeed * dt;
    });
    s.obstacles = s.obstacles.filter((o) => o.x + o.w > -40);

    s.untilNext -= move;
    if (s.untilNext <= 0) spawn(s, -s.untilNext);

    for (const o of s.obstacles) {
      if (hits(s, o)) {
        s.over = true;
        s.hit = o;
        break;
      }
    }
  }

  // 細かく刻んで進める（端末が重くても、すり抜けが起きないように）
  function step(s, dt) {
    if (s.over) return;
    let left = Math.min(dt, 0.1);
    while (left > 0 && !s.over) {
      const d = Math.min(left, 1 / 120);
      stepOnce(s, d);
      left -= d;
    }
  }

  return {
    create,
    step,
    jump,
    speedAt,
    WORLD_W,
    RUNNER,
    TYPES,
    AIR_TIME,
    APEX,
    UNITS_PER_METER,
  };
})();

if (typeof module !== "undefined") module.exports = TokyoRunEngine;
