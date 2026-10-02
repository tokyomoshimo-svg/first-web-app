// ぽよぽよブラスト：画面・アニメーション・音・入力
//
// ・盤面は canvas に描く。ぽよやブースターの絵は、最初に1回だけ描いておき（キャッシュ）、毎フレームは貼るだけ
// ・タップの結果（engine.js の出来事の列）を、時間どおりに再生する
// ・目標アイコンへ飛んでいくぽよ・ほめ言葉・紙ふぶきは、画面全体を覆う「演出用 canvas」に描く

(() => {
  "use strict";

  const PB = PopBlast;
  const LEVELS = POP_LEVELS;
  const $ = (id) => document.getElementById(id);
  const app = $("pb-app");
  const boardCanvas = $("pb-canvas");
  const bctx = boardCanvas.getContext("2d");
  const fxCanvas = document.createElement("canvas");
  fxCanvas.className = "pb-fx";
  fxCanvas.setAttribute("aria-hidden", "true");
  Object.assign(fxCanvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none", zIndex: "10" });
  app.appendChild(fxCanvas);
  const fctx = fxCanvas.getContext("2d");

  // =========================================================
  // セーブ（端末の中だけ）
  // =========================================================

  const SAVE_KEY = "popoBlastSave.v1";
  const save = (() => {
    let d = null;
    try {
      d = JSON.parse(localStorage.getItem(SAVE_KEY));
    } catch (e) {
      d = null;
    }
    return { unlocked: 1, stars: {}, best: {}, sound: true, seenBooster: false, seenCombo: false, ...(d || {}) };
  })();
  function writeSave() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(save));
    } catch (e) {
      /* 保存できなくても遊べる */
    }
  }

  // =========================================================
  // 音（Web Audio。最初のタップのあとで用意する）
  // =========================================================

  const Sound = {
    ctx: null,
    master: null,
    lastPop: 0,
    unlock() {
      try {
        if (!this.ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          this.ctx = new AC();
          this.master = this.ctx.createGain();
          this.master.gain.value = 0.5;
          this.master.connect(this.ctx.destination);
        }
        if (this.ctx.state === "suspended") this.ctx.resume();
      } catch (e) {
        this.ctx = null;
      }
    },
    ok() {
      return save.sound && this.ctx && this.ctx.state === "running";
    },
    tone(freq, dur, { type = "sine", vol = 0.2, slide = 0, delay = 0 } = {}) {
      if (!this.ok()) return;
      try {
        const c = this.ctx;
        const t = c.currentTime + delay;
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, t);
        if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(this.master);
        o.start(t);
        o.stop(t + dur + 0.02);
      } catch (e) {
        /* 鳴らなくても続ける */
      }
    },
    noise(dur, { vol = 0.2, freq = 1200, to = 0, delay = 0, q = 0.8 } = {}) {
      if (!this.ok()) return;
      try {
        const c = this.ctx;
        const t = c.currentTime + delay;
        if (!this.noiseBuf) {
          this.noiseBuf = c.createBuffer(1, c.sampleRate * 0.6, c.sampleRate);
          const d = this.noiseBuf.getChannelData(0);
          for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        }
        const s = c.createBufferSource();
        s.buffer = this.noiseBuf;
        const f = c.createBiquadFilter();
        f.type = "bandpass";
        f.Q.value = q;
        f.frequency.setValueAtTime(freq, t);
        if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
        const g = c.createGain();
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        s.connect(f).connect(g).connect(this.master);
        s.start(t);
        s.stop(t + dur + 0.02);
      } catch (e) {
        /* 鳴らなくても続ける */
      }
    },
    pop(size = 2) {
      const now = performance.now();
      if (now - this.lastPop < 35) return;
      this.lastPop = now;
      const f = 520 + Math.min(size, 20) * 28;
      this.tone(f, 0.12, { type: "sine", vol: 0.22, slide: 1.8 });
      this.tone(f * 1.5, 0.08, { type: "triangle", vol: 0.08, slide: 1.4, delay: 0.02 });
    },
    smallPop() {
      const now = performance.now();
      if (now - this.lastPop < 28) return;
      this.lastPop = now;
      this.tone(700 + Math.random() * 500, 0.07, { type: "sine", vol: 0.1, slide: 1.6 });
    },
    invalid() {
      this.tone(170, 0.14, { type: "square", vol: 0.06, slide: 0.7 });
    },
    create() {
      [660, 880, 1175].forEach((f, i) => this.tone(f, 0.16, { type: "triangle", vol: 0.13, delay: i * 0.05 }));
    },
    rocket() {
      this.noise(0.35, { vol: 0.28, freq: 600, to: 3200, q: 1.2 });
      this.tone(300, 0.3, { type: "sawtooth", vol: 0.04, slide: 3 });
    },
    bomb(big) {
      this.tone(big ? 70 : 95, big ? 0.6 : 0.4, { type: "sine", vol: 0.45, slide: 0.4 });
      this.noise(big ? 0.55 : 0.35, { vol: 0.35, freq: 400, to: 90, q: 0.6 });
    },
    disco() {
      [1047, 1319, 1568, 2093, 1568, 2093, 2637].forEach((f, i) => this.tone(f, 0.12, { type: "sine", vol: 0.08, delay: i * 0.045 }));
    },
    combo() {
      [523, 659, 784, 1047].forEach((f) => this.tone(f, 0.45, { type: "triangle", vol: 0.09 }));
      this.noise(0.4, { vol: 0.2, freq: 2000, to: 500 });
    },
    goal() {
      this.tone(1320, 0.06, { type: "sine", vol: 0.07, slide: 1.2 });
    },
    star(i) {
      const f = [784, 988, 1319][i] || 1319;
      this.tone(f, 0.35, { type: "triangle", vol: 0.16 });
      this.tone(f * 2, 0.25, { type: "sine", vol: 0.06, delay: 0.03 });
    },
    win() {
      [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.22, { type: "triangle", vol: 0.13, delay: i * 0.09 }));
    },
    lose() {
      [523, 466, 392, 311].forEach((f, i) => this.tone(f, 0.3, { type: "triangle", vol: 0.11, delay: i * 0.16 }));
    },
    click() {
      this.tone(880, 0.05, { type: "sine", vol: 0.08, slide: 1.3 });
    },
    whoosh() {
      this.noise(0.25, { vol: 0.12, freq: 900, to: 300 });
    },
  };
  const buzz = (ms) => {
    try {
      if (save.sound && navigator.vibrate) navigator.vibrate(ms);
    } catch (e) {
      /* 振動できなくてもよい */
    }
  };

  // =========================================================
  // 絵（ぽよ・ブースター・障害物）。セルの大きさで1回だけ描いてキャッシュ
  // =========================================================

  const COLORS = [
    { base: "#ff5a72", light: "#ffb3c0", dark: "#d22f4f", name: "赤" },
    { base: "#ffc93d", light: "#fff0a6", dark: "#e39410", name: "黄" },
    { base: "#3fa6ff", light: "#a6dbff", dark: "#1f6ed6", name: "青" },
    { base: "#4cd47f", light: "#b2f2c6", dark: "#21a258", name: "緑" },
    { base: "#ae73ff", light: "#ddc4ff", dark: "#7c41e3", name: "紫" },
  ];
  const DPR = () => Math.min(window.devicePixelRatio || 1, 2);
  const spriteCache = new Map();
  let spriteSize = 0;

  function sprite(key, size, draw) {
    const k = key + "@" + size;
    let c = spriteCache.get(k);
    if (!c) {
      c = document.createElement("canvas");
      const px = Math.max(8, Math.round(size * DPR()));
      c.width = c.height = px;
      const g = c.getContext("2d");
      g.scale(px, px);
      draw(g);
      spriteCache.set(k, c);
    }
    return c;
  }

  function ellipse(g, x, y, rx, ry, rot = 0) {
    g.beginPath();
    g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  }

  // ぽよ（色ごとに顔が少しちがう）
  function drawPoyo(g, color, blink) {
    const C = COLORS[color];
    // かげ
    g.fillStyle = "rgba(30,20,60,0.18)";
    ellipse(g, 0.5, 0.9, 0.3, 0.05);
    g.fill();
    // 体
    const grad = g.createRadialGradient(0.38, 0.33, 0.05, 0.5, 0.52, 0.5);
    grad.addColorStop(0, C.light);
    grad.addColorStop(0.45, C.base);
    grad.addColorStop(1, C.dark);
    g.fillStyle = grad;
    ellipse(g, 0.5, 0.53, 0.43, 0.4);
    g.fill();
    g.lineWidth = 0.035;
    g.strokeStyle = C.dark;
    g.stroke();
    // つや
    g.fillStyle = "rgba(255,255,255,0.7)";
    ellipse(g, 0.33, 0.32, 0.1, 0.06, -0.6);
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.45)";
    ellipse(g, 0.48, 0.24, 0.035, 0.025);
    g.fill();
    // 顔
    const eye = (x, open) => {
      if (!open) {
        g.strokeStyle = "#2b2550";
        g.lineWidth = 0.035;
        g.lineCap = "round";
        g.beginPath();
        g.arc(x, 0.52, 0.055, Math.PI * 0.15, Math.PI * 0.85);
        g.stroke();
        return;
      }
      g.fillStyle = "#fff";
      ellipse(g, x, 0.5, color === 2 ? 0.085 : 0.07, color === 2 ? 0.1 : 0.085);
      g.fill();
      g.fillStyle = "#2b2550";
      ellipse(g, x + 0.01, 0.52, color === 2 ? 0.055 : 0.045, color === 2 ? 0.065 : 0.055);
      g.fill();
      g.fillStyle = "#fff";
      ellipse(g, x + 0.025, 0.495, 0.018, 0.018);
      g.fill();
      if (color === 4) {
        ellipse(g, x - 0.012, 0.545, 0.01, 0.01);
        g.fill();
      }
      if (color === 3) {
        // ねむそうなまぶた
        g.fillStyle = C.base;
        g.fillRect(x - 0.1, 0.4, 0.2, 0.085);
        g.strokeStyle = C.dark;
        g.lineWidth = 0.02;
        g.beginPath();
        g.moveTo(x - 0.075, 0.487);
        g.lineTo(x + 0.075, 0.487);
        g.stroke();
      }
    };
    if (color === 1) {
      // にっこり目（^ ^）
      g.strokeStyle = "#2b2550";
      g.lineWidth = 0.04;
      g.lineCap = "round";
      for (const x of [0.37, 0.63]) {
        g.beginPath();
        g.arc(x, 0.54, 0.06, Math.PI * 1.15, Math.PI * 1.85);
        g.stroke();
      }
    } else {
      eye(0.37, !blink);
      eye(0.63, !blink);
    }
    // 口とほっぺ
    g.strokeStyle = "#2b2550";
    g.lineWidth = 0.028;
    g.lineCap = "round";
    g.beginPath();
    if (color === 0 || color === 1) g.arc(0.5, 0.62, 0.05, Math.PI * 0.15, Math.PI * 0.85);
    else if (color === 2) {
      g.moveTo(0.46, 0.66);
      g.quadraticCurveTo(0.5, 0.69, 0.54, 0.66);
    } else if (color === 3) {
      g.moveTo(0.47, 0.66);
      g.lineTo(0.53, 0.66);
    } else {
      g.arc(0.5, 0.64, 0.035, 0, Math.PI);
    }
    g.stroke();
    g.fillStyle = "rgba(255,120,150,0.45)";
    ellipse(g, 0.25, 0.62, 0.06, 0.035);
    g.fill();
    ellipse(g, 0.75, 0.62, 0.06, 0.035);
    g.fill();
  }

  function drawRocket(g, dir) {
    g.save();
    if (dir === "v") {
      g.translate(0.5, 0.5);
      g.rotate(Math.PI / 2);
      g.translate(-0.5, -0.5);
    }
    g.fillStyle = "rgba(30,20,60,0.2)";
    ellipse(g, 0.5, 0.78, 0.36, 0.06);
    g.fill();
    // 両はしがとがった、2方向に飛ぶロケット
    const body = g.createLinearGradient(0, 0.32, 0, 0.7);
    body.addColorStop(0, "#ffffff");
    body.addColorStop(0.5, "#e8ecff");
    body.addColorStop(1, "#b8c0e8");
    g.fillStyle = body;
    g.beginPath();
    g.moveTo(0.06, 0.5);
    g.quadraticCurveTo(0.16, 0.31, 0.32, 0.31);
    g.lineTo(0.68, 0.31);
    g.quadraticCurveTo(0.84, 0.31, 0.94, 0.5);
    g.quadraticCurveTo(0.84, 0.69, 0.68, 0.69);
    g.lineTo(0.32, 0.69);
    g.quadraticCurveTo(0.16, 0.69, 0.06, 0.5);
    g.fill();
    g.lineWidth = 0.03;
    g.strokeStyle = "#5a5f9a";
    g.stroke();
    // 赤い先っぽ
    g.fillStyle = "#ff4d6d";
    for (const s of [0, 1]) {
      g.beginPath();
      if (s === 0) {
        g.moveTo(0.06, 0.5);
        g.quadraticCurveTo(0.12, 0.36, 0.22, 0.34);
        g.lineTo(0.22, 0.66);
        g.quadraticCurveTo(0.12, 0.64, 0.06, 0.5);
      } else {
        g.moveTo(0.94, 0.5);
        g.quadraticCurveTo(0.88, 0.36, 0.78, 0.34);
        g.lineTo(0.78, 0.66);
        g.quadraticCurveTo(0.88, 0.64, 0.94, 0.5);
      }
      g.fill();
    }
    // 羽
    g.fillStyle = "#ffb238";
    for (const y of [0.31, 0.69]) {
      g.beginPath();
      g.moveTo(0.42, y);
      g.lineTo(0.5, y + (y < 0.5 ? -0.15 : 0.15));
      g.lineTo(0.58, y);
      g.fill();
    }
    // 窓
    const win = g.createRadialGradient(0.47, 0.46, 0.01, 0.5, 0.5, 0.1);
    win.addColorStop(0, "#c9f0ff");
    win.addColorStop(1, "#2f8fe0");
    g.fillStyle = win;
    ellipse(g, 0.5, 0.5, 0.085, 0.085);
    g.fill();
    g.strokeStyle = "#5a5f9a";
    g.lineWidth = 0.025;
    g.stroke();
    g.restore();
  }

  function drawBomb(g) {
    g.fillStyle = "rgba(30,20,60,0.2)";
    ellipse(g, 0.5, 0.9, 0.3, 0.05);
    g.fill();
    const grad = g.createRadialGradient(0.4, 0.45, 0.04, 0.5, 0.58, 0.4);
    grad.addColorStop(0, "#7a83c9");
    grad.addColorStop(0.5, "#3a3f7a");
    grad.addColorStop(1, "#1d1f45");
    g.fillStyle = grad;
    ellipse(g, 0.5, 0.58, 0.34, 0.34);
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.55)";
    ellipse(g, 0.38, 0.45, 0.08, 0.05, -0.6);
    g.fill();
    // ふた・導火線
    g.fillStyle = "#8a90b8";
    g.fillRect(0.42, 0.2, 0.16, 0.08);
    g.strokeStyle = "#c8a36a";
    g.lineWidth = 0.035;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(0.5, 0.2);
    g.quadraticCurveTo(0.56, 0.08, 0.68, 0.1);
    g.stroke();
    // 星のマーク
    g.fillStyle = "#ffd23b";
    star(g, 0.5, 0.6, 0.11, 0.05);
    g.fill();
  }

  function star(g, x, y, R, r, n = 5) {
    g.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / n;
      const rr = i % 2 ? r : R;
      g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.closePath();
  }

  function drawDisco(g, color) {
    g.fillStyle = "rgba(30,20,60,0.2)";
    ellipse(g, 0.5, 0.9, 0.3, 0.05);
    g.fill();
    const rainbow = ["#ff5a72", "#ffb238", "#ffe36b", "#4cd47f", "#3fa6ff", "#ae73ff"];
    for (let i = 0; i < 12; i++) {
      g.fillStyle = rainbow[i % 6];
      g.beginPath();
      g.moveTo(0.5, 0.52);
      g.arc(0.5, 0.52, 0.4, (i / 12) * Math.PI * 2, ((i + 1) / 12) * Math.PI * 2);
      g.closePath();
      g.fill();
    }
    const gl = g.createRadialGradient(0.42, 0.4, 0.02, 0.5, 0.52, 0.42);
    gl.addColorStop(0, "rgba(255,255,255,0.95)");
    gl.addColorStop(0.35, "rgba(255,255,255,0.25)");
    gl.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gl;
    ellipse(g, 0.5, 0.52, 0.4, 0.4);
    g.fill();
    g.lineWidth = 0.035;
    g.strokeStyle = "#fff";
    g.stroke();
    // まんなか：消す色
    g.fillStyle = COLORS[color] ? COLORS[color].base : "#fff";
    ellipse(g, 0.5, 0.52, 0.13, 0.13);
    g.fill();
    g.strokeStyle = "#fff";
    g.lineWidth = 0.03;
    g.stroke();
    g.fillStyle = "#fff";
    star(g, 0.5, 0.52, 0.08, 0.035, 4);
    g.fill();
  }

  function drawBox(g, hp) {
    const x = 0.07;
    const w = 0.86;
    g.fillStyle = "rgba(30,20,60,0.2)";
    g.fillRect(x + 0.03, x + 0.05, w, w);
    const grad = g.createLinearGradient(0, x, 0, x + w);
    grad.addColorStop(0, "#f0b876");
    grad.addColorStop(1, "#c98443");
    g.fillStyle = grad;
    rr(g, x, x, w, w, 0.08);
    g.fill();
    g.strokeStyle = "#8a5426";
    g.lineWidth = 0.04;
    g.stroke();
    // 板の継ぎ目
    g.strokeStyle = "rgba(120,70,30,0.5)";
    g.lineWidth = 0.02;
    for (const y of [0.36, 0.64]) {
      g.beginPath();
      g.moveTo(x + 0.04, y);
      g.lineTo(x + w - 0.04, y);
      g.stroke();
    }
    g.strokeStyle = "#a0622d";
    g.lineWidth = 0.06;
    g.beginPath();
    g.moveTo(x + 0.1, x + 0.1);
    g.lineTo(x + w - 0.1, x + w - 0.1);
    g.stroke();
    if (hp >= 2) {
      // 2回たたく木箱：金具つき
      g.fillStyle = "#9aa3c0";
      g.fillRect(x, 0.2, w, 0.09);
      g.fillRect(x, 0.71, w, 0.09);
      g.fillStyle = "#e6ebff";
      for (const px of [0.18, 0.5, 0.82]) {
        ellipse(g, px, 0.245, 0.025, 0.025);
        g.fill();
        ellipse(g, px, 0.755, 0.025, 0.025);
        g.fill();
      }
    }
    g.fillStyle = "rgba(255,255,255,0.35)";
    g.fillRect(x + 0.05, x + 0.04, w - 0.1, 0.05);
  }

  function rr(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function drawStone(g) {
    g.fillStyle = "rgba(30,20,60,0.2)";
    ellipse(g, 0.5, 0.88, 0.38, 0.07);
    g.fill();
    const grad = g.createLinearGradient(0, 0.1, 0, 0.9);
    grad.addColorStop(0, "#c7cede");
    grad.addColorStop(1, "#7c859c");
    g.fillStyle = grad;
    g.beginPath();
    const pts = [[0.18, 0.3], [0.42, 0.1], [0.72, 0.16], [0.9, 0.42], [0.84, 0.78], [0.55, 0.9], [0.2, 0.82], [0.08, 0.55]];
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fill();
    g.strokeStyle = "#5b627a";
    g.lineWidth = 0.035;
    g.stroke();
    g.strokeStyle = "rgba(60,64,90,0.6)";
    g.lineWidth = 0.025;
    g.beginPath();
    g.moveTo(0.42, 0.18);
    g.lineTo(0.48, 0.42);
    g.lineTo(0.38, 0.58);
    g.moveTo(0.48, 0.42);
    g.lineTo(0.68, 0.5);
    g.stroke();
    g.fillStyle = "rgba(255,255,255,0.4)";
    ellipse(g, 0.34, 0.3, 0.1, 0.05, -0.5);
    g.fill();
  }

  function drawBalloon(g) {
    g.strokeStyle = "#8a86a8";
    g.lineWidth = 0.02;
    g.beginPath();
    g.moveTo(0.5, 0.74);
    g.quadraticCurveTo(0.42, 0.84, 0.52, 0.96);
    g.stroke();
    const grad = g.createRadialGradient(0.4, 0.3, 0.03, 0.5, 0.42, 0.36);
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.4, "#ffd2ec");
    grad.addColorStop(1, "#ff8cc6");
    g.fillStyle = grad;
    ellipse(g, 0.5, 0.42, 0.31, 0.34);
    g.fill();
    g.strokeStyle = "#e0559d";
    g.lineWidth = 0.03;
    g.stroke();
    g.fillStyle = "#e0559d";
    g.beginPath();
    g.moveTo(0.46, 0.79);
    g.lineTo(0.54, 0.79);
    g.lineTo(0.5, 0.74);
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.85)";
    ellipse(g, 0.38, 0.28, 0.06, 0.1, -0.4);
    g.fill();
  }

  function drawGift(g) {
    g.fillStyle = "rgba(30,20,60,0.2)";
    ellipse(g, 0.5, 0.9, 0.34, 0.05);
    g.fill();
    const grad = g.createLinearGradient(0, 0.35, 0, 0.9);
    grad.addColorStop(0, "#c58cff");
    grad.addColorStop(1, "#8a4fe6");
    g.fillStyle = grad;
    rr(g, 0.14, 0.38, 0.72, 0.5, 0.06);
    g.fill();
    g.fillStyle = "#b07af5";
    rr(g, 0.1, 0.3, 0.8, 0.14, 0.05);
    g.fill();
    g.fillStyle = "#ffd23b";
    g.fillRect(0.45, 0.3, 0.1, 0.58);
    g.fillRect(0.1, 0.34, 0.8, 0.07);
    // リボン
    g.beginPath();
    g.ellipse(0.38, 0.24, 0.11, 0.07, -0.5, 0, Math.PI * 2);
    g.ellipse(0.62, 0.24, 0.11, 0.07, 0.5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#f2b400";
    ellipse(g, 0.5, 0.28, 0.05, 0.05);
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.35)";
    g.fillRect(0.18, 0.46, 0.06, 0.32);
  }

  // 駒の絵（キー：種類・色・向き・hp・まばたき）
  function pieceSprite(p, size, { blink = false, hp } = {}) {
    switch (p.t) {
      case "c":
        return sprite(`c${p.color}${blink ? "b" : ""}`, size, (g) => drawPoyo(g, p.color, blink));
      case "rocket":
        return sprite(`r${p.dir}`, size, (g) => drawRocket(g, p.dir));
      case "bomb":
        return sprite("bomb", size, drawBomb);
      case "disco":
        return sprite(`d${p.color}`, size, (g) => drawDisco(g, p.color));
      case "box": {
        const h = hp !== undefined ? hp : p.hp;
        return sprite(`box${h}`, size, (g) => drawBox(g, h));
      }
      case "stone":
        return sprite("stone", size, drawStone);
      case "balloon":
        return sprite("balloon", size, drawBalloon);
      case "gift":
        return sprite("gift", size, drawGift);
    }
    return null;
  }

  function goalSprite(goal, size) {
    if (goal.type === "color") return pieceSprite({ t: "c", color: goal.color }, size);
    if (goal.type === "box") return pieceSprite({ t: "box", hp: 1 }, size);
    return pieceSprite({ t: goal.type }, size);
  }

  // 目標アイコン（HUD・ポップアップ）
  function goalIcon(goal, count) {
    const el = document.createElement("div");
    el.className = "pb-goal";
    const c = document.createElement("canvas");
    const px = Math.round(52 * DPR());
    c.width = c.height = px;
    c.getContext("2d").drawImage(goalSprite(goal, 52), 0, 0, px, px);
    const b = document.createElement("b");
    b.textContent = count;
    el.append(c, b);
    return el;
  }

  // =========================================================
  // 画面切りかえ・ポップアップ
  // =========================================================

  const wipe = $("pb-wipe");
  function transition(fn) {
    Sound.whoosh();
    wipe.classList.remove("out");
    wipe.classList.add("in");
    setTimeout(() => {
      fn();
      wipe.classList.remove("in");
      wipe.classList.add("out");
      setTimeout(() => wipe.classList.remove("out"), 340);
    }, 330);
  }
  function setScreen(s) {
    app.dataset.screen = s;
    if (s === "game") resize();
  }
  function showModal(id) {
    for (const m of document.querySelectorAll(".pb-modal")) m.classList.remove("show");
    if (id) $(id).classList.add("show");
  }

  // 音のオン・オフ（マップと一時停止の2か所）
  function syncSoundButtons() {
    for (const b of document.querySelectorAll(".pb-sound-btn")) {
      b.textContent = b.classList.contains("pb-icon-btn") ? (save.sound ? "🔊" : "🔇") : `${save.sound ? "🔊" : "🔇"} 音：${save.sound ? "オン" : "オフ"}`;
    }
  }
  for (const b of document.querySelectorAll(".pb-sound-btn")) {
    b.addEventListener("click", () => {
      Sound.unlock();
      save.sound = !save.sound;
      writeSave();
      syncSoundButtons();
      Sound.click();
    });
  }
  syncSoundButtons();

  // =========================================================
  // マップ（ステージ選択）
  // =========================================================

  function totalStars() {
    return Object.values(save.stars).reduce((n, s) => n + s, 0);
  }

  function buildMap() {
    const path = $("pb-path");
    for (const n of path.querySelectorAll(".pb-node")) n.remove();
    const W = Math.min(path.clientWidth || 340, 460);
    const gap = 112;
    const H = LEVELS.length * gap + 90;
    path.style.height = H + "px";
    const pts = [];
    // 下から上へ、くねくね進む道
    LEVELS.forEach((L, i) => {
      const x = W / 2 + Math.sin(i * 1.15) * (W * 0.28);
      const y = H - 70 - i * gap;
      pts.push([x, y]);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pb-node";
      btn.style.left = x + "px";
      btn.style.top = y + "px";
      const locked = L.id > save.unlocked;
      const stars = save.stars[L.id] || 0;
      if (locked) {
        btn.classList.add("locked");
        btn.innerHTML = `<span class="pb-node-lock">🔒</span>`;
        btn.setAttribute("aria-label", `ステージ ${L.id}（まだ遊べない）`);
      } else {
        btn.textContent = L.id;
        if (stars) btn.classList.add("done");
        if (L.id === save.unlocked && !stars) btn.classList.add("current");
        btn.setAttribute("aria-label", `ステージ ${L.id}（星 ${stars}）`);
        const st = document.createElement("span");
        st.className = "pb-node-stars";
        st.innerHTML = [1, 2, 3].map((k) => `<i class="${k <= stars ? "on" : ""}">★</i>`).join("");
        btn.appendChild(st);
      }
      btn.addEventListener("click", () => {
        Sound.unlock();
        if (locked) {
          Sound.invalid();
          btn.animate([{ transform: "translateX(-5px)" }, { transform: "translateX(5px)" }, { transform: "translateX(0)" }], { duration: 220 });
          return;
        }
        Sound.click();
        openStart(L.id);
      });
      path.appendChild(btn);
    });
    // 点線の道
    const svg = $("pb-path-line");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    let d = `M ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      d += ` C ${x0} ${(y0 + y1) / 2}, ${x1} ${(y0 + y1) / 2}, ${x1} ${y1}`;
    }
    svg.innerHTML = `<path d="${d}" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="16" stroke-linecap="round"/><path d="${d}" fill="none" stroke="#fff" stroke-width="5" stroke-dasharray="2 14" stroke-linecap="round"/>`;
    $("pb-total").textContent = `★ ${totalStars()} / ${LEVELS.length * 3}`;
    // いま遊ぶステージが見えるようにスクロール
    const cur = Math.min(save.unlocked, LEVELS.length) - 1;
    const sc = $("pb-path-scroll");
    sc.scrollTop = Math.max(0, pts[cur][1] - sc.clientHeight * 0.6);
  }

  // =========================================================
  // ステージ開始のポップアップ
  // =========================================================

  let pendingLevel = 1;
  function openStart(id) {
    const L = LEVELS[id - 1];
    pendingLevel = id;
    $("pb-start-title").textContent = `ステージ ${id}`;
    const list = $("pb-start-goals");
    list.innerHTML = "";
    for (const g of L.goals) list.appendChild(goalIcon(g, g.count));
    $("pb-start-moves").textContent = L.moves;
    $("pb-start-tip").textContent = L.tip || "";
    const s = save.stars[id] || 0;
    $("pb-start-stars").innerHTML = [1, 2, 3].map((k) => `<span class="${k <= s ? "on" : ""}">★</span>`).join("");
    showModal("pb-start");
    setTimeout(() => $("pb-start-go").focus({ preventScroll: true }), 60);
  }
  $("pb-start-go").addEventListener("click", () => {
    Sound.unlock();
    Sound.click();
    showModal(null);
    transition(() => startLevel(pendingLevel));
  });
  for (const b of document.querySelectorAll("[data-close]")) {
    b.addEventListener("click", () => {
      Sound.click();
      showModal(null);
    });
  }

  // =========================================================
  // ゲームの状態
  // =========================================================

  let game = null;
  let level = null;
  let sprites = new Map(); // id → 表示中の駒
  let particles = [];
  let fx = []; // ロケットの軌跡・ボムの輪・レインボーの稲妻など（盤面 canvas）
  let floaters = []; // 点数・ほめ言葉・バナー（演出 canvas）
  let flyers = []; // 目標アイコンへ飛ぶぽよ（演出 canvas）
  let confetti = [];
  let timeline = []; // これから起きる出来事（時刻つき）
  let phase = "idle"; // idle / play / resolve / settle / finale / end
  let clock = 0; // ゲーム内の時計（秒）。演出の早送りでは速く進む
  let timeScale = 1;
  let shake = 0;
  let lastInput = 0;
  let hintCells = null;
  let tutorial = null; // { r, c, text }
  let goalShown = [];
  let displayScore = 0;
  let continued = false;
  let attempt = 0;
  let movesShown = 0;
  let lastFlashAt = -10;

  // 盤面の大きさ（CSS px）
  const view = { W: 0, H: 0, cell: 40, x: 0, y: 0, bw: 0, bh: 0 };
  let boardBg = null;
  let boardClip = null;

  function resize() {
    const wrap = $("pb-board-wrap");
    const r = wrap.getBoundingClientRect();
    const dpr = DPR();
    view.W = r.width;
    view.H = r.height;
    boardCanvas.width = Math.round(r.width * dpr);
    boardCanvas.height = Math.round(r.height * dpr);
    fxCanvas.width = Math.round(window.innerWidth * dpr);
    fxCanvas.height = Math.round(window.innerHeight * dpr);
    if (!level) return;
    const cell = Math.floor(Math.min((r.width - 14) / level.cols, (r.height - 10) / level.rows, 68));
    view.cell = cell;
    view.bw = cell * level.cols;
    view.bh = cell * level.rows;
    view.x = Math.round((r.width - view.bw) / 2);
    view.y = Math.round(Math.max(4, (r.height - view.bh) / 2 - 6));
    if (spriteSize !== cell) {
      spriteCache.clear();
      spriteSize = cell;
    }
    buildBoardBg();
  }
  window.addEventListener("resize", () => {
    if (app.dataset.screen === "game") resize();
    else if (app.dataset.screen === "map") buildMap();
  });

  // 盤面の背景（マスの形）を1回だけ描く。ぽよは、盤面のマスの中だけに見えるようにする（上から落ちてくる途中は隠れる）
  function buildBoardBg() {
    const dpr = DPR();
    const c = document.createElement("canvas");
    c.width = Math.round((view.bw + 24) * dpr);
    c.height = Math.round((view.bh + 24) * dpr);
    const g = c.getContext("2d");
    g.scale(dpr, dpr);
    g.translate(12, 12);
    const s = view.cell;
    const valid = (r, cc) => game && game.inside(r, cc);
    // 盤面の形：マスごとの角丸＋となりのマスとのすき間を埋める四角（外周がギザギザにならない）
    const shape = (ctx, pad, rad) => {
      for (let r = 0; r < level.rows; r++) for (let cc = 0; cc < level.cols; cc++) {
        if (!valid(r, cc)) continue;
        rr(ctx, cc * s - pad, r * s - pad, s + pad * 2, s + pad * 2, rad);
        ctx.fill();
        if (valid(r, cc + 1)) ctx.fillRect(cc * s + s - rad - pad, r * s - pad, (rad + pad) * 2, s + pad * 2);
        if (valid(r + 1, cc)) ctx.fillRect(cc * s - pad, r * s + s - rad - pad, s + pad * 2, (rad + pad) * 2);
      }
    };
    // ふち：いったん不透明で描いてから、半透明で重ねる（重なりで濃くならない）
    const rim = document.createElement("canvas");
    rim.width = c.width;
    rim.height = c.height;
    const rg = rim.getContext("2d");
    rg.scale(dpr, dpr);
    rg.translate(12, 12);
    rg.fillStyle = "#30187a";
    shape(rg, 6, 12);
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 0.45;
    g.drawImage(rim, 0, 0);
    g.restore();
    g.fillStyle = "rgba(255,255,255,0.95)";
    shape(g, 2, 9);
    for (let r = 0; r < level.rows; r++) for (let cc = 0; cc < level.cols; cc++) {
      if (!valid(r, cc)) continue;
      g.fillStyle = (r + cc) % 2 ? "#e9e4ff" : "#f6f2ff";
      rr(g, cc * s + 1, r * s + 1, s - 2, s - 2, 6);
      g.fill();
    }
    boardBg = c;
    boardClip = new Path2D();
    for (let r = 0; r < level.rows; r++) for (let cc = 0; cc < level.cols; cc++) {
      if (valid(r, cc)) boardClip.rect(cc * s, r * s, s, s);
    }
  }

  // マスの中心（盤面 canvas の座標）と、画面全体での座標
  const cellX = (c) => view.x + (c + 0.5) * view.cell;
  const cellY = (r) => view.y + (r + 0.5) * view.cell;
  function toScreen(x, y) {
    const r = boardCanvas.getBoundingClientRect();
    return [r.left + x, r.top + y];
  }

  // 表示する駒を作る
  function makeSprite(p, r, c, extra = {}) {
    const s = { id: p.id, p, x: c, y: r, ty: r, vy: 0, state: "idle", t0: 0, scale: 1, alpha: 1, squash: 0, hp: p.hp, rot: 0, blinkAt: clock + 2 + Math.random() * 6, ...extra };
    sprites.set(p.id, s);
    return s;
  }

  // =========================================================
  // ステージ開始
  // =========================================================

  function startLevel(id) {
    level = LEVELS[id - 1];
    attempt++;
    game = new PB.Game(level, (Date.now() & 0xffff) * 31 + attempt);
    sprites = new Map();
    particles = [];
    fx = [];
    floaters = [];
    flyers = [];
    confetti = [];
    timeline = [];
    continued = false;
    displayScore = 0;
    timeScale = 1;
    hintCells = null;
    tutorial = null;
    setScreen("game");
    showModal(null);
    $("pb-level-label").textContent = `ステージ ${id}`;
    // 目標の表示
    goalShown = game.goals.map((g) => g.count);
    const goals = $("pb-goals");
    goals.innerHTML = "";
    game.goals.forEach((g, i) => {
      const el = goalIcon(g, g.count);
      el.dataset.i = i;
      goals.appendChild(el);
    });
    setMoves(game.moves, false);
    updateScoreUi(true);
    resize();
    // 最初の盤面は、上から順に降ってくる
    game.each((p, r, c) => {
      if (!p) return;
      const s = makeSprite(p, r, c);
      if (!PB.isStatic(p)) {
        s.y = r - level.rows - 1.5 - Math.random() * 0.6;
        s.state = "fall";
        s.delay = clock + 0.25 + (level.rows - r) * 0.04 + c * 0.012;
      } else {
        s.scale = 0;
        s.state = "grow";
        s.t0 = clock + 0.3 + Math.random() * 0.2;
      }
    });
    phase = "settle";
    lastInput = clock;
    // ひとこと（ステージ1は指でお手本を見せる）
    setTimeout(() => {
      if (level.tutorial) {
        const best = game.options().filter((o) => o.kind === "group" && o.color === 0).sort((a, b) => b.size - a.size)[0];
        if (best) tutorial = { r: best.r, c: best.c, text: level.tip };
      } else if (level.tip) {
        banner(level.tip, 2.6, "tip");
      }
    }, 900);
  }

  function setMoves(n, bump = true) {
    movesShown = n;
    $("pb-moves").textContent = n;
    const box = $("pb-moves").parentElement;
    box.classList.toggle("low", n <= 5 && phase !== "finale");
    if (bump) {
      box.classList.remove("bump");
      void box.offsetWidth;
      box.classList.add("bump");
    }
  }

  function updateScoreUi(force) {
    const [s2, s3] = level.stars;
    const max = s3 * 1.05;
    const pos1 = 0.28;
    $("pb-scorefill").style.width = `calc(${Math.min(1, displayScore / max) * 100}% - 4px)`;
    const marks = [pos1, s2 / max, s3 / max];
    ["pb-star1", "pb-star2", "pb-star3"].forEach((id, i) => {
      const el = $(id);
      if (force) el.style.left = marks[i] * 100 + "%";
      const on = displayScore >= marks[i] * max;
      if (on !== el.classList.contains("on")) el.classList.toggle("on", on);
    });
    $("pb-score").textContent = Math.round(displayScore).toLocaleString();
  }

  // =========================================================
  // 入力
  // =========================================================

  boardCanvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    Sound.unlock();
    if (phase === "finale") {
      timeScale = 4; // 演出の早送り
      return;
    }
    if (phase !== "play") return;
    const r = boardCanvas.getBoundingClientRect();
    const x = e.clientX - r.left - view.x;
    const y = e.clientY - r.top - view.y;
    const c = Math.floor(x / view.cell);
    const rr2 = Math.floor(y / view.cell);
    if (!game.inside(rr2, c)) return;
    const p = game.at(rr2, c);
    if (!p) return;
    lastInput = clock;
    hintCells = null;
    const res = game.tap(rr2, c);
    if (!res) {
      // 消せない：ぷるっと震えて、低い音
      const s = sprites.get(p.id);
      if (s) {
        s.wobble = clock;
      }
      Sound.invalid();
      return;
    }
    tutorial = null;
    setMoves(game.moves);
    play(res, rr2, c);
  });

  // =========================================================
  // 出来事の再生
  // =========================================================

  function play(res, tr, tc) {
    phase = "resolve";
    const start = clock;
    for (const e of res.events) timeline.push({ at: start + e.t, e });
    timeline.sort((a, b) => a.at - b.at);
    // 最初の手ごたえ（タップした瞬間）
    if (res.kind === "group") {
      Sound.pop(res.size);
      buzz(8);
      if (res.created) setTimeout(() => Sound.create(), 160);
    } else if (res.kind === "combo") {
      Sound.combo();
      buzz(30);
      shake = Math.max(shake, 10);
      banner(comboName(res.combo), 1.1, "combo");
    }
    const gainAt = [cellX(tc), cellY(tr)];
    floaters.push({ kind: "score", text: "+" + res.gain, x: gainAt[0], y: gainAt[1], t0: clock + 0.1, dur: 0.9, board: true });
    // たくさん消したら、ほめる
    const n = res.popped;
    const praise = n >= 50 ? "ミラクル！" : n >= 32 ? "スーパー！" : n >= 20 ? "すごい！" : n >= 12 ? "いいね！" : null;
    if (praise) setTimeout(() => banner(praise, 1.0, "praise"), 260);
    resolveEnd = start + res.duration + 0.28;
  }
  let resolveEnd = 0;

  function comboName(c) {
    return { "rocket+rocket": "クロス！", "rocket+bomb": "メガロケット！", "bomb+bomb": "ビッグボム！", "disco+rocket": "レインボー×ロケット！", "disco+bomb": "レインボー×ボム！", "disco+disco": "ぜんぶ消し！" }[c] || "コンボ！";
  }

  function runTimeline() {
    while (timeline.length && timeline[0].at <= clock) {
      const { e } = timeline.shift();
      applyEvent(e);
    }
  }

  function applyEvent(e) {
    const s = sprites.get(e.id);
    switch (e.type) {
      case "pop": {
        if (!s) break;
        if (e.merge) {
          s.state = "merge";
          s.t0 = clock;
          s.mx = e.merge[1];
          s.my = e.merge[0];
        } else {
          s.state = "pop";
          s.t0 = clock;
          burst(e.c, e.r, e.piece);
          if (e.by !== "group") Sound.smallPop();
        }
        if (e.goal) {
          const gi = game.goals.indexOf(e.goal);
          if (gi >= 0) flyTo(gi, e.r, e.c, e.piece);
        }
        if (e.piece.t === "box" || e.piece.t === "stone") debris(e.c, e.r, e.piece.t, 10);
        break;
      }
      case "hit":
        if (s) {
          s.hp = e.piece.hp;
          s.wobble = clock;
          s.flash = clock;
        }
        debris(e.c, e.r, e.piece.t, 5);
        Sound.tone(220, 0.08, { type: "square", vol: 0.05 });
        break;
      case "spawn": {
        const ns = makeSprite(e.piece, e.r, e.c, { state: "grow", t0: clock, scale: 0 });
        ring(e.c, e.r, "#fff", 0.35, 1.1);
        sparkles(e.c, e.r, 12);
        if (!save.seenBooster && phase !== "finale") {
          save.seenBooster = true;
          writeSave();
          setTimeout(() => {
            if (phase === "play" && game.at(e.r, e.c) === e.piece) tutorial = { r: e.r, c: e.c, text: "ブースターをタップして発動！" };
          }, 700);
        }
        void ns;
        break;
      }
      case "transform": {
        if (s) sprites.delete(e.id);
        makeSprite(e.piece, e.r, e.c, { state: "grow", t0: clock, scale: 0.3 });
        sparkles(e.c, e.r, 5);
        Sound.tone(1200 + Math.random() * 400, 0.06, { vol: 0.05 });
        break;
      }
      case "goal": {
        const gi = game.goals.indexOf(e.goal);
        if (gi >= 0) flyTo(gi, e.r, e.c, e.piece);
        break;
      }
      case "fx":
        if (e.fx === "rocket") {
          fx.push({ kind: "rocket", r: e.r, c: e.c, dir: e.dir, t0: clock, big: !!e.big });
          Sound.rocket();
          shake = Math.max(shake, e.big ? 8 : 4);
          buzz(12);
        } else if (e.fx === "bomb") {
          fx.push({ kind: "bomb", r: e.r, c: e.c, radius: e.radius, t0: clock, big: !!e.big });
          Sound.bomb(e.big);
          shake = Math.max(shake, e.big ? 16 : 9);
          if (e.big) flash();
          buzz(e.big ? 40 : 20);
        } else if (e.fx === "disco") {
          fx.push({ kind: "disco", r: e.r, c: e.c, color: e.color, targets: e.targets, t0: clock });
          Sound.disco();
          flash();
          shake = Math.max(shake, 6);
        }
        break;
      case "combo":
        ring(e.c, e.r, "#ffe36b", 0.6, 3.5);
        break;
    }
  }

  // ---- 粒（消えるときのはじけ・木くず・きらきら） ----
  const MAX_PARTICLES = 320;
  function addParticle(p) {
    if (particles.length >= MAX_PARTICLES) particles.shift();
    particles.push(p);
  }
  function burst(c, r, piece) {
    const x = cellX(c);
    const y = cellY(r);
    const col = piece.t === "c" ? COLORS[piece.color].base : piece.t === "balloon" ? "#ff8cc6" : piece.t === "gift" ? "#ae73ff" : "#ffe36b";
    const light = piece.t === "c" ? COLORS[piece.color].light : "#ffffff";
    const n = 7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
      const sp = view.cell * (2.2 + Math.random() * 2.5);
      addParticle({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - view.cell, life: 0, max: 0.45 + Math.random() * 0.25, size: view.cell * (0.09 + Math.random() * 0.08), color: i % 3 ? col : light, kind: "dot", g: view.cell * 9 });
    }
    addParticle({ x, y, life: 0, max: 0.28, size: view.cell * 0.45, color: light, kind: "ring" });
  }
  function debris(c, r, t, n) {
    const x = cellX(c);
    const y = cellY(r);
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const sp = view.cell * (2 + Math.random() * 3);
      addParticle({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 0.6, size: view.cell * (0.08 + Math.random() * 0.1), color: t === "box" ? (i % 2 ? "#c98443" : "#f0b876") : i % 2 ? "#7c859c" : "#c7cede", kind: "chip", rot: Math.random() * 6, vr: (Math.random() - 0.5) * 20, g: view.cell * 14 });
    }
  }
  function sparkles(c, r, n) {
    const x = cellX(c);
    const y = cellY(r);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = view.cell * (1 + Math.random() * 2);
      addParticle({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 0.5 + Math.random() * 0.3, size: view.cell * (0.1 + Math.random() * 0.08), color: ["#fff", "#ffe36b", "#ffd2ec"][i % 3], kind: "star", g: 0 });
    }
  }
  function ring(c, r, color, dur, size) {
    addParticle({ x: cellX(c), y: cellY(r), life: 0, max: dur, size: view.cell * size, color, kind: "ring" });
  }
  function flash() {
    lastFlashAt = clock;
  }

  // ---- 目標アイコンへ飛ぶ ----
  function flyTo(gi, r, c, piece) {
    const el = $("pb-goals").children[gi];
    if (!el) return;
    const [sx, sy] = toScreen(cellX(c), cellY(r));
    const b = el.querySelector("canvas").getBoundingClientRect();
    flyers.push({ gi, x0: sx, y0: sy, x1: b.left + b.width / 2, y1: b.top + b.height / 2, t0: clock + 0.05 + Math.random() * 0.08, dur: 0.5 + Math.random() * 0.15, piece: { ...piece } });
  }
  function arriveGoal(gi) {
    goalShown[gi] = Math.max(0, goalShown[gi] - 1);
    const el = $("pb-goals").children[gi];
    if (!el) return;
    el.querySelector("b").textContent = goalShown[gi];
    el.classList.remove("hit");
    void el.offsetWidth;
    el.classList.add("hit");
    if (goalShown[gi] === 0 && !el.classList.contains("done")) {
      el.classList.add("done");
      Sound.create();
    } else Sound.goal();
  }

  // ---- 文字の演出（ほめ言葉・バナー） ----
  function banner(text, dur, kind) {
    floaters.push({ kind, text, t0: clock, dur });
  }

  // =========================================================
  // 落下・終わりの判定
  // =========================================================

  function startSettle() {
    const col = game.collapse();
    for (const m of col.moves) {
      const s = sprites.get(m.id);
      if (!s) continue;
      s.ty = m.tr;
      s.state = "fall";
      s.vy = 0;
      s.delay = clock + (level.rows - m.tr) * 0.012;
    }
    // 新しいぽよは、その列の盤面のいちばん上の、さらに上から
    const top = [];
    for (let c = 0; c < level.cols; c++) {
      let t = 0;
      while (t < level.rows && !game.inside(t, c)) t++;
      top.push(t);
    }
    for (const sp of col.spawns) {
      const s = makeSprite(sp.piece, sp.tr, sp.tc);
      s.y = top[sp.tc] + sp.from - 0.2;
      s.state = "fall";
      s.vy = 2;
      s.delay = clock + (level.rows - sp.tr) * 0.012;
    }
    for (const g of col.collected) {
      const s = sprites.get(g.id);
      if (s) s.collect = g.goal ? game.goals.indexOf(g.goal) : -1;
      else if (g.goal) flyTo(game.goals.indexOf(g.goal), g.r, g.c, g.piece);
    }
    phase = "settle";
  }

  function allLanded() {
    for (const s of sprites.values()) if (s.state === "fall" || s.state === "pop" || s.state === "merge" || s.state === "collect") return false;
    return true;
  }

  // 落ち終わったら：クリア？ 手数切れ？ 消せる所がない？
  function afterSettle() {
    if (game.goalsDone()) {
      startFinale();
      return;
    }
    if (game.moves <= 0) {
      phase = "end";
      setTimeout(showLose, 650);
      return;
    }
    if (!game.hasMoves()) {
      // 並べかえ
      banner("シャッフル！", 1.0, "praise");
      game.shuffle();
      for (const s of sprites.values()) if (s.p.t === "c") {
        s.state = "spin";
        s.t0 = clock;
      }
      Sound.whoosh();
      phase = "settle";
      return;
    }
    phase = "play";
  }

  // =========================================================
  // クリア：残り手数がブースターになって、全部発動
  // =========================================================

  let finaleStep = 0;
  function startFinale() {
    phase = "finale";
    finaleStep = 0;
    tutorial = null;
    hintCells = null;
    banner("ステージクリア！", 1.4, "clear");
    Sound.win();
    for (let i = 0; i < 70; i++) addConfetti();
    $("pb-moves").parentElement.classList.remove("low");
    finaleTimer = clock + 1.3;
    if (game.moves > 0) setTimeout(() => phase === "finale" && banner("ボーナスタイム！", 1.0, "praise"), 1100);
  }
  let finaleTimer = 0;

  function finaleTick() {
    if (clock < finaleTimer) return;
    if (timeline.length || !allLanded()) return;
    // 1) 残り手数をひとつずつブースターに
    if (game.moves > 0) {
      const f = game.finaleConvert();
      if (f) {
        const s = sprites.get(f.from.id);
        if (s) sprites.delete(f.from.id);
        makeSprite(f.piece, f.r, f.c, { state: "grow", t0: clock, scale: 0 });
        sparkles(f.c, f.r, 8);
        Sound.tone(880 + (finaleStep % 8) * 110, 0.1, { type: "triangle", vol: 0.1 });
        finaleStep++;
        setMoves(game.moves);
        finaleTimer = clock + 0.12;
        return;
      }
      game.moves = 0;
      setMoves(0, false);
    }
    // 2) 盤面のブースターを順に発動
    const list = game.boosterCells();
    if (list.length && finaleStep < 200) {
      const [r, c] = list[0];
      const res = game.tap(r, c, { free: true });
      finaleStep++;
      if (res) {
        const start = clock;
        for (const e of res.events) timeline.push({ at: start + e.t, e });
        timeline.sort((a, b) => a.at - b.at);
        finaleTimer = start + res.duration + 0.15;
        finaleNeedsSettle = true;
      }
      return;
    }
    // 3) おしまい
    phase = "end";
    setTimeout(showWin, 500);
  }
  let finaleNeedsSettle = false;

  // =========================================================
  // クリア／手数切れのポップアップ
  // =========================================================

  function showWin() {
    displayScore = game.score;
    updateScoreUi();
    const stars = game.stars();
    const id = level.id;
    const prevBest = save.best[id] || 0;
    const newBest = game.score > prevBest;
    save.stars[id] = Math.max(save.stars[id] || 0, stars);
    if (newBest) save.best[id] = game.score;
    save.unlocked = Math.max(save.unlocked, Math.min(LEVELS.length, id + 1));
    writeSave();
    const starEls = $("pb-win-stars").querySelectorAll(".pb-star");
    starEls.forEach((el) => el.classList.remove("on"));
    $("pb-win-score").textContent = "0";
    $("pb-win-best").textContent = "";
    $("pb-win-next").textContent = id < LEVELS.length ? "つぎへ ▶" : "マップへ ▶";
    showModal("pb-win");
    // 星をひとつずつ
    for (let i = 0; i < stars; i++) {
      setTimeout(() => {
        starEls[i].classList.add("on");
        Sound.star(i);
        buzz(15);
        const b = starEls[i].getBoundingClientRect();
        for (let k = 0; k < 14; k++) addConfetti(b.left + b.width / 2, b.top + b.height / 2, true);
      }, 450 + i * 420);
    }
    // 点数を数え上げ
    const t0 = performance.now();
    const target = game.score;
    const count = () => {
      const k = Math.min(1, (performance.now() - t0) / 900);
      $("pb-win-score").textContent = Math.round(target * (1 - Math.pow(1 - k, 3))).toLocaleString();
      if (k < 1) requestAnimationFrame(count);
      else if (newBest && prevBest) $("pb-win-best").textContent = "ハイスコア更新！";
    };
    requestAnimationFrame(count);
    setTimeout(() => $("pb-win-next").focus({ preventScroll: true }), 80);
  }

  function showLose() {
    Sound.lose();
    const list = $("pb-lose-goals");
    list.innerHTML = "";
    for (const g of game.goals) if (g.left > 0) list.appendChild(goalIcon(g, g.left));
    $("pb-lose-continue").disabled = continued;
    $("pb-lose-continue").hidden = continued;
    showModal("pb-lose");
    setTimeout(() => $("pb-lose-retry").focus({ preventScroll: true }), 80);
  }

  $("pb-win-next").addEventListener("click", () => {
    Sound.click();
    showModal(null);
    const next = level.id + 1;
    if (next <= LEVELS.length) {
      transition(() => {
        setScreen("map");
        buildMap();
        openStart(next);
      });
    } else transition(goMap);
  });
  $("pb-win-retry").addEventListener("click", () => {
    Sound.click();
    showModal(null);
    transition(() => startLevel(level.id));
  });
  $("pb-win-map").addEventListener("click", () => {
    Sound.click();
    showModal(null);
    transition(goMap);
  });
  $("pb-lose-retry").addEventListener("click", () => {
    Sound.click();
    showModal(null);
    transition(() => startLevel(level.id));
  });
  $("pb-lose-map").addEventListener("click", () => {
    Sound.click();
    showModal(null);
    transition(goMap);
  });
  $("pb-lose-continue").addEventListener("click", () => {
    if (continued) return;
    continued = true;
    Sound.create();
    game.moves += 5;
    setMoves(game.moves);
    showModal(null);
    banner("＋5手！", 1.0, "praise");
    phase = "play";
  });
  $("pb-pause").addEventListener("click", () => {
    Sound.unlock();
    Sound.click();
    if (phase === "end") return;
    showModal("pb-pausemenu");
  });
  $("pb-resume").addEventListener("click", () => {
    Sound.click();
    showModal(null);
  });
  $("pb-restart").addEventListener("click", () => {
    Sound.click();
    showModal(null);
    transition(() => startLevel(level.id));
  });
  $("pb-tomap").addEventListener("click", () => {
    Sound.click();
    showModal(null);
    transition(goMap);
  });

  function goMap() {
    phase = "idle";
    setScreen("map");
    buildMap();
  }

  // =========================================================
  // 紙ふぶき
  // =========================================================

  function addConfetti(x, y, burstMode) {
    const W = window.innerWidth;
    const cols = ["#ff5a72", "#ffc93d", "#3fa6ff", "#4cd47f", "#ae73ff", "#ffffff"];
    confetti.push(
      burstMode
        ? { x, y, vx: (Math.random() - 0.5) * 520, vy: -200 - Math.random() * 300, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14, w: 6 + Math.random() * 6, h: 4 + Math.random() * 4, c: cols[Math.floor(Math.random() * cols.length)], life: 0, max: 1.4 }
        : { x: Math.random() * W, y: -20 - Math.random() * 200, vx: (Math.random() - 0.5) * 80, vy: 80 + Math.random() * 160, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 10, w: 7 + Math.random() * 6, h: 4 + Math.random() * 5, c: cols[Math.floor(Math.random() * cols.length)], life: 0, max: 3.2 }
    );
  }

  // =========================================================
  // 毎フレーム
  // =========================================================

  let lastT = performance.now();
  function frame(t) {
    const real = Math.min(0.05, (t - lastT) / 1000);
    lastT = t;
    const dt = real * timeScale;
    if (app.dataset.screen === "game" && game) {
      clock += dt;
      step(dt);
      drawBoard();
    }
    drawFx(real);
    requestAnimationFrame(frame);
  }

  function step(dt) {
    runTimeline();
    // 駒の動き
    for (const s of sprites.values()) {
      if (s.state === "fall") {
        if (s.delay && clock < s.delay) continue;
        s.vy = Math.min(s.vy + 70 * dt, 22);
        s.y += s.vy * dt;
        if (s.y >= s.ty) {
          s.y = s.ty;
          s.squash = Math.min(1, s.vy / 12);
          s.vy = 0;
          s.state = "idle";
          if (s.collect !== undefined) {
            s.state = "collect";
            s.t0 = clock;
          }
        }
      } else if (s.state === "merge") {
        const k = Math.min(1, (clock - s.t0) / 0.18);
        s.x += (s.mx - s.x) * Math.min(1, dt * 18);
        s.y += (s.my - s.y) * Math.min(1, dt * 18);
        s.scale = 1 - 0.4 * k;
        if (k >= 1) sprites.delete(s.id);
      } else if (s.state === "pop") {
        if (clock - s.t0 >= 0.22) sprites.delete(s.id);
      } else if (s.state === "grow") {
        const k = (clock - s.t0) / 0.32;
        if (k < 0) continue;
        s.scale = k >= 1 ? 1 : k < 0.6 ? (k / 0.6) * 1.2 : 1.2 - 0.2 * ((k - 0.6) / 0.4);
        if (k >= 1) {
          s.scale = 1;
          s.state = "idle";
        }
      } else if (s.state === "spin") {
        const k = (clock - s.t0) / 0.6;
        s.rot = k * Math.PI * 2;
        s.scale = 1 - Math.sin(Math.min(1, k) * Math.PI) * 0.4;
        if (k >= 1) {
          s.rot = 0;
          s.scale = 1;
          s.state = "idle";
        }
      } else if (s.state === "collect") {
        if (clock - s.t0 > 0.15) {
          if (s.collect >= 0) flyTo(s.collect, Math.round(s.y), Math.round(s.x), s.p);
          sparkles(Math.round(s.x), Math.round(s.y), 10);
          Sound.create();
          sprites.delete(s.id);
        }
      }
      if (s.squash > 0) s.squash = Math.max(0, s.squash - dt * 5);
    }
    // 段階の切りかえ
    if (phase === "resolve" && clock >= resolveEnd && !timeline.length) startSettle();
    else if (phase === "settle" && !timeline.length && allLanded()) afterSettle();
    else if (phase === "finale") {
      if (finaleNeedsSettle && !timeline.length && clock >= finaleTimer) {
        finaleNeedsSettle = false;
        startSettleFinale();
      }
      finaleTick();
    }
    // 少し何もしないと、消せる所を教える
    if (phase === "play" && !tutorial && !hintCells && clock - lastInput > 5) {
      const best = game.options().sort((a, b) => (b.kind === "booster" ? 99 : b.size) - (a.kind === "booster" ? 99 : a.size))[0];
      if (best) hintCells = best.cells || [[best.r, best.c]];
    }
    // 粒
    for (const p of particles) {
      p.life += dt;
      if (p.vx !== undefined) {
        p.vy += (p.g || 0) * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.vr) p.rot += p.vr * dt;
      }
    }
    particles = particles.filter((p) => p.life < p.max);
    fx = fx.filter((f) => clock - f.t0 < (f.kind === "disco" ? 0.7 : f.kind === "bomb" ? 0.5 : 1.2));
    shake = Math.max(0, shake - dt * 40);
    // 点数の表示を本当の点数へ
    if (displayScore < game.score) {
      displayScore = Math.min(game.score, displayScore + Math.max(20, (game.score - displayScore) * dt * 6));
      updateScoreUi();
    }
  }

  function startSettleFinale() {
    const col = game.collapse();
    for (const m of col.moves) {
      const s = sprites.get(m.id);
      if (!s) continue;
      s.ty = m.tr;
      s.state = "fall";
      s.vy = 0;
      s.delay = clock;
    }
    const top = [];
    for (let c = 0; c < level.cols; c++) {
      let t = 0;
      while (t < level.rows && !game.inside(t, c)) t++;
      top.push(t);
    }
    for (const sp of col.spawns) {
      const s = makeSprite(sp.piece, sp.tr, sp.tc);
      s.y = top[sp.tc] + sp.from - 0.2;
      s.state = "fall";
      s.vy = 3;
    }
    for (const g of col.collected) {
      const s = sprites.get(g.id);
      if (s) sprites.delete(g.id);
    }
  }

  // =========================================================
  // 描画
  // =========================================================

  function drawBoard() {
    const dpr = DPR();
    const g = bctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, view.W, view.H);
    const sx = shake ? (Math.random() - 0.5) * shake : 0;
    const sy = shake ? (Math.random() - 0.5) * shake : 0;
    g.save();
    g.translate(sx, sy);
    if (boardBg) g.drawImage(boardBg, view.x - 12, view.y - 12, view.bw + 24, view.bh + 24);
    const cs = view.cell;
    // 駒（盤面のマスの中だけ）
    g.save();
    g.translate(view.x, view.y);
    g.clip(boardClip);
    const hint = hintCells ? new Set(hintCells.map(([r, c]) => r * 100 + c)) : null;
    const list = [...sprites.values()].sort((a, b) => a.y - b.y);
    for (const s of list) {
      if (s.state === "fall" && s.y < -1.2) continue;
      let scale = s.scale;
      let ox = 0;
      let oy = 0;
      let sxk = 1;
      let syk = 1;
      let rot = s.rot || 0;
      // 生きている感じ：ゆっくり呼吸・ときどきまばたき
      if (s.state === "idle" && s.p.t === "c") {
        const b = Math.sin(clock * 2.2 + s.id * 0.7) * 0.025;
        syk += b;
        sxk -= b * 0.6;
      }
      if (s.squash) {
        syk -= 0.22 * s.squash;
        sxk += 0.14 * s.squash;
        oy += 0.11 * s.squash;
      }
      if (s.wobble && clock - s.wobble < 0.35) {
        const k = clock - s.wobble;
        ox += Math.sin(k * 50) * 0.08 * (1 - k / 0.35);
      }
      if (hint && hint.has(Math.round(s.y) * 100 + Math.round(s.x)) && s.state === "idle") {
        const w = Math.sin(clock * 9) * 0.06;
        scale *= 1.06 + w;
        rot += Math.sin(clock * 9) * 0.06;
      }
      if (s.state === "pop") {
        const k = (clock - s.t0) / 0.22;
        scale = k < 0.35 ? 1 + 0.28 * (k / 0.35) : 1.28 * (1 - (k - 0.35) / 0.65);
        s.alpha = 1 - Math.max(0, (k - 0.5) * 2);
      }
      if (s.p.t === "disco") rot += clock * 1.5;
      const blink = s.p.t === "c" && clock > s.blinkAt && clock < s.blinkAt + 0.13;
      if (s.p.t === "c" && clock > s.blinkAt + 0.13) s.blinkAt = clock + 2 + Math.random() * 7;
      const img = pieceSprite(s.p, cs, { blink, hp: s.hp });
      if (!img) continue;
      const cx = (s.x + 0.5 + ox) * cs;
      const cy = (s.y + 0.5 + oy) * cs;
      g.save();
      g.globalAlpha = s.alpha;
      g.translate(cx, cy + (1 - syk) * cs * 0.5);
      if (rot) g.rotate(rot);
      g.scale(scale * sxk, scale * syk);
      g.drawImage(img, -cs / 2, -cs / 2, cs, cs);
      if (s.flash && clock - s.flash < 0.12) {
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = 0.5;
        g.drawImage(img, -cs / 2, -cs / 2, cs, cs);
      }
      g.restore();
      // ボムの導火線の火花
      if (s.p.t === "bomb" && s.state !== "pop") {
        g.save();
        g.fillStyle = Math.sin(clock * 30 + s.id) > 0 ? "#fff3a6" : "#ff9f43";
        g.translate(cx + cs * 0.18 * scale, cy - cs * 0.4 * scale);
        star(g, 0, 0, cs * 0.09, cs * 0.04);
        g.fill();
        g.restore();
      }
    }
    g.restore();
    // 演出（ロケット・ボム・レインボー）
    for (const f of fx) drawEffect(g, f);
    // 粒
    for (const p of particles) {
      const k = p.life / p.max;
      g.globalAlpha = Math.max(0, 1 - k);
      if (p.kind === "ring") {
        g.strokeStyle = p.color;
        g.lineWidth = Math.max(1, (1 - k) * view.cell * 0.12);
        g.beginPath();
        g.arc(p.x, p.y, p.size * (0.4 + k * 0.9), 0, Math.PI * 2);
        g.stroke();
      } else if (p.kind === "star") {
        g.fillStyle = p.color;
        star(g, p.x, p.y, p.size * (1 - k * 0.5), p.size * 0.4 * (1 - k * 0.5));
        g.fill();
      } else if (p.kind === "chip") {
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.rot);
        g.fillStyle = p.color;
        g.fillRect(-p.size, -p.size * 0.6, p.size * 2, p.size * 1.2);
        g.restore();
      } else {
        g.fillStyle = p.color;
        g.beginPath();
        g.arc(p.x, p.y, p.size * (1 - k * 0.6), 0, Math.PI * 2);
        g.fill();
      }
    }
    g.globalAlpha = 1;
    // 指のお手本（ステージ1・初めてのブースター）
    if (tutorial && phase === "play") drawTutorial(g);
    g.restore();
    // 画面がぱっと光る
    const fk = (clock - lastFlashAt) / 0.35;
    if (fk >= 0 && fk < 1) {
      g.fillStyle = `rgba(255,255,240,${0.45 * (1 - fk)})`;
      g.fillRect(0, 0, view.W, view.H);
    }
  }

  function drawEffect(g, f) {
    const cs = view.cell;
    const k = clock - f.t0;
    if (f.kind === "rocket") {
      // 2つのロケットが、左右（上下）へ飛んでいく
      const dist = k / 0.032; // マス
      const img = pieceSprite({ t: "rocket", dir: f.dir }, cs);
      for (const sgn of [-1, 1]) {
        const cx = cellX(f.c) + (f.dir === "h" ? sgn * dist * cs : 0);
        const cy = cellY(f.r) + (f.dir === "v" ? sgn * dist * cs : 0);
        // 軌跡
        const tx = cellX(f.c);
        const ty = cellY(f.r);
        const grad = g.createLinearGradient(tx, ty, cx, cy);
        grad.addColorStop(0, "rgba(255,240,180,0)");
        grad.addColorStop(1, f.big ? "rgba(255,200,80,0.9)" : "rgba(255,255,255,0.85)");
        g.strokeStyle = grad;
        g.lineWidth = cs * (f.big ? 0.5 : 0.3) * Math.max(0, 1 - k * 0.8);
        g.lineCap = "round";
        g.beginPath();
        g.moveTo(tx, ty);
        g.lineTo(cx, cy);
        g.stroke();
        if (Math.random() < 0.6) addParticle({ x: cx, y: cy, vx: (Math.random() - 0.5) * cs, vy: (Math.random() - 0.5) * cs, life: 0, max: 0.3, size: cs * 0.1, color: Math.random() < 0.5 ? "#ffe36b" : "#ff9f43", kind: "dot", g: 0 });
        g.save();
        g.translate(cx, cy);
        if (sgn < 0) g.rotate(Math.PI);
        g.drawImage(img, -cs * 0.6, -cs * 0.6, cs * 1.2, cs * 1.2);
        g.restore();
      }
    } else if (f.kind === "bomb") {
      const dur = 0.5;
      const t = Math.min(1, k / dur);
      const R = (f.radius + 0.6) * cs * (0.3 + 0.7 * Math.sqrt(t));
      const cx = cellX(f.c);
      const cy = cellY(f.r);
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, R);
      grad.addColorStop(0, `rgba(255,255,220,${0.9 * (1 - t)})`);
      grad.addColorStop(0.5, `rgba(255,190,80,${0.6 * (1 - t)})`);
      grad.addColorStop(1, "rgba(255,120,60,0)");
      g.fillStyle = grad;
      g.beginPath();
      g.arc(cx, cy, R, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = `rgba(255,255,255,${1 - t})`;
      g.lineWidth = cs * 0.15 * (1 - t);
      g.beginPath();
      g.arc(cx, cy, R * 1.05, 0, Math.PI * 2);
      g.stroke();
    } else if (f.kind === "disco") {
      // 稲妻：レインボーから、消える色のぽよへ
      const cx = cellX(f.c);
      const cy = cellY(f.r);
      const col = COLORS[f.color] ? COLORS[f.color].light : "#fff";
      g.lineCap = "round";
      f.targets.forEach(([r, c], i) => {
        const appear = 0.1 + i * 0.018;
        if (k < appear) return;
        const a = Math.max(0, 1 - (k - appear) / 0.35);
        if (a <= 0) return;
        const x1 = cellX(c);
        const y1 = cellY(r);
        g.strokeStyle = `rgba(255,255,255,${a})`;
        g.lineWidth = cs * 0.12;
        g.beginPath();
        g.moveTo(cx, cy);
        const n = 5;
        for (let j = 1; j < n; j++) {
          const t = j / n;
          g.lineTo(cx + (x1 - cx) * t + (Math.random() - 0.5) * cs * 0.4, cy + (y1 - cy) * t + (Math.random() - 0.5) * cs * 0.4);
        }
        g.lineTo(x1, y1);
        g.stroke();
        g.strokeStyle = col;
        g.globalAlpha = a;
        g.lineWidth = cs * 0.05;
        g.stroke();
        g.globalAlpha = 1;
      });
      g.fillStyle = `rgba(255,255,255,${Math.max(0, 0.7 - k)})`;
      g.beginPath();
      g.arc(cx, cy, cs * (0.6 + k * 2), 0, Math.PI * 2);
      g.fill();
    }
  }

  function drawTutorial(g) {
    const t = tutorial;
    const x = cellX(t.c);
    const y = cellY(t.r);
    const cs = view.cell;
    // 光る輪
    g.strokeStyle = `rgba(255,255,255,${0.6 + Math.sin(clock * 6) * 0.3})`;
    g.lineWidth = 4;
    g.beginPath();
    g.arc(x, y, cs * (0.62 + Math.sin(clock * 6) * 0.06), 0, Math.PI * 2);
    g.stroke();
    // 指
    const bob = Math.abs(Math.sin(clock * 4)) * cs * 0.25;
    g.font = `${Math.round(cs * 1.1)}px sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "top";
    g.fillText("👆", x + cs * 0.15, y + cs * 0.2 + bob);
    // 吹き出し
    const text = t.text;
    g.font = `900 ${Math.max(12, Math.round(cs * 0.34))}px ${getComputedStyle(document.body).fontFamily}`;
    const w = Math.min(view.W - 20, g.measureText(text).width + 28);
    const bx = Math.max(10, Math.min(view.W - w - 10, x - w / 2));
    const by = y - cs * 1.75 < 4 ? y + cs * 1.5 : y - cs * 1.75;
    g.fillStyle = "rgba(255,255,255,0.97)";
    rr(g, bx, by, w, cs * 0.8, cs * 0.3);
    g.fill();
    g.strokeStyle = "#5a3dbf";
    g.lineWidth = 3;
    g.stroke();
    g.fillStyle = "#2b2550";
    g.textBaseline = "middle";
    g.fillText(text, bx + w / 2, by + cs * 0.4, w - 16);
  }

  // 演出 canvas：目標アイコンへ飛ぶぽよ・点数・ほめ言葉・紙ふぶき
  function drawFx(dt) {
    const dpr = DPR();
    const g = fctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, window.innerWidth, window.innerHeight);
    const font = getComputedStyle(document.body).fontFamily;
    // 目標へ飛ぶ
    const size = Math.max(26, view.cell * 0.8);
    flyers = flyers.filter((f) => {
      const k = (clock - f.t0) / f.dur;
      if (k < 0) {
        const img = pieceSprite(f.piece, Math.round(size));
        if (img) g.drawImage(img, f.x0 - size / 2, f.y0 - size / 2, size, size);
        return true;
      }
      if (k >= 1) {
        arriveGoal(f.gi);
        return false;
      }
      const e = k * k * (3 - 2 * k);
      const mx = (f.x0 + f.x1) / 2 + (f.x0 < f.x1 ? -1 : 1) * 60;
      const my = Math.min(f.y0, f.y1) - 40;
      const x = (1 - e) * (1 - e) * f.x0 + 2 * (1 - e) * e * mx + e * e * f.x1;
      const y = (1 - e) * (1 - e) * f.y0 + 2 * (1 - e) * e * my + e * e * f.y1;
      const s = size * (1 - 0.3 * e);
      const img = pieceSprite(f.piece, Math.round(size));
      if (img) g.drawImage(img, x - s / 2, y - s / 2, s, s);
      return true;
    });
    // 点数・ほめ言葉・バナー
    const br = boardCanvas.getBoundingClientRect();
    floaters = floaters.filter((f) => {
      const k = (clock - f.t0) / f.dur;
      if (k < 0) return true;
      if (k >= 1) return false;
      g.save();
      g.textAlign = "center";
      g.textBaseline = "middle";
      if (f.kind === "score") {
        const x = br.left + f.x;
        const y = br.top + f.y - k * 50;
        g.globalAlpha = 1 - k * k;
        g.font = `900 ${Math.round(18 + Math.min(8, view.cell * 0.12))}px ${font}`;
        g.lineWidth = 5;
        g.strokeStyle = "#5a3dbf";
        g.strokeText(f.text, x, y);
        g.fillStyle = "#fff";
        g.fillText(f.text, x, y);
      } else {
        const cx = br.left + br.width / 2;
        let cy = br.top + br.height * 0.42;
        if (f.kind === "tip") {
          // ひとことは盤面の上のすき間に。すき間が足りなければ下、それもなければ盤面の上端
          const top = br.top + view.y, bottom = top + view.bh;
          const hudBottom = document.querySelector(".pb-scorebar").getBoundingClientRect().bottom;
          if (top - hudBottom >= 54) cy = (hudBottom + top) / 2;
          else if (window.innerHeight - bottom >= 70) cy = bottom + 34;
          else cy = top + 24;
        }
        const pop = k < 0.18 ? 0.4 + (k / 0.18) * 0.75 : k < 0.28 ? 1.15 - ((k - 0.18) / 0.1) * 0.15 : 1;
        const a = k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1;
        g.globalAlpha = a;
        g.translate(cx, cy);
        g.scale(pop, pop);
        if (f.kind === "tip") {
          g.font = `900 ${Math.round(Math.min(17, window.innerWidth / 22))}px ${font}`;
          const w = Math.min((window.innerWidth - 16) / 1.15, g.measureText(f.text).width + 32);
          g.fillStyle = "rgba(255,255,255,0.96)";
          rr(g, -w / 2, -22, w, 44, 22);
          g.fill();
          g.strokeStyle = "#5a3dbf";
          g.lineWidth = 3;
          g.stroke();
          g.fillStyle = "#2b2550";
          g.fillText(f.text, 0, 1, w - 20);
        } else {
          const big = f.kind === "clear" ? 1.25 : f.kind === "combo" ? 1.1 : 1;
          const fs = Math.round(Math.min(56, window.innerWidth / 8) * big);
          g.font = `900 ${fs}px ${font}`;
          g.rotate(-0.06);
          g.lineJoin = "round";
          g.lineWidth = fs * 0.22;
          g.strokeStyle = f.kind === "clear" ? "#d6306f" : f.kind === "combo" ? "#5a3dbf" : "#e07b00";
          g.strokeText(f.text, 0, 0, window.innerWidth - 20);
          const grad = g.createLinearGradient(0, -fs / 2, 0, fs / 2);
          grad.addColorStop(0, "#ffffff");
          grad.addColorStop(1, f.kind === "clear" ? "#ffd2ec" : "#fff3a6");
          g.fillStyle = grad;
          g.fillText(f.text, 0, 0, window.innerWidth - 20);
        }
      }
      g.restore();
      return true;
    });
    // 紙ふぶき
    for (const c of confetti) {
      c.life += dt;
      c.vy += 380 * dt;
      c.vx *= 0.99;
      c.x += c.vx * dt + Math.sin(c.life * 6 + c.rot) * 0.6;
      c.y += c.vy * dt * (c.max > 2 ? 0.35 : 1);
      c.rot += c.vr * dt;
      g.save();
      g.globalAlpha = Math.min(1, (c.max - c.life) * 2);
      g.translate(c.x, c.y);
      g.rotate(c.rot);
      g.scale(1, Math.cos(c.life * 8 + c.rot));
      g.fillStyle = c.c;
      g.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
      g.restore();
    }
    confetti = confetti.filter((c) => c.life < c.max && c.y < window.innerHeight + 40);
  }

  // =========================================================
  // テスト用の読み取り窓口（遊び方には影響しない）
  // =========================================================

  window.__popBlast = {
    get screen() { return app.dataset.screen; },
    get phase() { return phase; },
    get level() { return level ? level.id : null; },
    get moves() { return game ? game.moves : null; },
    get score() { return game ? game.score : null; },
    get goals() { return game ? game.goals.map((g) => ({ type: g.type, color: g.color, left: g.left, shown: goalShown[game.goals.indexOf(g)] })) : null; },
    get save() { return JSON.parse(JSON.stringify(save)); },
    // 盤面のマスの画面上の位置（テストでタップするため）
    cellPoint(r, c) {
      const b = boardCanvas.getBoundingClientRect();
      return { x: b.left + cellX(c), y: b.top + cellY(r) };
    },
    options() { return game ? game.options().map(({ r, c, size, kind, color }) => ({ r, c, size, kind, color })) : []; },
    stats() { return { sprites: sprites.size, particles: particles.length, fx: fx.length, flyers: flyers.length, confetti: confetti.length, cache: spriteCache.size, cell: view.cell }; },
  };

  // 起動
  buildMap();
  requestAnimationFrame((t) => {
    lastT = t;
    frame(t);
  });
  // キーボード：Enter で開いているポップアップの主ボタン
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && app.dataset.screen === "game" && phase !== "end") {
      const m = $("pb-pausemenu");
      if (m.classList.contains("show")) showModal(null);
      else showModal("pb-pausemenu");
    }
  });
})();
