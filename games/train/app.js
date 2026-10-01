(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  // ---------- 設定 ----------

  const TIME_LIMIT = 10; // 秒
  const START_DELAY = [1.0, 3.8]; // 電車が動き出すまでの秒数（ランダム）
  const PASS_TIME = [1.7, 2.3]; // ドアが画面に入ってから乗車位置を過ぎて抜けるまでの秒数
  const SLOWDOWN = [0.35, 0.55]; // 乗車位置付近での減速の強さ（大きいほど遅くなる）
  const RESULT_DELAY = 1300; // 判定から結果画面までのミリ秒

  // 判定：ドアと乗車位置のズレ（ステージ幅に対する割合）
  const RANKS = [
    { max: 0.03, key: "perfect", label: "PERFECT", score: 100 },
    { max: 0.07, key: "good", label: "GOOD", score: 70 },
    { max: 0.12, key: "close", label: "ギリギリ", score: 40 },
  ];
  const MISS = { key: "miss", label: "MISS", score: 0 };

  const QUIPS = {
    perfect: "ドアの真正面。プロの乗車です。",
    good: "スムーズに乗車。今夜はちゃんと帰れる。",
    close: "駆け込み乗車はおやめください。",
    early: "ホームで一人、空を切った手。電車はこれから来る。",
    late: "ホームに残されたのは、あなたと自販機だけ。",
  };

  // ---------- 要素 ----------

  const app = $("app");
  const stage = $("stage");
  const train = $("train");
  const door = $("door-target");
  const marker = $("marker");
  const rideBtn = $("btn-ride");
  const status = $("play-status");
  const timeLabel = $("time-label");
  const countdownEl = $("countdown");
  const judgePop = $("judge-pop");

  // ---------- 状態 ----------

  let round = null; // 1プレイ分のデータ
  let timers = [];
  let rafId = 0;

  function later(fn, ms) {
    timers.push(setTimeout(fn, ms));
  }

  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
    cancelAnimationFrame(rafId);
  }

  function rand([min, max]) {
    return min + Math.random() * (max - min);
  }

  function setState(state) {
    app.dataset.state = state;
  }

  // ---------- 電車の位置 ----------

  // ドアが乗車位置に来るのが u=0.5。そこで遅く、前後で速くなる動き
  function ease(u, k) {
    return u + (k * Math.sin(2 * Math.PI * u)) / (2 * Math.PI);
  }

  // 経過秒数 → 電車の左端の位置(px)
  function trainX(r, t) {
    const u = (t - r.delay) / r.passTime;
    if (u <= 0) return r.x0;
    const span = (r.xMid - r.x0) * 2;
    if (u <= 1) return r.x0 + span * ease(u, r.k);
    // 抜けたあとは最後の速さのまま走り去る
    return r.x0 + span + span * (1 + r.k) * (u - 1);
  }

  // その瞬間の電車の速さ(px/秒, 正の値)
  function trainSpeed(r, t) {
    const u = Math.min(1, Math.max(0, (t - r.delay) / r.passTime));
    return Math.abs(((r.xMid - r.x0) * 2 * (1 + r.k * Math.cos(2 * Math.PI * u))) / r.passTime);
  }

  function placeTrain(x) {
    train.style.transform = `translate3d(${x.toFixed(1)}px, 0, 0)`;
  }

  // ステージの大きさから、電車・ドア・乗車位置の座標を測る
  function measure() {
    const stageBox = stage.getBoundingClientRect();
    placeTrain(0);
    const trainBox = train.getBoundingClientRect();
    const doorBox = door.getBoundingClientRect();
    const markerBox = marker.getBoundingClientRect();
    const width = stageBox.width;
    const doorOffset = doorBox.left + doorBox.width / 2 - trainBox.left;
    const markerX = markerBox.left + markerBox.width / 2 - stageBox.left;
    return {
      width,
      trainWidth: trainBox.width,
      doorOffset,
      markerX,
      x0: width + 12, // 画面の右外
      xMid: markerX - doorOffset, // ドアが乗車位置にぴったり来る位置
    };
  }

  // ---------- 進行 ----------

  function resetStage() {
    clearTimers();
    stage.classList.remove("is-success", "is-fail", "shake");
    judgePop.classList.remove("show");
    judgePop.className = "judge-pop";
    door.classList.remove("is-open");
    train.classList.remove("is-running");
    train.style.transition = "";
    $("particles").innerHTML = "";
    countdownEl.textContent = "";
    countdownEl.className = "countdown";
    app.classList.remove("app-warning");
    timeLabel.textContent = "まもなく";
    placeTrain(stage.getBoundingClientRect().width + 400);
  }

  function startGame() {
    resetStage();
    setState("countdown");
    rideBtn.disabled = true;
    rideBtn.textContent = "乗る！";
    status.textContent = "まもなく発車…";
    status.classList.remove("is-alert");

    ["3", "2", "1"].forEach((n, i) => later(() => showCount(n), i * 800));
    later(() => showCount("スタート！", true), 2400);
    later(beginPlay, 2700);
  }

  function showCount(text, isGo) {
    countdownEl.textContent = text;
    countdownEl.className = "countdown";
    void countdownEl.offsetWidth; // アニメーションをやり直す
    countdownEl.className = "countdown pop" + (isGo ? " is-go" : "");
    if (navigator.vibrate) navigator.vibrate(10);
  }

  function beginPlay() {
    const m = measure();
    round = {
      ...m,
      delay: rand(START_DELAY),
      passTime: rand(PASS_TIME),
      k: rand(SLOWDOWN),
      start: performance.now(),
      judged: false,
      arrived: false,
    };
    placeTrain(round.x0);
    setState("play");
    rideBtn.disabled = false;
    status.textContent = "電車を待っています…";
    rideBtn.focus({ preventScroll: true });
    rafId = requestAnimationFrame(tick);
  }

  function tick(now) {
    const r = round;
    if (!r) return;
    const t = (now - r.start) / 1000;
    const x = trainX(r, t);
    placeTrain(x);

    if (!r.arrived && t >= r.delay) {
      r.arrived = true;
      train.classList.add("is-running");
      if (!r.judged) {
        status.textContent = "来た！ 光るドアを ▲ に合わせて！";
        status.classList.add("is-alert");
      }
    }

    const left = Math.max(0, TIME_LIMIT - t);
    if (!r.judged) {
      timeLabel.textContent = `あと ${left.toFixed(1)}秒`;
      app.classList.toggle("app-warning", left <= 3);

      // 電車が走り去った or 時間切れ → 乗り遅れ
      if (x < -r.trainWidth || left <= 0) {
        judge({ timeout: true });
      }
    }

    // 判定後も、成功以外は電車が走り去るまで動かし続ける
    if (r.success || x < -r.trainWidth - 20) return;
    rafId = requestAnimationFrame(tick);
  }

  // ---------- 判定 ----------

  function ride() {
    if (!round || round.judged || app.dataset.state !== "play") return;
    rideBtn.classList.add("is-pressed");
    setTimeout(() => rideBtn.classList.remove("is-pressed"), 120);
    judge({ pressedAt: performance.now() });
  }

  function judge({ pressedAt, timeout }) {
    const r = round;
    r.judged = true;
    rideBtn.disabled = true;
    setState("judged");
    app.classList.remove("app-warning");

    let rank = MISS;
    let reason; // "early" | "late"
    let offsetSec = null;

    if (timeout) {
      reason = "late";
    } else {
      const t = (pressedAt - r.start) / 1000;
      if (t < r.delay) {
        reason = "early"; // まだ電車が動き出してもいない
      } else {
        const diff = trainX(r, t) + r.doorOffset - r.markerX; // +ならドアはまだ右（早い）
        const ratio = Math.abs(diff) / r.width;
        offsetSec = diff / trainSpeed(r, t);
        rank = RANKS.find((rk) => ratio <= rk.max) || MISS;
        reason = diff > 0 ? "early" : "late";
      }
    }

    const success = rank !== MISS;
    r.success = success;
    r.result = { rank, reason, offsetSec, timeout: !!timeout };

    if (success) {
      celebrate();
    } else {
      fail(reason);
    }

    judgePop.className = `judge-pop rank-${rank.key}`;
    $("judge-rank").textContent = rank.label;
    $("judge-msg").textContent = success ? "間に合った！" : reason === "early" ? "まだ来てません" : "終電、行っちゃいました…";
    void judgePop.offsetWidth;
    judgePop.classList.add("show");
    status.textContent = "";
    status.classList.remove("is-alert");

    later(showResult, RESULT_DELAY);
  }

  function celebrate() {
    cancelAnimationFrame(rafId);
    const r = round;
    // ドアを乗車位置にぴったり合わせて止め、開ける
    train.style.transition = "transform 0.25s ease-out";
    placeTrain(r.xMid);
    train.classList.remove("is-running");
    later(() => door.classList.add("is-open"), 200);
    stage.classList.add("is-success");
    burst(r.markerX, stage.getBoundingClientRect().height * 0.5);
    if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
  }

  function fail(reason) {
    stage.classList.add("is-fail", "shake");
    if (navigator.vibrate) navigator.vibrate(120);
    if (reason === "late") timeLabel.textContent = "発車しました";
  }

  function burst(x, y) {
    const box = $("particles");
    box.innerHTML = "";
    const colors = ["#ffd84d", "#7ac943", "#ff7a6b", "#7db4ff", "#ffffff"];
    for (let i = 0; i < 18; i++) {
      const s = document.createElement("span");
      const angle = (Math.PI * 2 * i) / 18 + Math.random() * 0.3;
      const dist = 50 + Math.random() * 70;
      s.style.left = x + "px";
      s.style.top = y + "px";
      s.style.setProperty("--dx", Math.cos(angle) * dist + "px");
      s.style.setProperty("--dy", Math.sin(angle) * dist - 20 + "px");
      s.style.setProperty("--c", colors[i % colors.length]);
      box.appendChild(s);
    }
  }

  // ---------- 結果 ----------

  function showResult() {
    const { rank, reason, offsetSec, timeout } = round.result;
    const success = rank !== MISS;

    $("result-title").textContent = success ? "間に合った！" : reason === "early" ? "まだ来てません" : "終電、行っちゃいました…";
    const rankEl = $("result-rank");
    rankEl.textContent = rank.label;
    $("result-card").className = `result-card rank-${rank.key}`;

    let detail;
    if (timeout) detail = "「乗る！」を押さないまま、終電は去った。";
    else if (offsetSec === null) detail = "電車が来る前に押しました。";
    else if (Math.abs(offsetSec) < 0.005) detail = "ズレ 0.00秒。ピッタリ！";
    else detail = `ズレ ${Math.abs(offsetSec).toFixed(2)}秒（${offsetSec > 0 ? "早め" : "遅め"}）`;
    $("result-detail").textContent = detail;
    $("result-quip").textContent = success ? QUIPS[rank.key] : QUIPS[reason];

    updateShare(rank);
    setState("result");
    countUp($("result-score"), rank.score);
  }

  function countUp(el, target) {
    el.textContent = "0";
    el.parentElement.classList.remove("bump");
    if (target === 0) return;
    const ms = 700;
    const start = performance.now();
    function step(now) {
      const p = Math.min(1, (now - start) / ms);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) {
        requestAnimationFrame(step);
      } else {
        el.parentElement.classList.add("bump");
      }
    }
    requestAnimationFrame(step);
  }

  // ---------- シェア ----------

  function shareText(rank) {
    if (rank === MISS) {
      return `「終電を逃すな」でMISS…\n${rank.score}点でした🚃 終電、行っちゃいました\n#ちょっと暇つぶし`;
    }
    return `「終電を逃すな」で${rank.label}！\n${rank.score}点でした🚃\n#ちょっと暇つぶし`;
  }

  function gameUrl() {
    return location.href.split(/[?#]/)[0];
  }

  function updateShare(rank) {
    const text = shareText(rank);
    const url = gameUrl();
    $("btn-share-x").href =
      "https://twitter.com/intent/tweet?text=" + encodeURIComponent(text) + "&url=" + encodeURIComponent(url);
    $("btn-share-native").dataset.text = text;
  }

  async function shareNative() {
    const text = $("btn-share-native").dataset.text;
    try {
      await navigator.share({ title: "終電を逃すな", text, url: gameUrl() });
    } catch (e) {
      // キャンセルなどは何もしない
    }
  }

  // ---------- イベント ----------

  $("btn-start").addEventListener("click", startGame);
  $("btn-retry").addEventListener("click", startGame);

  // タップした瞬間に判定したいので pointerdown を使う
  rideBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    ride();
  });
  // キーボード操作（Enter / Space）でボタンが押されたとき
  rideBtn.addEventListener("click", (e) => {
    if (e.detail === 0) ride();
  });
  document.addEventListener("keydown", (e) => {
    if ((e.code === "Space" || e.key === "Enter") && app.dataset.state === "play" && document.activeElement !== rideBtn) {
      e.preventDefault();
      ride();
    }
  });

  if (navigator.share) {
    const btn = $("btn-share-native");
    btn.hidden = false;
    btn.addEventListener("click", shareNative);
  }

  // プレイ中にアプリを切り替えたら、仕切り直し
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && ["countdown", "play"].includes(app.dataset.state)) {
      resetStage();
      round = null;
      setState("start");
    }
  });

  resetStage();
})();
