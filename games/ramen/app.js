(() => {
  "use strict";

  const E = RamenEngine;
  const $ = (id) => document.getElementById(id);
  const SVG_NS = "http://www.w3.org/2000/svg";

  const app = $("app");
  const screenEl = $("screen");
  const eatBtn = $("btn-eat");
  const eatLabel = $("eat-label");
  const retryBtn = $("btn-retry");
  const moodEl = $("mood");
  const popsEl = $("pops");
  const countdownEl = $("countdown");
  const gaugeFill = $("gauge-fill");
  const gaugeBar = $("gauge-bar");
  const stretchNum = $("stretch-num");
  const scoreEl = $("score");

  let state = "start"; // start | countdown | play | paused | over | result
  let game = null;
  let last = performance.now();
  let timers = [];
  let shownStretch = -1;
  let shownScore = -1;
  let moodLevel = -1;

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

  // 同じアニメーションをもう一度最初から再生する
  function replay(el, cls) {
    el.classList.remove(cls);
    void el.getBoundingClientRect();
    el.classList.add(cls);
  }

  // =========================================================
  // 麺（SVGで生成）
  // =========================================================

  let seed = 7;
  function rnd() {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  }

  function makePath(d, parent) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    parent.appendChild(p);
    return p;
  }

  // どんぶりの中の麺（からまった曲線）
  const bowlNoodles = $("bowl-noodles");
  for (let i = 0; i < 16; i++) {
    const pt = () => [60 + rnd() * 180, 158 + rnd() * 38];
    const [x0, y0] = pt();
    let d = `M${x0.toFixed(1)} ${y0.toFixed(1)}`;
    for (let k = 0; k < 3; k++) {
      const [x1, y1] = pt();
      const [x2, y2] = pt();
      const [x3, y3] = pt();
      d += ` C${x1.toFixed(1)} ${y1.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)} ${x3.toFixed(1)} ${y3.toFixed(1)}`;
    }
    makePath(d, bowlNoodles);
  }

  // どんぶりからあふれて、カウンターに広がっていく麺
  const overflow = [];
  for (let i = 0; i < 8; i++) {
    // どんぶりの手前のふち → 胴をつたって → カウンターへ
    const x0 = 84 + i * 19 + rnd() * 6;
    const bulge = x0 < 150 ? -10 : 10;
    let d = `M${x0.toFixed(1)} 194 Q${(x0 + bulge).toFixed(1)} 214 ${(x0 + bulge * 0.6 + (rnd() - 0.5) * 10).toFixed(1)} 240`;
    for (let k = 0; k < 9; k++) {
      const x = 8 + rnd() * 284;
      const y = 246 + rnd() * 70;
      const cx = (x + (rnd() - 0.5) * 80).toFixed(1);
      const cy = (y + (rnd() - 0.5) * 40).toFixed(1);
      d += ` Q${cx} ${cy} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    const p = makePath(d, $("overflow"));
    const len = p.getTotalLength();
    p.style.strokeDasharray = `${len} ${len}`;
    p.style.strokeDashoffset = `${len}`;
    overflow.push({ p, len, start: 8 + i * 5 }); // 伸び具合が start% を超えたら垂れ始める
  }

  // 伸び具合を麺の見た目に反映
  function renderNoodles(stretch) {
    overflow.forEach((n) => {
      // 最初はちょろっと、後半に一気に伸びる
      const f = Math.pow(Math.max(0, Math.min(1, (stretch - n.start) / (100 - n.start))), 1.7);
      n.p.style.strokeDashoffset = (n.len * (1 - f)).toFixed(1);
    });
    // 伸びるほど太く、白っぽく（ふやけた感じ）
    const w = 3 + stretch * 0.035;
    const c = Math.round(stretch * 0.6);
    screenEl.style.setProperty("--noodle-w", w.toFixed(2) + "px");
    screenEl.style.setProperty("--noodle-c", `rgb(${246 + Math.round(c * 0.15)}, ${220 + Math.round(c * 0.5)}, ${138 + c * 2})`);
  }

  // =========================================================
  // 表示
  // =========================================================

  const MOODS = [
    { max: 30, text: "うまそう" },
    { max: 60, text: "まだいける" },
    { max: 80, text: "ちょっと伸びてきた" },
    { max: 95, text: "やばい" },
    { max: 100, text: "もう無理" },
  ];

  function setMood(level, text) {
    if (level === moodLevel) return;
    moodLevel = level;
    moodEl.textContent = text;
    moodEl.className = `mood lv${level}`;
    replay(moodEl, "change");
  }

  function renderHud() {
    const st = game ? game.stretch : 0;
    const shown = Math.floor(st);
    if (shown !== shownStretch) {
      shownStretch = shown;
      stretchNum.textContent = shown;
      gaugeBar.setAttribute("aria-valuenow", shown);
      const hue = Math.round(110 * (1 - st / 100));
      screenEl.style.setProperty("--g-color", `hsl(${hue}, 80%, 55%)`);
      app.classList.toggle("app-danger", st >= 80 && state === "play");
    }
    gaugeFill.style.width = st.toFixed(1) + "%";

    if (game && game.score !== shownScore) {
      shownScore = game.score;
      scoreEl.textContent = game.score;
    }

    if (state === "play") {
      if (game.t < 1.2) setMood(0, "いただきます。");
      else {
        const i = MOODS.findIndex((m) => st < m.max);
        const idx = i < 0 ? MOODS.length - 1 : i;
        setMood(idx + 1, MOODS[idx].text);
      }
    }

    // 口の中（ボタンにたまっていく）
    const mouth = game ? Math.min(1, game.mouth / 100) : 0;
    eatBtn.style.setProperty("--mouth", mouth.toFixed(3));
    eatBtn.classList.toggle("full", mouth > 0.7);
    const choking = !!game && game.choke > 0 && state === "play";
    if (choking !== eatBtn.classList.contains("choking")) {
      eatBtn.classList.toggle("choking", choking);
      eatLabel.textContent = choking ? "ゲホゲホ…" : "🍜 食べる！";
    }
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (state === "play" && game) {
      E.step(game, dt);
      if (game.over) finish();
    }
    renderNoodles(game ? game.stretch : 0);
    renderHud();
    requestAnimationFrame(frame);
  }

  // =========================================================
  // 演出
  // =========================================================

  const SLURPS = ["ズズッ！", "ズゾゾッ！", "チュルッ！", "ズルルッ！", "ズッ！"];

  function pop(text, cls, x, y, rot) {
    const el = document.createElement("p");
    el.className = "pop" + (cls ? " " + cls : "");
    el.textContent = text;
    el.style.left = x + "%";
    el.style.top = y + "%";
    el.style.setProperty("--r", rot + "deg");
    popsEl.appendChild(el);
    setTimeout(() => el.remove(), 1000);
    // 連打しても文字がたまりすぎないように
    while (popsEl.children.length > 4) popsEl.firstChild.remove();
  }

  function eat() {
    if (state !== "play" || !game) return;
    replay(eatBtn, "is-pressed");
    setTimeout(() => eatBtn.classList.remove("is-pressed"), 90);

    const r = E.bite(game);
    if (r.type === "blocked") return;

    if (r.type === "choke") {
      pop("ゲホッ！", "choke", 26 + Math.random() * 10, 38, -6);
      replay(screenEl, "shake");
      if (navigator.vibrate) navigator.vibrate(90);
      return;
    }

    replay(screenEl, "slurp");
    replay(screenEl, "puff");
    if (r.type === "kaedama") {
      pop(`替え玉！ +${E.C.KAEDAMA_BONUS}`, "bonus", 18, 30, -4);
      if (navigator.vibrate) navigator.vibrate([20, 30, 20]);
    } else {
      pop(SLURPS[Math.floor(Math.random() * SLURPS.length)], "", 52 + Math.random() * 16, 26 + Math.random() * 10, -12 + Math.random() * 18);
      if (navigator.vibrate) navigator.vibrate(6);
    }
  }

  // =========================================================
  // 進行
  // =========================================================

  function startGame() {
    clearTimers();
    game = E.create();
    shownStretch = -1;
    shownScore = -1;
    moodLevel = -1;
    moodEl.textContent = "";
    popsEl.innerHTML = "";
    retryBtn.disabled = true;
    screenEl.classList.remove("shake");
    countdown(() => setState("play"));
  }

  function countdown(done) {
    setState("countdown");
    ["3", "2", "1", "いただきます！"].forEach((n, i) => later(() => showCount(n, i === 3), i * 650));
    later(() => {
      last = performance.now();
      done();
      eatBtn.focus({ preventScroll: true });
    }, 2500);
  }

  function showCount(text, isGo) {
    countdownEl.textContent = text;
    countdownEl.className = "countdown";
    void countdownEl.offsetWidth;
    countdownEl.className = "countdown pop-in" + (isGo ? " is-go" : "");
  }

  const QUIPS = [
    "もう少し早く食べればよかった。",
    "これはもうラーメンではない。",
    "店主も心配しています。",
    "麺は待ってくれない。",
    "伸びた麺にも、良さはある。たぶん。",
    "スープまで飲み干す気力はない。",
  ];

  function finish() {
    setState("over");
    app.classList.remove("app-danger");
    setMood(9, "完全に伸びました。");
    moodEl.className = "mood lv5";
    replay(screenEl, "shake");
    if (navigator.vibrate) navigator.vibrate(150);
    later(showResult, 1200);
  }

  function showResult() {
    const eaten = Math.round(game.eaten);
    $("result-eaten").textContent = eaten;
    $("result-score").textContent = "0";
    const extra = [];
    if (game.kaedama) extra.push(`替え玉 ${game.kaedama}回`);
    if (game.chokes) extra.push(`むせた ${game.chokes}回`);
    extra.push(`${game.t.toFixed(1)}秒`);
    $("result-extra").textContent = extra.join(" ・ ");

    let quip = QUIPS[Math.floor(Math.random() * QUIPS.length)];
    if (eaten < 30) quip = "ほぼ食べてない。";
    else if (game.chokes >= 4 && Math.random() < 0.6) quip = "むせすぎです。落ち着いて。";
    else if (game.kaedama >= 2 && Math.random() < 0.5) quip = "替え玉どころではありません。";
    $("result-quip").textContent = quip;

    updateShare(game.score, eaten);
    setState("result");
    countUp($("result-score"), game.score);
    later(() => {
      retryBtn.disabled = false;
      retryBtn.focus({ preventScroll: true });
    }, 600);
  }

  function countUp(el, target) {
    if (target === 0) return;
    const ms = 700;
    let start = 0;
    function step(now) {
      if (!start) start = now;
      const p = Math.min(1, (now - start) / ms);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
      else replay(el, "bump");
    }
    setTimeout(() => requestAnimationFrame(step), 250);
  }

  // =========================================================
  // シェア
  // =========================================================

  function gameUrl() {
    return location.href.split(/[?#]/)[0];
  }

  function updateShare(score, eaten) {
    const text = `「ラーメンを伸ばすな」で${score}点！\n麺を${eaten}%食べました🍜\n#ちょっと暇つぶし`;
    $("btn-share-x").href =
      "https://twitter.com/intent/tweet?text=" + encodeURIComponent(text) + "&url=" + encodeURIComponent(gameUrl());
    $("btn-share-native").dataset.text = text;
  }

  async function shareNative() {
    try {
      await navigator.share({ title: "ラーメンを伸ばすな", text: $("btn-share-native").dataset.text, url: gameUrl() });
    } catch (e) {
      // キャンセルなどは何もしない
    }
  }

  // =========================================================
  // 入力
  // =========================================================

  // 押した瞬間に食べる（pointerdown）。ボタンでも、ラーメンの画面でもOK
  eatBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    eat();
  });
  screenEl.addEventListener("pointerdown", (e) => {
    if (state !== "play") return;
    e.preventDefault();
    eat();
  });

  function onControl(target) {
    return target instanceof Element && !!target.closest("a, button");
  }

  document.addEventListener("keydown", (e) => {
    const isKey = e.code === "Space" || e.key === " " || e.key === "Enter";
    if (!isKey) return;
    if (state === "play") {
      e.preventDefault(); // ボタンの「クリック」として二重に反応しないように
      if (!e.repeat) eat(); // 押しっぱなしの連打は無効
    } else if (state === "countdown" || state === "over" || state === "paused") {
      e.preventDefault();
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

  setState("start");
  requestAnimationFrame((t) => {
    last = t;
    frame(t);
  });
})();
