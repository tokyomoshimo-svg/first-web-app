(() => {
  "use strict";

  const E = TokyoRunEngine;
  const $ = (id) => document.getElementById(id);

  const GROUND = 318; // ワールド内の地面の高さ（上から）
  const WORLD = 400;

  // ---------- 要素 ----------

  const app = $("app");
  const screenEl = $("screen");
  const world = $("world");
  const runnerEl = $("runner");
  const obstaclesEl = $("obstacles");
  const fxEl = $("fx");
  const carEl = $("car");
  const hudScore = $("hud-score");
  const hudDist = $("hud-dist");
  const countdownEl = $("countdown");
  const speedUpEl = $("speed-up");
  const tapZone = document.querySelector(".tap-zone");
  const retryBtn = $("btn-retry");

  // ---------- 状態 ----------

  let state = "start"; // start | countdown | play | paused | crash | result
  let game = null;
  let scroll = 0; // 背景の進んだ距離
  let last = performance.now();
  let timers = [];
  let carX = 520;
  let lastScore = -1;
  let lastLevel = 0;
  let wasOnGround = true;
  let lastStride = 0;
  const obstacleEls = new Map();

  function setState(s) {
    state = s;
    app.dataset.state = s;
  }

  function later(fn, ms) {
    timers.push(setTimeout(fn, ms));
  }

  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }

  // =========================================================
  // 背景（SVGで生成。毎回同じ街並みになるよう固定の乱数）
  // =========================================================

  let sceneSeed = 20261001;
  function srand() {
    sceneSeed = (sceneSeed * 1664525 + 1013904223) >>> 0;
    return sceneSeed / 4294967296;
  }

  // 同じタイルを2枚並べた横長SVG（ずらして無限スクロールさせる）
  function tiledSvg(tile, defs, content) {
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${tile * 2}" height="${WORLD}" viewBox="0 0 ${tile * 2} ${WORLD}">` +
      `<defs>${defs}</defs><g>${content}</g><g transform="translate(${tile} 0)">${content}</g></svg>`
    );
  }

  function buildFar() {
    const base = 266;
    let s = "";
    for (let x = 0; x < 400; ) {
      const w = 16 + srand() * 26;
      const h = 18 + srand() * 52;
      s += `<rect x="${x.toFixed(1)}" y="${(base - h).toFixed(1)}" width="${(w + 1).toFixed(1)}" height="${h.toFixed(1)}" fill="#1a2050"/>`;
      x += w;
    }
    // 遠くの電波塔（赤白）
    s +=
      `<g opacity="0.85"><path d="M72 ${base} L88 148 L92 148 L108 ${base} L100 ${base} L90 200 L80 ${base} Z" fill="url(#far-tower)"/>` +
      `<rect x="80" y="205" width="20" height="4" fill="#ffd8c0" opacity="0.7"/><rect x="84" y="178" width="12" height="3" fill="#ffd8c0" opacity="0.7"/>` +
      `<rect x="89.4" y="128" width="1.2" height="22" fill="#e9a08a"/><circle class="beacon" cx="90" cy="128" r="1.8" fill="#ff4040"/></g>`;
    // 遠くの細長いタワー
    s +=
      `<g opacity="0.7"><path d="M292 ${base} L298 96 L302 96 L308 ${base} Z" fill="#5d6fc0"/>` +
      `<ellipse cx="300" cy="150" rx="8" ry="3" fill="#a9b8ff"/><ellipse cx="300" cy="122" rx="5" ry="2" fill="#a9b8ff"/>` +
      `<rect x="299.4" y="64" width="1.2" height="34" fill="#a9b8ff"/><circle class="beacon" cx="300" cy="64" r="1.8" fill="#ff4040" style="animation-delay:-0.8s"/></g>`;
    const defs = `<linearGradient id="far-tower" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff7a52"/><stop offset="0.5" stop-color="#d9532f"/><stop offset="1" stop-color="#7a2d2a"/></linearGradient>`;
    $("layer-far").innerHTML = tiledSvg(400, defs, s);
  }

  function buildMid() {
    const base = 312;
    const tile = 600;
    const signs = ["ラーメン", "カラオケ", "居酒屋", "24H", "BAR", "珈琲"];
    let s = "";
    let blinks = 0;
    let signIndex = 0;
    for (let x = 0; x < tile; ) {
      const w = 46 + srand() * 46;
      const h = 70 + srand() * 110;
      const top = base - h;
      const shade = ["#121838", "#171d42", "#1b2148", "#141a3c"][Math.floor(srand() * 4)];
      s += `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${(w - 3).toFixed(1)}" height="${h.toFixed(1)}" fill="${shade}"/>`;
      // 窓
      for (let wy = top + 8; wy < base - 12; wy += 11) {
        for (let wx = x + 6; wx < x + w - 10; wx += 9) {
          const lit = srand() < 0.34;
          if (!lit) continue;
          const warm = srand() < 0.8;
          let cls = "";
          if (blinks < 9 && srand() < 0.05) {
            cls = ` class="blink b${(blinks % 3) + 1}"`;
            blinks++;
          }
          s += `<rect${cls} x="${wx.toFixed(1)}" y="${wy.toFixed(1)}" width="4" height="5" fill="${warm ? "#ffd27a" : "#9fe3ff"}" opacity="${(0.55 + srand() * 0.4).toFixed(2)}"/>`;
        }
      }
      // ネオンの縦看板
      if (srand() < 0.6 && h > 100) {
        const text = signs[signIndex++ % signs.length];
        const color = signIndex % 2 ? "#ff3ea5" : "#35e0ff";
        const sx = x + w - 16;
        const sy = top + 20 + srand() * 30;
        const sh = Math.max(30, text.length * 10 + 8);
        const flick = srand() < 0.5 ? ' class="neon"' : "";
        s += `<g${flick}><rect x="${sx.toFixed(1)}" y="${sy.toFixed(1)}" width="13" height="${sh}" rx="2" fill="#0b0d1c" stroke="${color}" stroke-width="3" opacity="0.35"/>`;
        s += `<rect x="${sx.toFixed(1)}" y="${sy.toFixed(1)}" width="13" height="${sh}" rx="2" fill="none" stroke="${color}" stroke-width="1"/>`;
        [...text].forEach((ch, i) => {
          s += `<text x="${(sx + 6.5).toFixed(1)}" y="${(sy + 11 + i * 10).toFixed(1)}" font-size="8" font-weight="700" text-anchor="middle" fill="${color}">${ch}</text>`;
        });
        s += `</g>`;
      }
      x += w;
    }
    $("layer-mid").innerHTML = tiledSvg(tile, "", s);
  }

  function buildNear() {
    const tile = 320;
    const defs =
      `<radialGradient id="near-glow"><stop offset="0" stop-color="#fff1c4" stop-opacity="0.55"/><stop offset="1" stop-color="#fff1c4" stop-opacity="0"/></radialGradient>` +
      `<radialGradient id="near-floor"><stop offset="0" stop-color="#ffe9a8" stop-opacity="0.35"/><stop offset="1" stop-color="#ffe9a8" stop-opacity="0"/></radialGradient>`;
    // 街灯
    let s =
      `<ellipse cx="74" cy="${GROUND + 6}" rx="46" ry="8" fill="url(#near-floor)"/>` +
      `<rect x="58" y="238" width="3" height="${GROUND - 238}" fill="#3a3f57"/>` +
      `<path d="M59.5 240 Q62 232 74 232" stroke="#3a3f57" stroke-width="2.5" fill="none"/>` +
      `<rect x="70" y="231" width="12" height="4" rx="2" fill="#fff6d8"/>` +
      `<circle cx="76" cy="236" r="26" fill="url(#near-glow)"/>`;
    // 歩行者用信号
    s +=
      `<rect x="232" y="252" width="3" height="${GROUND - 252}" fill="#3a3f57"/>` +
      `<rect x="225" y="236" width="17" height="30" rx="3" fill="#181b28" stroke="#3a3f57"/>` +
      `<circle class="sig-r" cx="233.5" cy="244" r="4" fill="#ff4a4a"/>` +
      `<circle class="sig-g" cx="233.5" cy="258" r="4" fill="#4dffb0"/>`;
    // ガードレール（歩道の奥）
    for (let x = 0; x < tile; x += 40) s += `<rect x="${x + 10}" y="${GROUND - 14}" width="2" height="14" fill="#2c3146"/>`;
    s += `<rect x="0" y="${GROUND - 14}" width="${tile}" height="3" fill="#2c3146"/>`;
    $("layer-near").innerHTML = tiledSvg(tile, defs, s);
  }

  // 背景の層：tile = 1枚の幅、factor = 手前ほど速く流れる
  const LAYERS = [
    { el: $("layer-far"), tile: 400, factor: 0.08 },
    { el: $("layer-mid"), tile: 600, factor: 0.3 },
    { el: $("layer-near"), tile: 320, factor: 0.85 },
    { el: $("sidewalk"), tile: 40, factor: 1 },
    { el: $("road-lines"), tile: 60, factor: 1.2 },
  ];

  // =========================================================
  // 障害物の見た目（SVG）
  // =========================================================

  const OBSTACLE_SVG = {
    cone: (w, h) =>
      `<rect x="0" y="${h - 3}" width="${w}" height="3" rx="1" fill="#c4560f"/>` +
      `<polygon points="2,${h - 3} 7,1 11,1 16,${h - 3}" fill="#ff7a1a"/>` +
      `<polygon points="5.2,9 12.8,9 13.9,13 4.1,13" fill="#fff"/>` +
      `<polygon points="3.6,16 14.4,16 15.3,19 2.7,19" fill="#fff"/>`,
    bag: (w, h) =>
      `<path d="M2 ${h} Q-1 9 7 6 Q10 4 13 5 Q16 4 19 6 Q27 9 24 ${h} Z" fill="#9aa6c9" opacity="0.92"/>` +
      `<path d="M10 6 L13 1 L16 6" stroke="#6f7aa0" stroke-width="2" fill="none"/>` +
      `<path d="M6 12 Q10 16 8 ${h - 2}" stroke="#ffffff" stroke-width="1.2" fill="none" opacity="0.5"/>`,
    puddle: (w, h) =>
      `<ellipse cx="${w / 2}" cy="${h - 2}" rx="${w / 2}" ry="3" fill="#24406f" opacity="0.9"/>` +
      `<ellipse class="shine" cx="${w / 2 - 6}" cy="${h - 2.5}" rx="9" ry="1" fill="#9fd8ff"/>`,
    sign: (w, h) =>
      `<path d="M3 ${h} L8 4 M21 ${h} L16 4" stroke="#8b90a8" stroke-width="2"/>` +
      `<rect x="2" y="2" width="20" height="22" rx="2" fill="#f4f1e8" stroke="#c8c2b0"/>` +
      `<rect x="2" y="2" width="20" height="6" rx="2" fill="#e04848"/>` +
      `<text x="12" y="16" font-size="6" font-weight="800" text-anchor="middle" fill="#2a2d3a">営業</text>` +
      `<text x="12" y="22" font-size="5" font-weight="700" text-anchor="middle" fill="#2a2d3a">中</text>`,
    bike: (w, h) =>
      `<circle cx="9" cy="${h - 8}" r="7.5" fill="none" stroke="#c9cde0" stroke-width="2"/>` +
      `<circle cx="35" cy="${h - 8}" r="7.5" fill="none" stroke="#c9cde0" stroke-width="2"/>` +
      `<path d="M9 ${h - 8} L18 ${h - 8} L27 9 L14 9 Z M18 ${h - 8} L14 6 M27 9 L35 ${h - 8} M27 9 L29 3" stroke="#ff5a6e" stroke-width="2" fill="none" stroke-linejoin="round"/>` +
      `<rect x="10" y="4" width="8" height="3" rx="1.5" fill="#2a2d3a"/>` +
      `<rect x="28" y="2" width="11" height="8" rx="1" fill="none" stroke="#c9cde0" stroke-width="1.4"/>`,
    pigeon: (w, h) =>
      `<g class="pigeon-bob"><ellipse cx="13" cy="10" rx="9" ry="6" fill="#8b93a8"/>` +
      `<path d="M20 9 L26 6 L24 12 Z" fill="#6c7389"/>` +
      `<circle cx="5" cy="5" r="4" fill="#7d85a0"/>` +
      `<path d="M7 8 Q9 11 6 13" stroke="#6fe3b4" stroke-width="2" fill="none" opacity="0.8"/>` +
      `<circle cx="4" cy="4.2" r="0.9" fill="#ffb347"/>` +
      `<path d="M1.3 5 L-1.5 6 L1.3 6.6 Z" fill="#e8b0a0"/></g>` +
      `<path d="M11 15 L10 ${h} M15 15 L16 ${h}" stroke="#ff8fa0" stroke-width="1.5"/>`,
    taxi: (w, h) =>
      `<path d="M2 ${h - 8} L2 20 Q3 16 10 15 L20 15 L28 5 L56 5 L66 15 L76 16 Q79 17 79 22 L79 ${h - 8} Z" fill="#f2c230"/>` +
      `<path d="M30 8 L41 8 L41 15 L23 15 Z M44 8 L55 8 L62 15 L44 15 Z" fill="#1a2238"/>` +
      `<rect x="34" y="0" width="14" height="5" rx="1.5" fill="#fff"/><rect x="36" y="1.5" width="10" height="2" fill="#ff7a1a"/>` +
      `<rect x="2" y="23" width="77" height="3" fill="#1e2a4a"/>` +
      `<circle cx="18" cy="${h - 7}" r="7" fill="#15161f"/><circle cx="18" cy="${h - 7}" r="3" fill="#8b90a8"/>` +
      `<circle cx="64" cy="${h - 7}" r="7" fill="#15161f"/><circle cx="64" cy="${h - 7}" r="3" fill="#8b90a8"/>` +
      `<rect x="1" y="18" width="4" height="4" rx="1" fill="#fffbe0"/><path d="M1 20 L-26 14 L-26 27 Z" fill="#fff6d0" opacity="0.18"/>`,
    fence: (w, h) =>
      `<rect x="1" y="2" width="3" height="${h - 2}" fill="#5b6075"/><rect x="${w - 4}" y="2" width="3" height="${h - 2}" fill="#5b6075"/>` +
      `<rect x="0" y="${h - 3}" width="6" height="3" fill="#3a3f55"/><rect x="${w - 6}" y="${h - 3}" width="6" height="3" fill="#3a3f55"/>` +
      `<rect x="3" y="5" width="${w - 6}" height="10" fill="#ffd23a"/>` +
      `<path d="M3 15 L9 5 L14 5 L8 15 Z M13 15 L19 5 L24 5 L18 15 Z M23 15 L27 8 L27 15 Z" fill="#1d1f2b"/>` +
      `<rect x="5" y="18" width="${w - 10}" height="13" fill="#f4f1e8"/>` +
      `<text x="${w / 2}" y="27.5" font-size="7" font-weight="800" text-anchor="middle" fill="#d23a3a">工事中</text>` +
      `<circle class="beacon" cx="${w / 2}" cy="2" r="2" fill="#ff5a3a"/>`,
  };

  function createObstacleEl(o) {
    const el = document.createElement("div");
    el.className = `ob ob-${o.type}`;
    const shadow = `<ellipse cx="${o.w / 2}" cy="${o.h}" rx="${o.w / 2 + 3}" ry="2.5" fill="#000" opacity="0.45"/>`;
    el.innerHTML = `<svg width="${o.w}" height="${o.h}" viewBox="0 0 ${o.w} ${o.h}">${shadow}${OBSTACLE_SVG[o.type](o.w, o.h)}</svg>`;
    obstaclesEl.appendChild(el);
    return el;
  }

  function syncObstacles() {
    const alive = new Set();
    if (game) {
      game.obstacles.forEach((o) => {
        alive.add(o.id);
        let el = obstacleEls.get(o.id);
        if (!el) {
          el = createObstacleEl(o);
          obstacleEls.set(o.id, el);
        }
        el.style.transform = `translate3d(${o.x.toFixed(1)}px, ${GROUND - o.h}px, 0)`;
      });
    }
    obstacleEls.forEach((el, id) => {
      if (!alive.has(id)) {
        el.remove();
        obstacleEls.delete(id);
      }
    });
  }

  function clearObstacles() {
    obstacleEls.forEach((el) => el.remove());
    obstacleEls.clear();
  }

  // =========================================================
  // 描画
  // =========================================================

  function fitWorld() {
    world.style.setProperty("--scale", (screenEl.clientWidth / WORLD).toFixed(4));
  }

  function renderRunner() {
    const r = game ? game.runner : { y: 0, onGround: true };
    const y = r.y;
    runnerEl.style.transform = `translate3d(${E.RUNNER.x}px, ${(GROUND - E.RUNNER.h - y).toFixed(1)}px, 0)`;
    runnerEl.style.setProperty("--lift", y.toFixed(1) + "px");
    runnerEl.style.setProperty("--shadow", Math.max(0.35, 1 - y / 160).toFixed(2));

    if (state === "crash" || state === "result") return;
    const running = r.onGround && (state === "start" || state === "play");
    runnerEl.classList.toggle("is-running", running);
    runnerEl.classList.toggle("is-air", !r.onGround);

    if (state === "play") {
      if (r.onGround && !wasOnGround) land();
      wasOnGround = r.onGround;
      // 速くなるほど足の回転も速く
      const stride = Math.max(0.19, 0.36 - (game.speed - 230) / 1500);
      if (Math.abs(stride - lastStride) > 0.015) {
        lastStride = stride;
        runnerEl.style.setProperty("--stride", stride.toFixed(3) + "s");
      }
    }
  }

  function land() {
    runnerEl.classList.remove("is-land");
    void runnerEl.offsetWidth;
    runnerEl.classList.add("is-land");
    later(() => runnerEl.classList.remove("is-land"), 170);
    dust(E.RUNNER.x + 13, GROUND);
  }

  function dust(x, y) {
    for (let i = 0; i < 4; i++) {
      const d = document.createElement("i");
      d.className = "dust";
      d.style.left = x + (i - 1.5) * 5 + "px";
      d.style.top = y - 1 + "px";
      d.style.setProperty("--dx", (i - 1.5) * 8 - 6 + "px");
      fxEl.appendChild(d);
      setTimeout(() => d.remove(), 450);
    }
  }

  function renderHud() {
    if (!game) return;
    if (game.score !== lastScore) {
      if (Math.floor(game.score / 100) > Math.floor(Math.max(0, lastScore) / 100) && lastScore >= 0) {
        hudScore.classList.remove("pulse");
        void hudScore.offsetWidth;
        hudScore.classList.add("pulse");
      }
      lastScore = game.score;
      hudScore.textContent = String(game.score).padStart(4, "0");
      hudDist.textContent = game.meters;
    }
    if (game.level > lastLevel) {
      lastLevel = game.level;
      speedUpEl.classList.remove("show");
      void speedUpEl.offsetWidth;
      speedUpEl.classList.add("show");
    }
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    let speed = 0;
    if (state === "play" && game) {
      const before = game.distance;
      E.step(game, dt);
      scroll += game.distance - before;
      speed = game.speed;
      if (game.over) crash();
    } else if (state === "start") {
      speed = 90; // タイトル画面では、ゆっくり流しておく
      scroll += speed * dt;
    }

    LAYERS.forEach((l) => {
      const x = -((scroll * l.factor) % l.tile);
      l.el.style.transform = `translate3d(${x.toFixed(1)}px, 0, 0)`;
    });

    // 対向車（いつも走っている）
    carX -= (speed * 1.2 + 200) * dt;
    if (carX < -160) carX = WORLD + 200 + Math.random() * 600;
    carEl.style.transform = `translate3d(${carX.toFixed(1)}px, 0, 0)`;

    syncObstacles();
    renderRunner();
    renderHud();

    requestAnimationFrame(frame);
  }

  // =========================================================
  // 進行
  // =========================================================

  function newGame() {
    clearTimers();
    clearObstacles();
    fxEl.innerHTML = "";
    game = E.create((Math.random() * 2 ** 31) | 0);
    lastScore = -1;
    lastLevel = 0;
    wasOnGround = true;
    lastStride = 0;
    runnerEl.className = "runner";
    runnerEl.style.setProperty("--stride", "0.36s");
    hudScore.textContent = "0000";
    hudDist.textContent = "0";
    screenEl.classList.remove("shake");
    retryBtn.disabled = true;
  }

  function startGame() {
    newGame();
    countdown(() => setState("play"));
  }

  function countdown(done) {
    setState("countdown");
    ["3", "2", "1", "GO!"].forEach((n, i) => later(() => showCount(n, n === "GO!"), i * 700));
    later(() => {
      last = performance.now();
      done();
    }, 2350);
  }

  function showCount(text, isGo) {
    countdownEl.textContent = text;
    countdownEl.className = "countdown";
    void countdownEl.offsetWidth;
    countdownEl.className = "countdown pop" + (isGo ? " is-go" : "");
    if (navigator.vibrate) navigator.vibrate(8);
  }

  function jump() {
    if (state !== "play" || !game) return;
    tapZone.classList.remove("tapped");
    void tapZone.offsetWidth;
    tapZone.classList.add("tapped");
    if (E.jump(game)) {
      wasOnGround = false;
      dust(E.RUNNER.x + 10, GROUND);
    }
  }

  // ---------- ゲームオーバー ----------

  const QUIPS = [
    "東京はそんなに甘くない。",
    "もう少し走れた。",
    "終電には間に合ったかもしれない。",
    "なんでこんなに走ってたんだろう。",
    "明日は筋肉痛。",
  ];
  const HIT_QUIPS = {
    pigeon: "鳩に負けました。",
    taxi: "タクシーは乗るもの。跳ぶものではない。",
    cone: "工事中でした。",
    fence: "この先、工事中につき通行止め。",
    bike: "放置自転車は撤去されます。",
    bag: "今日はゴミの日でした。",
    puddle: "水たまりで、靴下まで終わった。",
    sign: "営業中の看板に止められた。",
  };

  function crash() {
    setState("crash");
    runnerEl.classList.remove("is-running", "is-air", "is-land");
    runnerEl.classList.add("is-down");
    screenEl.classList.remove("shake");
    void screenEl.offsetWidth;
    screenEl.classList.add("shake");
    if (navigator.vibrate) navigator.vibrate([60, 40, 120]);

    // ぶつかった場所に星を散らす
    const x = E.RUNNER.x + 20;
    const y = GROUND - 26 - game.runner.y;
    for (let i = 0; i < 7; i++) {
      const st = document.createElement("i");
      st.className = "star";
      st.textContent = "★";
      st.style.left = x + "px";
      st.style.top = y + "px";
      const a = (Math.PI * 2 * i) / 7;
      st.style.setProperty("--dx", Math.cos(a) * 30 + "px");
      st.style.setProperty("--dy", Math.sin(a) * 24 - 10 + "px");
      fxEl.appendChild(st);
    }
    later(showResult, 950);
  }

  function showResult() {
    const meters = game.meters;
    const score = game.score;
    $("result-dist").textContent = meters;
    $("result-score").textContent = "0";
    let quip;
    if (meters >= 600) quip = "もはや東京マラソン。";
    else if (game.hit && Math.random() < 0.55) quip = HIT_QUIPS[game.hit.type];
    else quip = QUIPS[Math.floor(Math.random() * QUIPS.length)];
    $("result-quip").textContent = quip;
    $("sr-status").textContent = `ゲームオーバー。東京を${meters}メートル走りました。スコア${score}。`;

    updateShare(score, meters);
    setState("result");
    countUp($("result-score"), score);

    // 結果が出た直後の誤タップでリトライしないよう、少しだけ待つ
    later(() => {
      retryBtn.disabled = false;
      retryBtn.focus({ preventScroll: true });
    }, 700);
  }

  function countUp(el, target) {
    if (target === 0) return;
    const ms = 800;
    const start = performance.now();
    function step(now) {
      const p = Math.min(1, (now - start) / ms);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
      else {
        el.classList.remove("bump");
        void el.offsetWidth;
        el.classList.add("bump");
      }
    }
    setTimeout(() => requestAnimationFrame(step), 450);
  }

  // ---------- シェア ----------

  function gameUrl() {
    return location.href.split(/[?#]/)[0];
  }

  function shareText(score, meters) {
    return `「東京を走れ」で${score}点！\n東京を${meters}m走りました🏃\n#ちょっと暇つぶし`;
  }

  function updateShare(score, meters) {
    const text = shareText(score, meters);
    $("btn-share-x").href =
      "https://twitter.com/intent/tweet?text=" + encodeURIComponent(text) + "&url=" + encodeURIComponent(gameUrl());
    $("btn-share-native").dataset.text = text;
  }

  async function shareNative() {
    try {
      await navigator.share({ title: "東京を走れ", text: $("btn-share-native").dataset.text, url: gameUrl() });
    } catch (e) {
      // キャンセルなどは何もしない
    }
  }

  // =========================================================
  // 入力
  // =========================================================

  // リンクやボタンの上での操作か（イベントの対象が要素でない場合もある）
  function onControl(target) {
    return target instanceof Element && !!target.closest("a, button");
  }

  // プレイ中は、画面のどこをタップしてもジャンプ（リンクとボタンは除く）
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (state !== "play") return;
      if (onControl(e.target)) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      jump();
    },
    { passive: false }
  );

  document.addEventListener("keydown", (e) => {
    const isJumpKey = e.code === "Space" || e.key === " " || e.key === "Enter";
    if (!isJumpKey) return;
    if (state === "play") {
      e.preventDefault();
      if (!e.repeat) jump();
    } else if (state === "countdown" || state === "paused" || state === "crash") {
      e.preventDefault(); // カウントダウン中にページが動いたりボタンが反応したりしないように
    } else if (state === "start" && !onControl(e.target)) {
      e.preventDefault();
      startGame();
    }
  });

  $("btn-start").addEventListener("click", startGame);
  retryBtn.addEventListener("click", () => {
    if (!retryBtn.disabled) startGame();
  });

  if (navigator.share) {
    const btn = $("btn-share-native");
    btn.hidden = false;
    btn.addEventListener("click", shareNative);
  }

  // アプリを切り替えたら一時停止 → 戻ったらカウントダウンして再開
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && (state === "play" || state === "countdown") && game) {
      clearTimers();
      countdownEl.className = "countdown";
      countdownEl.textContent = "";
      setState("paused");
    } else if (!document.hidden && state === "paused") {
      countdown(() => setState("play"));
    }
  });

  // =========================================================
  // 初期化
  // =========================================================

  buildFar();
  buildMid();
  buildNear();
  fitWorld();
  if (window.ResizeObserver) new ResizeObserver(fitWorld).observe(screenEl);
  else window.addEventListener("resize", fitWorld);
  setState("start");
  requestAnimationFrame((t) => {
    last = t;
    frame(t);
  });
})();
