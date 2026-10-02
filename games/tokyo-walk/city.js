// 東京、歩く。3.0：街・遠景・空・キャラクターの見た目をつくる
//
// 軽く見せるための基本方針
// ・動かない物は「材質ごとに1つのメッシュ」にまとめる（色は頂点カラーで持つ）→ 描画回数を減らす
// ・外壁は 1024×512 の1枚（外壁アトラス）、看板・お店・道路標示は 1024×768 の1枚（看板アトラス）
// ・見えない面（地面や壁に接する底面、建物どうしが接する面、遠景の外側を向いた面）は作らない
// ・ポリゴンを増やすかわりに、色・質感・配置・「影のなじみ（頂点カラーの陰）」でそれらしく見せる
// ・画像ファイルは使わず、Canvas でその場で描く
// THREE は app.js から受け取る（このファイル自体は Three.js を読み込まない）

const FONT = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Noto Sans CJK JP","Yu Gothic",sans-serif';

// =========================================================
// 小さな道具
// =========================================================

// 固定の乱数（毎回同じ街並みになる）
function makeRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// なめらかなムラ（場所 x, z から 0〜1。道路や歩道の汚れの濃淡に使う）
function noise2(x, z) {
  const h = (i, j) => {
    const n = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const i = Math.floor(x);
  const j = Math.floor(z);
  const fx = x - i;
  const fz = z - j;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = h(i, j) + (h(i + 1, j) - h(i, j)) * u;
  const b = h(i, j + 1) + (h(i + 1, j + 1) - h(i, j + 1)) * u;
  return a + (b - a) * v;
}

// 細かいザラつき（アスファルトやコンクリートの質感）。範囲を指定できる
function speckle(g, x, y, w, h, amount, rnd) {
  const img = g.getImageData(x, y, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  g.putImageData(img, x, y);
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// 横書きの文字を、枠いっぱいに収まるサイズで描く
function fitText(g, text, cx, cy, maxW, size, weight = 800) {
  let s = size;
  do {
    g.font = `${weight} ${s}px ${FONT}`;
    s -= 1;
  } while (g.measureText(text).width > maxW && s > 7);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, cx, cy);
}

// 縦書き（1文字ずつ積む）
function verticalText(g, text, cx, top, bottom, maxSize, weight = 800) {
  const chars = [...text];
  const size = Math.min(maxSize, (bottom - top) / chars.length);
  g.font = `${weight} ${Math.floor(size * 0.86)}px ${FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  chars.forEach((ch, i) => g.fillText(ch === "ー" ? "｜" : ch, cx, top + size * (i + 0.5)));
}

// 色を明るく(k>0)/暗く(k<0)
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.round(Math.max(0, Math.min(255, k < 0 ? c * (1 + k) : c + (255 - c) * k)));
  return "#" + ((f(n >> 16) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255)).toString(16).padStart(6, "0");
}

// =========================================================
// ジオメトリをまとめる（材質ごとに1メッシュにする）
// =========================================================

// 指定した面（グループ）を取り除く。例：箱の底面、円柱の底のふた
function withoutGroups(geo, drop) {
  const idx = geo.index.array;
  const keep = [];
  for (const gr of geo.groups) {
    if (drop.includes(gr.materialIndex)) continue;
    for (let i = gr.start; i < gr.start + gr.count; i++) keep.push(idx[i]);
  }
  geo.setIndex(keep);
  geo.clearGroups();
  return geo;
}

function createKit(THREE) {
  // 底のない箱（地面・壁・屋上に置く物。底面は見えない）：三角形10枚
  const BOX = withoutGroups(new THREE.BoxGeometry(1, 1, 1), [3]);
  // 6面ある箱（宙に浮いている物：看板の枠・手すり・ひさし）
  const BOX6 = new THREE.BoxGeometry(1, 1, 1);
  // 細い柱（上下のふたなし、5角形）：三角形10枚
  const POST = new THREE.CylinderGeometry(0.5, 0.5, 1, 5, 1, true);
  // 円柱（底のふたなし、8角形）
  const CYL = withoutGroups(new THREE.CylinderGeometry(0.5, 0.5, 1, 8), [2]);
  const CONE_TRUNK = new THREE.CylinderGeometry(0.33, 0.5, 1, 6, 1, true);
  const SPH = new THREE.SphereGeometry(0.5, 6, 4);
  const DOME = new THREE.SphereGeometry(0.5, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2);
  const BLOB = new THREE.IcosahedronGeometry(1, 1);
  const BLOB0 = new THREE.IcosahedronGeometry(1, 0);
  const PLANE = new THREE.PlaneGeometry(1, 1); // +z を向く板
  const FLAT = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2); // 上を向く板（絵の上は -z）
  const TORUS = new THREE.TorusGeometry(1, 0.11, 3, 8);

  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();

  // 位置・大きさ・回転（Y→X→Z の順）から行列を作る
  function M(x, y, z, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) {
    _e.set(rx, ry, rz, "YXZ");
    _q.setFromEuler(_e);
    return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
  }

  // parts: { geo, matrix, color, rect(アトラスの範囲), scale(UV倍率), fixedUV, rotate, shade(x,y,z)→明るさ }
  //    または { raw: { pos, nor, uv, col } }（外壁など、頂点を直接つくった四角形）
  function merge(parts) {
    let count = 0;
    const geos = parts.map((p) => {
      if (p.raw) {
        count += p.raw.pos.length / 3;
        return null;
      }
      const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
      g.applyMatrix4(p.matrix);
      count += g.attributes.position.count;
      return g;
    });
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    const c = new THREE.Color();
    let o = 0;
    geos.forEach((g, i) => {
      const p = parts[i];
      if (p.raw) {
        pos.set(p.raw.pos, o * 3);
        nor.set(p.raw.nor, o * 3);
        col.set(p.raw.col, o * 3);
        uvs.set(p.raw.uv, o * 2);
        o += p.raw.pos.length / 3;
        return;
      }
      const n = g.attributes.position.count;
      const pa = g.attributes.position.array;
      pos.set(pa, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      c.set(p.color === undefined ? 0xffffff : p.color);
      const uv = g.attributes.uv;
      for (let k = 0; k < n; k++) {
        const j = o + k;
        const sh = p.shade ? p.shade(pa[k * 3], pa[k * 3 + 1], pa[k * 3 + 2]) : 1;
        col[j * 3] = c.r * sh;
        col[j * 3 + 1] = c.g * sh;
        col[j * 3 + 2] = c.b * sh;
        let u = uv ? uv.getX(k) : 0;
        let v = uv ? uv.getY(k) : 0;
        if (p.fixedUV) {
          u = p.fixedUV[0];
          v = p.fixedUV[1];
        } else {
          if (p.rotate) {
            const t = u;
            u = v;
            v = 1 - t;
          }
          if (p.scale) {
            u *= p.scale[0];
            v *= p.scale[1];
          }
          if (p.rect) {
            u = p.rect[0] + u * (p.rect[2] - p.rect[0]);
            v = p.rect[1] + v * (p.rect[3] - p.rect[1]);
          }
        }
        uvs[j * 2] = u;
        uvs[j * 2 + 1] = v;
      }
      o += n;
      g.dispose();
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geo.computeBoundingSphere();
    return geo;
  }

  // chunk を指定すると、置いた場所ごと（40m 四方）に別のメッシュに分ける。
  // → 画面外の区画は描かれない（視錐台カリング）
  class Batch {
    constructor({ chunk = 0 } = {}) {
      this.parts = [];
      this.chunk = chunk;
    }
    add(geo, matrix, color, opts) {
      this.parts.push({ geo, matrix, color, ...opts });
      return this;
    }
    box(x, y, z, sx, sy, sz, color, ry = 0, rx = 0, rz = 0, geo = BOX) {
      return this.add(geo, M(x, y, z, sx, sy, sz, ry, rx, rz), color);
    }
    // 2点を結ぶ柱（フレームや電柱の腕など）
    rod(a, b, r, color, geo = POST) {
      const dir = new THREE.Vector3().subVectors(b, a);
      const len = dir.length();
      const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      const m = new THREE.Matrix4().compose(mid, q, new THREE.Vector3(r * 2, len, r * 2));
      return this.add(geo, m, color);
    }
    // 四角形（a→b→c→d は外から見て反時計回り）。uv・色は頂点ごと
    quad(a, b, c, d, n, uv, cols) {
      const order = [0, 1, 2, 0, 2, 3];
      const P = [a, b, c, d];
      const pos = new Float32Array(18);
      const nor = new Float32Array(18);
      const col = new Float32Array(18);
      const u = new Float32Array(12);
      order.forEach((k, i) => {
        pos.set(P[k], i * 3);
        nor.set(n, i * 3);
        col.set(cols[k], i * 3);
        u.set(uv[k], i * 2);
      });
      this.parts.push({ raw: { pos, nor, uv: u, col }, cx: (a[0] + c[0]) / 2, cz: (a[2] + c[2]) / 2 });
      return this;
    }
    get tris() {
      return this.parts.reduce((n, p) => n + (p.raw ? p.raw.pos.length / 9 : (p.geo.index ? p.geo.index.count : p.geo.attributes.position.count) / 3), 0);
    }
    meshes(material) {
      if (!this.parts.length) return [];
      if (!this.chunk) return [new THREE.Mesh(merge(this.parts), material)];
      const groups = new Map();
      for (const p of this.parts) {
        const x = p.raw ? p.cx : p.matrix.elements[12];
        const z = p.raw ? p.cz : p.matrix.elements[14];
        const key = Math.floor(x / this.chunk) + "," + Math.floor(z / this.chunk);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(p);
      }
      return [...groups.values()].map((list) => new THREE.Mesh(merge(list), material));
    }
  }

  return { BOX, BOX6, POST, CYL, CONE_TRUNK, SPH, DOME, BLOB, BLOB0, PLANE, FLAT, TORUS, M, Batch };
}

// =========================================================
// アトラス（看板・お店・道路標示の絵を1枚に詰める）
// =========================================================

class Atlas {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.canvas = document.createElement("canvas");
    this.canvas.width = w;
    this.canvas.height = h;
    this.g = this.canvas.getContext("2d");
    this.requests = [];
    this.pad = 4;
  }
  // w×h の区画を予約する。返す配列には pack() のあとで UV の範囲 [u0, v0, u1, v1] が入る
  alloc(w, h, draw) {
    const rect = [];
    this.requests.push({ w, h, draw, rect });
    return rect;
  }
  // 背の高いものから順に棚に並べる（すき間が少なくなる）
  pack() {
    const W = this.w;
    const H = this.h;
    const g = this.g;
    let x = 0;
    let y = 0;
    let rowH = 0;
    for (const r of [...this.requests].sort((a, b) => b.h - a.h || b.w - a.w)) {
      if (x + r.w > W) {
        x = 0;
        y += rowH + this.pad;
        rowH = 0;
      }
      if (y + r.h > H) throw new Error("atlas full");
      g.save();
      g.translate(x, y);
      g.beginPath();
      g.rect(0, 0, r.w, r.h);
      g.clip();
      r.draw(g, r.w, r.h);
      g.restore();
      r.rect.push((x + 1) / W, 1 - (y + r.h - 1) / H, (x + r.w - 1) / W, 1 - (y + 1) / H);
      x += r.w + this.pad;
      rowH = Math.max(rowH, r.h);
    }
    this.used = (y + rowH) / H;
  }
}

// =========================================================
// テクスチャ
// =========================================================

function canvasTex(THREE, w, h, draw, { repeat = true, aniso = 4 } = {}) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d", { willReadFrequently: true }), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ---- 外壁アトラス（1024×512）----
// 上 384px：外壁の柄4種（各 256×384 = 幅6m×高さ9m = 2部屋×3階）。白っぽく描き、建物の色を頂点カラーで掛ける
// 下 128px：1階の柄4種（各 256×128 = 幅6m×高さ3m）：シャッター・住宅の入口・ロビー・窓のない壁
const FACADE_STYLES = ["apartment", "office", "mixed", "old"];
const GROUND_KINDS = ["shutter", "residence", "lobby", "blank"];
const PX = 256 / 6; // 1m あたりのピクセル数
// 雑居ビルの窓ガラスに貼られた文字（架空・一般的な言葉だけ）
const WINDOW_WORDS = ["整体", "英会話", "塾", "ネイル", "歯科", "麻雀", "囲碁", "書道", "ヨガ", "税理士"];

function drawWindow(g, x, y, w, h, kind, rnd) {
  g.fillStyle = "rgba(55,50,45,0.38)"; // くぼみの影
  g.fillRect(x - 3, y - 3, w + 6, h + 7);
  g.fillStyle = "#f6f4ef"; // サッシの枠
  g.fillRect(x - 2, y - 2, w + 4, h + 4);
  const glass = g.createLinearGradient(x, y, x, y + h);
  if (kind === "lit") {
    glass.addColorStop(0, "#ffe7bb");
    glass.addColorStop(1, "#efb36e");
  } else {
    glass.addColorStop(0, "#b4c6d4"); // 上は空が映って明るい
    glass.addColorStop(0.45, "#61778d");
    glass.addColorStop(1, "#46566a");
  }
  g.fillStyle = glass;
  g.fillRect(x, y, w, h);
  if (kind === "curtain") {
    g.fillStyle = ["#efe6d8", "#e3e7e0", "#eadcd6", "#dfe2ea"][Math.floor(rnd() * 4)];
    const cw = w * (0.25 + rnd() * 0.3);
    g.fillRect(x + 1, y + 1, cw, h - 2);
    g.fillRect(x + w - cw * 0.6 - 1, y + 1, cw * 0.6, h - 2);
  } else if (kind === "blind") {
    g.fillStyle = "#dcdad3";
    const bh = h * (0.4 + rnd() * 0.55);
    g.fillRect(x, y, w, bh);
    g.fillStyle = "rgba(0,0,0,0.12)";
    for (let k = 3; k < bh; k += 4) g.fillRect(x, y + k, w, 1);
  }
  if (kind !== "lit") {
    g.fillStyle = "rgba(255,255,255,0.18)"; // 斜めの映り込み
    g.beginPath();
    g.moveTo(x, y + h * 0.6);
    g.lineTo(x + w * 0.4, y);
    g.lineTo(x + w * 0.58, y);
    g.lineTo(x, y + h * 0.86);
    g.fill();
  }
  g.fillStyle = "rgba(40,40,40,0.32)"; // 上の影（奥行き）
  g.fillRect(x, y, w, 4);
  g.fillStyle = "#d4d0c8"; // 水切り
  g.fillRect(x - 4, y + h + 2, w + 8, 4);
  g.fillStyle = "rgba(60,55,50,0.10)"; // 水切りから下の雨だれ
  g.fillRect(x + 4, y + h + 6, 3, 10 + rnd() * 16);
}

function drawFacadeTile(g, ox, style, rnd) {
  const wall = { apartment: "#f3f0ea", office: "#eceef0", mixed: "#f1ede6", old: "#ebe5da" }[style];
  g.fillStyle = wall;
  g.fillRect(ox, 0, 256, 384);
  if (style === "old") {
    // 古いタイル張り：細かい目地
    g.fillStyle = "rgba(0,0,0,0.05)";
    for (let y = 0; y < 384; y += 6) g.fillRect(ox, y, 256, 1);
    for (let x = 0; x < 256; x += 12) g.fillRect(ox + x, 0, 1, 384);
  }
  const pick = () => {
    const r = rnd();
    return r < 0.24 ? "lit" : r < 0.5 ? "curtain" : r < 0.68 ? "blind" : "dark";
  };
  for (let f = 0; f < 3; f++) {
    const top = (2 - f) * 128; // 下から f 階目のいちばん上
    // 階の境目（スラブ）の線
    g.fillStyle = "rgba(0,0,0,0.07)";
    g.fillRect(ox, top + 122, 256, 6);
    if (style === "office") {
      // 横に長い連続窓＋腰壁
      g.fillStyle = "#d6dbe1";
      g.fillRect(ox, top + 92, 256, 30);
      const k = pick();
      drawWindow(g, ox + 6, top + 14, 244, 70, k === "curtain" ? "blind" : k, rnd);
      g.fillStyle = "#e8ebee";
      for (let m = 1; m < 8; m++) g.fillRect(ox + 6 + m * 30.5, top + 12, 3, 74); // 縦の桟
      continue;
    }
    for (let bx = 0; bx < 2; bx++) {
      const x = ox + bx * 128;
      if (style === "apartment") {
        drawWindow(g, x + 12, top + 18, 72, 96, pick(), rnd); // 掃き出し窓
        g.fillStyle = "rgba(0,0,0,0.22)";
        g.fillRect(x + 47, top + 18, 2, 96); // 引き違いの境目
        drawWindow(g, x + 94, top + 30, 24, 34, rnd() < 0.5 ? "dark" : "blind", rnd);
      } else if (style === "mixed") {
        const k1 = pick();
        drawWindow(g, x + 16, top + 22, 44, 56, k1, rnd);
        drawWindow(g, x + 70, top + 22, 44, 56, pick(), rnd);
        if (rnd() < 0.4) {
          // 窓ガラスの文字（テナント）
          g.fillStyle = ["#d63b3b", "#2b62b8", "#2a8a57", "#e07b1a"][Math.floor(rnd() * 4)];
          fitText(g, WINDOW_WORDS[Math.floor(rnd() * WINDOW_WORDS.length)], x + 38, top + 50, 40, 16, 900);
        }
        g.fillStyle = "#e6e4de"; // 壁の室外機
        g.fillRect(x + 84, top + 88, 30, 22);
        g.strokeStyle = "#b7b5ae";
        g.lineWidth = 2;
        g.beginPath();
        g.arc(x + 94, top + 99, 7, 0, Math.PI * 2);
        g.stroke();
      } else {
        drawWindow(g, x + 22, top + 26, 36, 48, pick(), rnd);
        drawWindow(g, x + 74, top + 26, 36, 48, pick(), rnd);
        g.fillStyle = "#c4bdb1"; // 面格子
        for (let b = 0; b < 3; b++) g.fillRect(x + 24 + b * 15, top + 26, 2, 48);
        g.fillStyle = "rgba(90,80,70,0.10)"; // しみ
        g.fillRect(x + 30 + rnd() * 50, top + 80, 6, 30 + rnd() * 20);
      }
    }
  }
  speckle(g, ox, 0, 256, 384, 9, rnd);
}

function drawGroundKind(g, ox, kind, rnd) {
  const y0 = 384;
  g.fillStyle = "#eeebe5";
  g.fillRect(ox, y0, 256, 128);
  if (kind === "shutter") {
    g.fillStyle = "#7d8187"; // シャッターボックス
    g.fillRect(ox + 10, y0 + 4, 236, 12);
    const grad = g.createLinearGradient(0, y0 + 16, 0, y0 + 126);
    grad.addColorStop(0, "#c9ccd0");
    grad.addColorStop(1, "#a9adb3");
    g.fillStyle = grad;
    g.fillRect(ox + 14, y0 + 16, 228, 110);
    for (let y = y0 + 18; y < y0 + 124; y += 4) {
      g.fillStyle = "rgba(255,255,255,0.35)";
      g.fillRect(ox + 14, y, 228, 1);
      g.fillStyle = "rgba(0,0,0,0.12)";
      g.fillRect(ox + 14, y + 2, 228, 1);
    }
    g.fillStyle = "#f8f8f4"; // 貼り紙
    g.fillRect(ox + 150, y0 + 52, 22, 30);
    g.fillStyle = "rgba(0,0,0,0.25)";
    for (let k = 0; k < 4; k++) g.fillRect(ox + 153, y0 + 57 + k * 6, 16, 2);
  } else if (kind === "residence") {
    // すりガラスの窓（面格子つき）
    g.fillStyle = "#cfd8de";
    g.fillRect(ox + 18, y0 + 26, 64, 44);
    g.fillStyle = "#9aa1a8";
    for (let b = 0; b < 5; b++) g.fillRect(ox + 20 + b * 15, y0 + 26, 2, 44);
    // 入口（ガラス扉＋ひさしの影）
    g.fillStyle = "rgba(0,0,0,0.18)";
    g.fillRect(ox + 98, y0 + 10, 68, 8);
    g.fillStyle = "#6f665d";
    g.fillRect(ox + 102, y0 + 18, 60, 110);
    g.fillStyle = "#56677a";
    g.fillRect(ox + 108, y0 + 24, 48, 100);
    g.fillStyle = "rgba(255,255,255,0.22)";
    g.fillRect(ox + 112, y0 + 28, 8, 92);
    // 集合ポスト・インターホン
    g.fillStyle = "#b9bec4";
    g.fillRect(ox + 180, y0 + 46, 58, 44);
    g.fillStyle = "#8e959c";
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) g.fillRect(ox + 183 + c * 14, y0 + 49 + r * 14, 12, 12);
    g.fillStyle = "#555";
    g.fillRect(ox + 168, y0 + 58, 8, 12);
  } else if (kind === "lobby") {
    const grad = g.createLinearGradient(0, y0, 0, y0 + 128);
    grad.addColorStop(0, "#7c8c9b");
    grad.addColorStop(1, "#3f4a56");
    g.fillStyle = grad;
    g.fillRect(ox + 4, y0 + 8, 248, 110);
    g.fillStyle = "#ffe9c4"; // 中の明かり
    g.fillRect(ox + 100, y0 + 30, 56, 88);
    g.fillStyle = "#c9ced3";
    for (let m = 0; m <= 6; m++) g.fillRect(ox + 4 + m * 41, y0 + 8, 3, 110);
    g.fillRect(ox + 4, y0 + 8, 248, 4);
    g.fillStyle = "#5a5f66"; // 御影石の腰
    g.fillRect(ox, y0 + 118, 256, 10);
  } else {
    // 窓のない壁（側面の壁に使う）：うっすらした雨だれと、パネルの継ぎ目
    for (let k = 0; k < 7; k++) {
      const x = ox + rnd() * 240;
      const w = 6 + rnd() * 14;
      const grad = g.createLinearGradient(0, y0, 0, y0 + 128);
      grad.addColorStop(0, "rgba(90,82,74,0.07)");
      grad.addColorStop(1, "rgba(90,82,74,0)");
      g.fillStyle = grad;
      g.fillRect(x, y0, w, 30 + rnd() * 60);
    }
    g.fillStyle = "rgba(0,0,0,0.035)";
    g.fillRect(ox, y0 + 64, 256, 1);
    g.fillRect(ox + 128, y0, 1, 128);
  }
  speckle(g, ox, y0, 256, 128, 10, rnd);
}

function facadeAtlas(THREE, rnd) {
  return canvasTex(THREE, 1024, 512, (g) => {
    FACADE_STYLES.forEach((s, i) => drawFacadeTile(g, i * 256, s, rnd));
    GROUND_KINDS.forEach((k, i) => drawGroundKind(g, i * 256, k, rnd));
  }, { repeat: false });
}

// アスファルト：256px = 道路の長さ 8m × 道路の幅 8m。
// 横方向（v）は道路の幅にぴったり合わせ、轍・オイルのしみ・路肩の汚れを車線に沿って描く
function asphaltTexture(THREE, rnd) {
  return canvasTex(THREE, 256, 256, (g) => {
    g.fillStyle = "#585b62";
    g.fillRect(0, 0, 256, 256);
    // 大きなムラ
    for (let i = 0; i < 26; i++) {
      g.fillStyle = `rgba(${rnd() < 0.5 ? "38,40,46" : "120,122,128"},0.07)`;
      g.beginPath();
      g.ellipse(rnd() * 256, rnd() * 256, 20 + rnd() * 50, 10 + rnd() * 26, 0, 0, Math.PI * 2);
      g.fill();
    }
    const band = (y, h, color) => {
      const grad = g.createLinearGradient(0, y - h / 2, 0, y + h / 2);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(0.5, color);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.fillRect(0, y - h / 2, 256, h);
    };
    // 道路の幅方向の位置（m、中心0）→ ピクセル
    const Y = (m) => 128 - m * 32;
    for (const s of [-1, 1]) {
      band(Y(s * 2), 22, "rgba(30,28,26,0.30)"); // 車線の真ん中のオイルのしみ
      band(Y(s * 1.2), 16, "rgba(140,142,148,0.16)"); // 轍（タイヤで磨かれて少し明るい）
      band(Y(s * 2.8), 16, "rgba(140,142,148,0.16)");
      band(Y(s * 3.9), 26, "rgba(48,44,40,0.45)"); // 路肩の砂ぼこり
    }
    speckle(g, 0, 0, 256, 256, 30, rnd);
    // 細いひび（横方向に）
    g.strokeStyle = "rgba(28,28,32,0.30)";
    g.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      let x = rnd() * 256;
      let y = rnd() * 256;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        x += 6 + rnd() * 14;
        y += (rnd() - 0.5) * 10;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  }, { aniso: 8 });
}

// 歩道：灰色系のインターロッキングブロック（256px = 3m）。ところどころ色違い・汚れ
function pavingTexture(THREE, rnd) {
  return canvasTex(THREE, 256, 256, (g) => {
    g.fillStyle = "#9b968e";
    g.fillRect(0, 0, 256, 256);
    const colors = ["#c8c4bc", "#c1bcb3", "#cfcac2", "#bbb6ad", "#c5c0b8", "#b6b1a8"];
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 4; x++) {
        const off = y % 2 ? 32 : 0;
        g.fillStyle = rnd() < 0.06 ? "#a9a49b" : colors[Math.floor(rnd() * colors.length)];
        g.fillRect(((x * 64 + off) % 256) + 1.5, y * 32 + 1.5, 61, 29);
        if (off) g.fillRect(-32 + 1.5, y * 32 + 1.5, 61, 29);
      }
    }
    // ガムや雨のしみ
    for (let i = 0; i < 10; i++) {
      g.fillStyle = "rgba(70,64,58,0.10)";
      g.beginPath();
      g.ellipse(rnd() * 256, rnd() * 256, 3 + rnd() * 12, 2 + rnd() * 8, rnd() * 3, 0, Math.PI * 2);
      g.fill();
    }
    speckle(g, 0, 0, 256, 256, 16, rnd);
  }, { aniso: 8 });
}

// 葉っぱ・芝生の細かい模様（白黒。色は頂点カラー・材質の色で付ける）
function leafTexture(THREE, rnd) {
  return canvasTex(THREE, 128, 128, (g) => {
    g.fillStyle = "#d8d8d8";
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 420; i++) {
      const v = rnd() < 0.55 ? 150 + rnd() * 40 : 235 + rnd() * 20;
      g.fillStyle = `rgba(${v},${v},${v},0.7)`;
      g.beginPath();
      g.ellipse(rnd() * 128, rnd() * 128, 2 + rnd() * 3, 1.5 + rnd() * 2, rnd() * 3, 0, Math.PI * 2);
      g.fill();
    }
  });
}

// 点字ブロック（黄色）：64px = 0.6m
function tactileTexture(THREE) {
  return canvasTex(THREE, 64, 64, (g) => {
    g.fillStyle = "#e9bd1d";
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = "#c99f12";
    g.fillRect(0, 0, 64, 2);
    g.fillRect(0, 0, 2, 64);
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        g.fillStyle = "#f7d75a";
        g.beginPath();
        g.arc(8 + x * 12, 8 + y * 12, 3.4, 0, Math.PI * 2);
        g.fill();
      }
    }
  });
}

// 光だまり（街灯の下にふんわり）／プレイヤーの足もとの丸い影
function glowTexture(THREE) {
  return canvasTex(THREE, 64, 64, (g) => {
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, "rgba(255,255,255,1)");
    r.addColorStop(0.5, "rgba(255,255,255,0.35)");
    r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
  }, { repeat: false });
}

// 遠景のビル（窓だけのシンプルな柄）
function farTexture(THREE, rnd) {
  return canvasTex(THREE, 64, 64, (g) => {
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, 64, 64);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        g.fillStyle = rnd() < 0.2 ? "#ffd59a" : "#8796aa";
        g.fillRect(x * 16 + 4, y * 16 + 4, 9, 9);
      }
    }
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, 3, 3); // 左上は無地（屋上・塔の色用）
  });
}

// =========================================================
// 看板アトラスの中身
// =========================================================

const SHOP_STYLE = {
  cafe: { band: "#5e4334", text: "#ffe9c9", inside: ["#ffe1b0", "#d99a5c"] },
  realty: { band: "#2c62a0", text: "#ffffff", inside: ["#eef4fa", "#c3d3e2"] },
  dental: { band: "#f7f7f4", text: "#2f86b5", inside: ["#f2f8fa", "#d2e4ea"] },
  ramen: { band: "#a8261c", text: "#fff3d6", inside: ["#ffd9a0", "#d9873f"], noren: "#2c3550" },
  salon: { band: "#2b2b33", text: "#f1d7df", inside: ["#fff3f5", "#e5c6cf"] },
  cleaning: { band: "#3790cc", text: "#ffffff", inside: ["#f5f9fc", "#cfe0ec"] },
  izakaya: { band: "#3b2414", text: "#ffd34d", inside: ["#ffcf8a", "#c46a34"], noren: "#b8261b", lantern: true },
  books: { band: "#4f6230", text: "#fff7e0", inside: ["#fff1d0", "#cfae7d"] },
  bento: { band: "#df6d26", text: "#ffffff", inside: ["#fff0d6", "#eab47c"] },
  drug: { band: "#278f55", text: "#ffffff", inside: ["#f6fff8", "#cbe9d4"] },
  sento: { band: "#284682", text: "#ffffff", inside: ["#fff4dc", "#dcb57e"], noren: "#2c4f9e" },
  conbini: { band: "#fbfbf8", text: "#d93b33", inside: ["#fbffff", "#dde9ee"], stripe: ["#3a86ff", "#2ec27e"] },
  flower: { band: "#f2c4cd", text: "#74384a", inside: ["#fff6f4", "#f0cdd2"] },
};

// 1階のお店の正面（240×80 ≒ 幅9m×高さ3m）
function drawShopfront(g, w, h, shop, kind, rnd) {
  const st = SHOP_STYLE[kind];
  const band = Math.round(h * 0.28);
  g.fillStyle = "#cfcac2";
  g.fillRect(0, 0, w, h);
  // 看板の帯
  g.fillStyle = st.band;
  g.fillRect(0, 0, w, band);
  if (st.stripe) {
    g.fillStyle = st.stripe[0];
    g.fillRect(0, band - 6, w, 3);
    g.fillStyle = st.stripe[1];
    g.fillRect(0, band - 3, w, 3);
  }
  g.fillStyle = "rgba(0,0,0,0.18)";
  g.fillRect(0, band - 1, w, 2);
  g.fillStyle = st.text;
  fitText(g, shop, w / 2, band / 2, w - 18, Math.round(h * 0.21), 800);
  // ガラス（店内の明かり）
  const gy = band + 4;
  const glass = g.createLinearGradient(0, gy, 0, h);
  glass.addColorStop(0, st.inside[0]);
  glass.addColorStop(1, st.inside[1]);
  g.fillStyle = glass;
  g.fillRect(6, gy, w - 12, h - gy - 3);
  // 店内の棚・テーブルのシルエット
  g.fillStyle = "rgba(90,70,60,0.22)";
  for (let i = 0; i < 5; i++) g.fillRect(14 + i * 44, gy + 22, 28, h - gy - 30);
  // 種類ごとの小物：花・本・貼り紙
  if (kind === "flower") {
    for (let i = 0; i < 40; i++) {
      g.fillStyle = ["#ff6f91", "#ffd23f", "#ffffff", "#c86bfa", "#ff9f43"][i % 5];
      g.beginPath();
      g.arc(10 + rnd() * (w - 20), h - 6 - rnd() * 14, 2.5, 0, Math.PI * 2);
      g.fill();
    }
  } else if (kind === "books") {
    for (let i = 0; i < 46; i++) {
      g.fillStyle = ["#7a3b2e", "#2f4f6f", "#a67c2d", "#4b6b3a", "#e8dcc4"][i % 5];
      g.fillRect(12 + i * 4.8, h - 18 - (i % 3) * 2, 3.5, 14 + (i % 3) * 2);
    }
  } else if (kind === "realty" || kind === "conbini" || kind === "drug") {
    for (let i = 0; i < 6; i++) {
      g.fillStyle = "#fbfbf6"; // 貼り紙（物件・お知らせ）
      g.fillRect(12 + i * 18 + (i > 2 ? w - 120 : 0), gy + 6, 14, 18);
      g.fillStyle = "rgba(0,0,0,0.3)";
      g.fillRect(14 + i * 18 + (i > 2 ? w - 120 : 0), gy + 9, 10, 2);
    }
  }
  // サッシ
  g.fillStyle = "#8b8680";
  for (let i = 1; i < 6; i++) g.fillRect(6 + i * ((w - 12) / 6), gy, 2, h - gy - 3);
  // 入口（真ん中）
  g.fillStyle = "rgba(60,50,45,0.5)";
  g.fillRect(w / 2 - 17, gy + 3, 34, h - gy - 6);
  // のれん・ちょうちん
  if (st.noren) {
    g.fillStyle = st.noren;
    for (let k = 0; k < 3; k++) g.fillRect(w / 2 - 20 + k * 14, gy, 12, 20);
    g.fillStyle = "#fff";
    fitText(g, kind === "sento" ? "ゆ" : kind === "ramen" ? "ら" : "酒", w / 2, gy + 10, 12, 11, 900);
  }
  if (st.lantern) {
    for (const lx of [w / 2 - 32, w / 2 + 32]) {
      g.fillStyle = "#d8332a";
      g.beginPath();
      g.ellipse(lx, gy + 14, 6, 10, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  // 映り込み
  g.fillStyle = "rgba(255,255,255,0.22)";
  g.beginPath();
  g.moveTo(18, h - 4);
  g.lineTo(62, gy);
  g.lineTo(80, gy);
  g.lineTo(36, h - 4);
  g.fill();
}

function drawVerticalSign(g, w, h, text, color, textColor) {
  g.fillStyle = color;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = "rgba(255,255,255,0.85)";
  g.lineWidth = 3;
  g.strokeRect(3, 3, w - 6, h - 6);
  g.fillStyle = textColor;
  verticalText(g, text, w / 2, 9, h - 9, w * 0.8);
}

function drawRoofSign(g, w, h, text, color) {
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, color);
  grad.addColorStop(1, shade(color, -0.25));
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = "rgba(255,255,255,0.9)";
  g.lineWidth = 4;
  g.strokeRect(4, 4, w - 8, h - 8);
  g.fillStyle = "#fff";
  fitText(g, text, w / 2, h / 2 + 2, w - 28, h * 0.6, 900);
}

// =========================================================
// 街をつくる
// =========================================================

export function buildWorld(THREE, E, scene, { isTouch, maxAniso = 4 }) {
  const K = createKit(THREE);
  const { M, Batch, BOX, BOX6, POST, CYL, CONE_TRUNK, SPH, DOME, BLOB, BLOB0, PLANE, FLAT, TORUS } = K;
  const rnd = makeRandom(20261002);
  const aniso = Math.min(maxAniso, isTouch ? 2 : 8);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  // ---- テクスチャ ----
  const tex = {
    facade: facadeAtlas(THREE, rnd),
    asphalt: asphaltTexture(THREE, rnd),
    paving: pavingTexture(THREE, rnd),
    leaf: leafTexture(THREE, rnd),
    tactile: tactileTexture(THREE),
    glow: glowTexture(THREE),
    far: farTexture(THREE, rnd),
  };
  for (const t of [tex.facade, tex.asphalt, tex.paving]) t.anisotropy = aniso;

  // ---- 看板アトラス ----
  const atlas = new Atlas(1024, 768);
  const A = {};
  const swatch = (color) => atlas.alloc(12, 12, (g) => {
    g.fillStyle = color;
    g.fillRect(0, 0, 12, 12);
  });
  A.white = swatch("#f4f4f0");
  A.yellow = swatch("#eabf22");
  A.shop = {};
  for (const b of E.BUILDINGS) A.shop[b.shop] = atlas.alloc(240, 80, (g, w, h) => drawShopfront(g, w, h, b.shop, b.shopKind, rnd));
  const SIGN_COLORS = ["#d8423a", "#2f68a8", "#2a9083", "#e0832a", "#6f4cbf", "#c93f74", "#3a3f4f"];
  A.vsign = {};
  E.BUILDINGS.forEach((b, i) => {
    const color = SIGN_COLORS[i % SIGN_COLORS.length];
    A.vsign[b.shop] = atlas.alloc(40, 160, (g, w, h) => drawVerticalSign(g, w, h, b.vsign, i % 3 === 1 ? "#fffaf0" : color, i % 3 === 1 ? color : "#fff"));
  });
  A.roof = {};
  E.BUILDINGS.filter((b) => b.sign).forEach((b, i) => {
    A.roof[b.shop] = atlas.alloc(224, 70, (g, w, h) => drawRoofSign(g, w, h, b.sign, SIGN_COLORS[(i * 3 + 1) % SIGN_COLORS.length]));
  });
  A.board = {};
  E.PROPS.filter((p) => p.kind === "signboard").forEach((p, i) => {
    A.board[p.text] = atlas.alloc(80, 108, (g, w, h) => {
      g.fillStyle = ["#2b2f3f", "#fff8e8", "#1f5f4a", "#fff"][i % 4];
      g.fillRect(0, 0, w, h);
      g.strokeStyle = "#c9a227";
      g.lineWidth = 4;
      g.strokeRect(4, 4, w - 8, h - 8);
      g.fillStyle = ["#fff", "#b8261b", "#fff", "#2a9d5c"][i % 4];
      fitText(g, p.text, w / 2, h / 2, w - 14, 26);
    });
  });
  A.tomare = atlas.alloc(80, 168, (g, w, h) => {
    g.fillStyle = "#f4f4f0";
    g.font = `900 56px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    // 手前（下）から読む：止 → ま → れ
    ["れ", "ま", "止"].forEach((ch, i) => {
      g.save();
      g.translate(w / 2, 28 + i * 56);
      g.scale(1, 1.15);
      g.fillText(ch, 0, 0);
      g.restore();
    });
  });
  A.manhole = atlas.alloc(80, 80, (g) => {
    g.fillStyle = "#56565c";
    g.beginPath();
    g.arc(40, 40, 38, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#3a3a40";
    g.lineWidth = 3;
    for (let r = 12; r < 38; r += 8) {
      g.beginPath();
      g.arc(40, 40, r, 0, Math.PI * 2);
      g.stroke();
    }
    for (let k = 0; k < 8; k++) {
      g.beginPath();
      g.moveTo(40, 40);
      g.lineTo(40 + Math.cos((k * Math.PI) / 4) * 36, 40 + Math.sin((k * Math.PI) / 4) * 36);
      g.stroke();
    }
  });
  A.drain = atlas.alloc(112, 28, (g) => {
    g.fillStyle = "#3a3c42";
    g.fillRect(0, 0, 112, 28);
    g.fillStyle = "#1f2025";
    for (let i = 0; i < 12; i++) g.fillRect(6 + i * 8.6, 5, 4, 18);
  });
  A.grate = atlas.alloc(56, 56, (g) => {
    g.fillStyle = "#4a4a50";
    g.fillRect(0, 0, 56, 56);
    g.fillStyle = "#2c2c31";
    for (let i = 0; i < 7; i++) g.fillRect(4, 4 + i * 7.5, 48, 3);
    g.fillStyle = "#6a5a48";
    g.beginPath();
    g.arc(28, 28, 9, 0, Math.PI * 2);
    g.fill();
  });
  A.stop = atlas.alloc(80, 80, (g) => {
    g.fillStyle = "#fff";
    g.beginPath();
    g.moveTo(3, 8);
    g.lineTo(77, 8);
    g.lineTo(40, 76);
    g.closePath();
    g.fill();
    g.fillStyle = "#d42a2a";
    g.beginPath();
    g.moveTo(12, 13);
    g.lineTo(68, 13);
    g.lineTo(40, 65);
    g.closePath();
    g.fill();
    g.fillStyle = "#fff";
    g.font = `900 14px ${FONT}`;
    g.textAlign = "center";
    g.fillText("止まれ", 40, 30);
  });
  A.crossing = atlas.alloc(80, 80, (g) => {
    g.fillStyle = "#fff";
    g.fillRect(2, 2, 76, 76);
    g.fillStyle = "#2a62c9";
    g.fillRect(7, 7, 66, 66);
    g.fillStyle = "#fff";
    g.beginPath();
    g.moveTo(40, 13);
    g.lineTo(67, 63);
    g.lineTo(13, 63);
    g.closePath();
    g.fill();
    g.fillStyle = "#2b2f3f";
    g.beginPath();
    g.arc(42, 32, 4, 0, Math.PI * 2);
    g.fill();
    g.fillRect(38, 37, 6, 13);
    g.fillRect(33, 50, 5, 10);
    g.fillRect(44, 50, 5, 10);
    for (let i = 0; i < 4; i++) g.fillRect(20 + i * 11, 58, 7, 3);
  });
  A.speed = atlas.alloc(80, 80, (g) => {
    g.fillStyle = "#d42a2a";
    g.beginPath();
    g.arc(40, 40, 38, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#fff";
    g.beginPath();
    g.arc(40, 40, 30, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#2a62c9";
    g.font = `900 32px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("30", 40, 42);
  });
  A.parking = atlas.alloc(80, 80, (g) => {
    g.fillStyle = "#2a62c9";
    roundRect(g, 2, 2, 76, 76, 9);
    g.fill();
    g.fillStyle = "#fff";
    g.font = `900 58px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("P", 40, 44);
  });
  A.vacant = atlas.alloc(56, 36, (g) => {
    g.fillStyle = "#1a1a1a";
    g.fillRect(0, 0, 56, 36);
    g.fillStyle = "#4dff7a";
    g.font = `900 24px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("空", 28, 19);
  });
  A.hazard = atlas.alloc(112, 28, (g) => {
    g.fillStyle = "#f2c41c";
    g.fillRect(0, 0, 112, 28);
    g.fillStyle = "#1d1f2b";
    for (let i = -2; i < 9; i++) {
      g.beginPath();
      g.moveTo(i * 14, 28);
      g.lineTo(i * 14 + 7, 28);
      g.lineTo(i * 14 + 21, 0);
      g.lineTo(i * 14 + 14, 0);
      g.fill();
    }
  });
  A.extinguisher = atlas.alloc(56, 28, (g) => {
    g.fillStyle = "#fff";
    g.fillRect(0, 0, 56, 28);
    g.fillStyle = "#d42a2a";
    fitText(g, "消火器", 28, 14, 50, 14);
  });
  A.vending = atlas.alloc(56, 112, (g) => {
    g.fillStyle = "#f6fbff";
    g.fillRect(0, 0, 56, 112);
    const colors = ["#2f7de1", "#f2b134", "#3cb371", "#e8413a", "#8a5cd1", "#1fb5c9"];
    for (let r = 0; r < 3; r++) {
      g.fillStyle = "#dfe8f0";
      g.fillRect(3, 7 + r * 21, 50, 19);
      for (let c = 0; c < 5; c++) {
        g.fillStyle = colors[(r * 5 + c) % colors.length];
        roundRect(g, 6 + c * 10, 9 + r * 21, 6, 13, 2);
        g.fill();
      }
    }
    g.fillStyle = "#e8413a";
    g.fillRect(0, 74, 56, 38);
    g.fillStyle = "#222";
    g.fillRect(9, 95, 38, 10);
    g.fillStyle = "#fff";
    g.fillRect(40, 79, 7, 10);
  });

  atlas.pack();
  const atlasTex = new THREE.CanvasTexture(atlas.canvas);
  atlasTex.colorSpace = THREE.SRGBColorSpace;
  atlasTex.anisotropy = aniso;

  // ---- 材質（不透明な物は「材質を作った順」に描かれる。大きく手前をふさぐ外壁を最初に） ----
  const mat = {
    facade: new THREE.MeshLambertMaterial({ map: tex.facade, vertexColors: true }),
    props: new THREE.MeshLambertMaterial({ vertexColors: true }),
    foliage: new THREE.MeshLambertMaterial({ map: tex.leaf, vertexColors: true }),
    sign: new THREE.MeshLambertMaterial({ map: atlasTex, emissive: "#ffffff", emissiveMap: atlasTex, emissiveIntensity: 0.3, alphaTest: 0.5 }),
    road: new THREE.MeshLambertMaterial({ map: tex.asphalt, vertexColors: true }),
    walk: new THREE.MeshLambertMaterial({ map: tex.paving, vertexColors: true }),
    grass: new THREE.MeshLambertMaterial({ map: tex.leaf, color: "#95c47a" }),
    tactile: new THREE.MeshLambertMaterial({ map: tex.tactile, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    decal: new THREE.MeshLambertMaterial({ map: atlasTex, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
    far: new THREE.MeshLambertMaterial({ map: tex.far, vertexColors: true }),
    ground: new THREE.MeshLambertMaterial({ map: tex.paving, color: "#a8a49d" }),
    pool: new THREE.MeshBasicMaterial({ map: tex.glow, color: "#ffc98a", transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false }),
  };

  // ---- まとめ役 ----
  const B = {
    facade: new Batch({ chunk: 40 }), // 外壁（アトラス）
    props: new Batch({ chunk: 40 }), // 影を落とす物（建物の細部・柱・幹など）
    detail: new Batch({ chunk: 40 }), // 影を落とさない小物（自転車・ゴミ箱・柵など）
    foliage: new Batch({ chunk: 40 }), // 葉っぱ・植え込み
    glow: new Batch(), // 光る部分（ライトなど）
    road: new Batch(),
    walk: new Batch(),
    grass: new Batch(),
    tactile: new Batch(),
    decal: new Batch(), // 道路標示・マンホールなど（アトラス）
    sign: new Batch(), // 看板・お店の正面（アトラス、少し発光）
    pool: new Batch(),
    far: new Batch(),
  };

  // 地面に貼る板（y は少しずつずらして重なりのチラつきを防ぐ）
  const flat = (batch, x, z, w, d, y, opts = {}, ry = 0) => batch.add(FLAT, M(x, y, z, w, 1, d, ry), opts.color, opts);
  // 立てた板（+z 向きを ry だけ回す）
  const panel = (batch, x, y, z, w, h, ry, opts = {}) => batch.add(PLANE, M(x, y, z, w, h, 1, ry), opts.color, opts);

  const F = E.FIELD;
  const R = E.ROAD;
  const FR = E.FRONT;
  const L = 75; // 歩道を描く範囲（フィールドの外まで少し続ける）
  const LR = 170; // 車道を描く範囲（遠くへ消えていく）

  const ALL = [
    ...E.BUILDINGS.map((b, i) => ({ ...b, kind: "shop", i })),
    ...E.INFILL.map((b) => ({ ...b, kind: "infill" })),
    ...E.BACKS.map((b) => ({ ...b, kind: "back" })),
  ];
  // 建物のそば・ひさしの下は少し暗く（地面に「なじませる」陰）
  const nearWall = (x, z) => {
    let best = 9;
    for (const b of ALL) {
      const dx = Math.max(b.x - b.w / 2 - x, 0, x - b.x - b.w / 2);
      const dz = Math.max(b.z - b.d / 2 - z, 0, z - b.z - b.d / 2);
      best = Math.min(best, Math.hypot(dx, dz));
    }
    return best;
  };
  const underAwning = (x, z) => E.AWNINGS.some((a) => Math.abs(x - a.x) < a.w / 2 + 0.2 && Math.abs(z - a.z) < a.d / 2 + 0.2);
  const groundShade = (x, y, z) => {
    const w = nearWall(x, z);
    let k = 1 - 0.2 * Math.max(0, 1 - w / 0.9);
    if (underAwning(x, z)) k *= 0.9;
    return k * (0.95 + 0.1 * noise2(x / 5, z / 5));
  };

  // =========================================================
  // 地面・道路・歩道
  // =========================================================

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(700, 700).rotateX(-Math.PI / 2), mat.ground);
  ground.geometry.attributes.uv.array.forEach((v, i, a) => (a[i] = v * 117)); // 6m ごとにくり返し
  ground.receiveShadow = true;
  // 道路・歩道より後に描く → 道路の下に隠れる部分は深度テストで早めに捨てられ、塗る量が減る
  ground.renderOrder = 2;
  ground.name = "ground";
  scene.add(ground);

  // 車道：8m ごとに区切って、場所ごとの色ムラ（頂点カラー）をつける。
  // テクスチャの縦方向は道路の幅（8m）にぴったり合わせてある
  const roadShade = (x, y, z) => 0.9 + 0.16 * noise2(x / 9 + 3, z / 9 + 7);
  const roadStrip = (along, a0, a1) => {
    const cut = [a0];
    for (let t = Math.ceil(a0 / 8) * 8; t < a1; t += 8) if (t > a0 && Math.abs(t) < 60) cut.push(t);
    cut.push(a1);
    for (let k = 0; k + 1 < cut.length; k++) {
      const c = (cut[k] + cut[k + 1]) / 2;
      const len = cut[k + 1] - cut[k];
      if (along === "x") flat(B.road, c, 0, len, 2 * R, 0.02, { scale: [len / 8, 1], shade: roadShade });
      else flat(B.road, 0, c, 2 * R, len, 0.02, { scale: [len / 8, 1], rotate: true, shade: roadShade });
    }
  };
  roadStrip("x", -LR, LR);
  roadStrip("z", -LR, -R);
  roadStrip("z", R, LR);
  // コインパーキングの舗装
  const P = E.PARKING;
  flat(B.road, (P.minX + P.maxX) / 2, (P.minZ + P.maxZ) / 2 - 0.5, P.maxX - P.minX, P.maxZ - P.minZ + 1, 0.02, { scale: [(P.maxX - P.minX) / 8, (P.maxZ - P.minZ + 1) / 8], color: "#d6d3cc", shade: roadShade });

  // 歩道：車道の端(R) から建物の線(FR) まで。幅の方向に4列に分けて、建物ぎわを暗くする
  const CROSS = [R, R + 1.0, FR - 0.9, FR - 0.35, FR];
  const walkStrip = (arm, side) => {
    const cuts = [FR]; // 交差点の角（R〜FR）は下で別に貼る
    for (let t = FR + 6; t < 46; t += 6) cuts.push(t);
    cuts.push(46, L);
    for (let k = 0; k + 1 < cuts.length; k++) {
      for (let c = 0; c + 1 < CROSS.length; c++) {
        const t0 = cuts[k];
        const t1 = cuts[k + 1];
        const o0 = CROSS[c] * side;
        const o1 = CROSS[c + 1] * side;
        // arm に沿った向き（t）と横の向き（o）から x, z を決める
        const P2 = (t, o) => (arm === "E" ? [t, o] : arm === "W" ? [-t, o] : arm === "S" ? [o, t] : [o, -t]);
        const [xa, za] = P2(t0, o0);
        const [xb, zb] = P2(t1, o1);
        const x = (xa + xb) / 2;
        const z = (za + zb) / 2;
        const w = Math.abs(xb - xa);
        const d = Math.abs(zb - za);
        flat(B.walk, x, z, w, d, 0.04, { scale: [w / 3, d / 3], shade: groundShade });
      }
    }
  };
  for (const arm of ["E", "W", "S", "N"]) for (const side of [-1, 1]) walkStrip(arm, side);
  // 交差点の四隅（歩道の角）
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    flat(B.walk, sx * (R + FR) / 2, sz * (R + FR) / 2, FR - R, FR - R, 0.04, { scale: [(FR - R) / 3, (FR - R) / 3], shade: groundShade });
  }

  // 縁石（車道との境目）
  const curbColor = "#cfc9bd";
  for (const s of [-1, 1]) {
    for (const [a, b] of [[-L, -R], [R, L]]) {
      B.props.box((a + b) / 2, 0.07, s * (R + 0.11), b - a, 0.14, 0.22, curbColor);
      B.props.box(s * (R + 0.11), 0.07, (a + b) / 2, 0.22, 0.14, b - a, curbColor);
    }
  }

  // 公園の芝生と小道・植え込み
  flat(B.grass, -27.75, 16, 16.5, 16, 0.03, { scale: [16.5 / 3, 16 / 3] });
  flat(B.walk, -27.75, 16, 1.6, 16, 0.045, { scale: [1.6 / 3, 16 / 3], shade: groundShade });
  flat(B.walk, -27.75, 16, 16.5, 1.6, 0.046, { scale: [16.5 / 3, 1.6 / 3], shade: groundShade });
  for (const [x, z, w, d] of [[-32.6, 8.35, 6.5, 0.6], [-22.9, 8.35, 6.5, 0.6], [-19.8, 13, 0.6, 9], [-19.8, 21.5, 0.6, 5]]) {
    B.foliage.box(x, 0.35, z, w, 0.7, d, "#5c9a55");
  }

  // ---- 道路標示（アトラスの白・黄色・模様を地面に貼る） ----
  const white = { rect: A.white };
  // 横断歩道
  for (const s of [-1, 1]) {
    for (let k = -3; k <= 3; k++) {
      flat(B.decal, k * 1.1, s * (R + 1.4), 0.55, 2.4, 0.05, white);
      flat(B.decal, s * (R + 1.4), k * 1.1, 2.4, 0.55, 0.05, white);
    }
  }
  // 停止線（左側通行：南へ進む車線は x>0、北へ進む車線は x<0）
  flat(B.decal, 2, -(R + 3.1), 3.6, 0.35, 0.05, white);
  flat(B.decal, -2, R + 3.1, 3.6, 0.35, 0.05, white);
  flat(B.decal, -(R + 3.1), -2, 0.35, 3.6, 0.05, white);
  flat(B.decal, R + 3.1, 2, 0.35, 3.6, 0.05, white);
  // 中央線（破線）と外側線
  for (let t = -LR + 2; t < LR; t += 6) {
    if (Math.abs(t) < FR + 2) continue;
    flat(B.decal, t, 0, 3, 0.15, 0.05, white);
    flat(B.decal, 0, t, 0.15, 3, 0.05, white);
  }
  for (const s of [-1, 1]) {
    for (const [a, b] of [[-LR, -FR - 1], [FR + 1, LR]]) {
      flat(B.decal, (a + b) / 2, s * (R - 0.35), b - a, 0.12, 0.05, white);
      flat(B.decal, s * (R - 0.35), (a + b) / 2, 0.12, b - a, 0.05, white);
    }
  }
  // 「止まれ」（南北の道路の、交差点に向かう車線）
  flat(B.decal, 2, -(R + 7), 2.4, 4.2, 0.05, { rect: A.tomare }, Math.PI);
  flat(B.decal, -2, R + 7, 2.4, 4.2, 0.05, { rect: A.tomare });
  // コインパーキングの区画線
  for (let i = 0; i <= P.spaces; i++) {
    const x = P.minX + 0.6 + (i * (P.maxX - P.minX - 1.2)) / P.spaces;
    flat(B.decal, x, P.minZ + 2.6, 0.12, 4.6, 0.05, white);
  }
  // マンホール・排水溝
  for (const [x, z, r] of [[12, 1.8, 0.65], [-20, -2, 0.65], [1.8, 18, 0.65], [-2, -26, 0.65], [6.4, -20, 0.35], [-18, 6.6, 0.35], [26, -6.6, 0.35], [-6.4, 31, 0.35]]) {
    flat(B.decal, x, z, r * 2, r * 2, 0.055, { rect: A.manhole });
  }
  for (let t = -36; t <= 36; t += 9) {
    if (Math.abs(t) < FR + 1) continue;
    for (const s of [-1, 1]) {
      flat(B.decal, t, s * (R - 0.55), 1.2, 0.3, 0.055, { rect: A.drain });
      flat(B.decal, s * (R - 0.55), t + 4, 0.3, 1.2, 0.055, { rect: A.drain, rotate: true });
    }
  }
  // 点字ブロック（横断歩道の前と、歩道の誘導線）
  const tactile = (x, z, w, d) => flat(B.tactile, x, z, w, d, 0.055, { scale: [w / 0.6, d / 0.6] });
  const GUIDE = R + 2.2; // 誘導線の位置（歩く場所の中ほど）
  for (const s of [-1, 1]) {
    tactile(s * (R + 0.45), s * (R + 1.4), 0.6, 2.4);
    tactile(-s * (R + 0.45), s * (R + 1.4), 0.6, 2.4);
    tactile(s * (R + 1.4), s * (R + 0.45), 2.4, 0.6);
    tactile(s * (R + 1.4), -s * (R + 0.45), 2.4, 0.6);
    for (const [a, b] of [[-F, -FR], [FR, F]]) {
      tactile((a + b) / 2, s * GUIDE, b - a, 0.3);
      tactile(s * GUIDE, (a + b) / 2, 0.3, b - a);
    }
  }

  // =========================================================
  // 建物
  // =========================================================

  const FLOOR = 3;
  const col3 = (hex, k = 1) => {
    const c = new THREE.Color(hex);
    return [c.r * k, c.g * k, c.b * k];
  };
  // 外壁の下ほど暗く（地面になじむ陰）。上は空の光で少し明るい
  const wallAO = (y) => (y <= 0 ? 0.7 : y < 3 ? 0.7 + (0.22 * y) / 3 : Math.min(1.02, 0.92 + (0.1 * (y - 3)) / 9));

  // 面の外側すぐの点が、ほかの（同じ高さ以上の）建物の中なら、その面は見えない
  const insideOther = (self, x, z, h) =>
    ALL.some((o) => o !== self && o.h >= h - 0.3 && Math.abs(x - o.x) < o.w / 2 + 0.05 && Math.abs(z - o.z) < o.d / 2 + 0.05);

  // 外壁1面ぶんの四角形を作る。left は面の左下（外から見て）、t は右向き、n は外向き
  //   rows: [{ y0, y1, kind: "tile"|"ground"|"blank", ... }]
  const U = (px) => px / 1024;
  const Vt = (py) => 1 - py / 512;
  function facadeRect(left, t, n, s0, s1, y0, y1, uv, color) {
    const p = (s, y) => [left[0] + t[0] * s, y, left[1] + t[1] * s];
    const c0 = color.map((v) => v * wallAO(y0));
    const c1 = color.map((v) => v * wallAO(y1));
    B.facade.quad(p(s0, y0), p(s1, y0), p(s1, y1), p(s0, y1), [n[0], 0, n[1]], uv, [c0, c0, c1, c1]);
  }
  // 周期 period ごとに区切る（テクスチャを繰り返す代わりに、四角形を分ける）
  function spans(length, period, offset) {
    const out = [];
    let a = 0;
    while (a < length - 1e-6) {
      const tp = (a + offset) % period;
      const b = Math.min(length, a + (period - tp));
      out.push([a, b, tp]);
      a = b;
    }
    return out;
  }
  function facadeFace(b, f, rowsFrom, groundKind, blank, styleIdx, color) {
    const { left, t, n, W } = f;
    const H = b.h;
    const flip = rnd() < 0.5;
    const offU = rnd() < 0.5 ? 0 : 3;
    const offV = [0, 3, 6][Math.floor(rnd() * 3)];
    const groundColor = color.map((v) => v * 0.45 + 0.55);
    if (blank) {
      // 窓のない壁：6m ごとに、窓なしの柄を縦に引きのばして貼る（雨だれのしみになる）
      // 窓のない壁：窓なしの柄（高さ3m）を、6m×6m ごとに少し引きのばして貼る
      const gx = 3 * 256;
      for (const [a, c, tp] of spans(W, 6, offU)) {
        const u0 = U(gx + tp * PX);
        const u1 = U(gx + (tp + (c - a)) * PX);
        for (const [ya, yb, tv] of spans(H, 6, 0)) {
          const v0 = Vt(510 - (tv / 6) * 124);
          const v1 = Vt(510 - ((tv + yb - ya) / 6) * 124);
          facadeRect(left, t, n, a, c, ya, yb, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], color);
        }
      }
      return;
    }
    // 1階（お店の正面は看板パネルで隠れるので作らない）
    if (rowsFrom > 0 && groundKind) {
      const gi = GROUND_KINDS.indexOf(groundKind);
      for (const [a, c, tp] of spans(W, 6, offU)) {
        const u0 = U(gi * 256 + tp * PX);
        const u1 = U(gi * 256 + (tp + (c - a)) * PX);
        facadeRect(left, t, n, a, c, 0, FLOOR, [[u0, Vt(511)], [u1, Vt(511)], [u1, Vt(384)], [u0, Vt(384)]], groundColor);
      }
    }
    // 窓の階：屋上の手前で区切り、残りは窓のない帯にする（窓が屋根で切れないように）
    const floors = Math.max(0, Math.floor((H - rowsFrom - 0.6) / FLOOR));
    const top = rowsFrom + floors * FLOOR;
    for (const [a, c, tp] of spans(W, 6, offU)) {
      for (const [ya, yb, tv] of spans(top - rowsFrom, 9, offV)) {
        let ua = tp;
        let ub = tp + (c - a);
        if (flip) {
          ua = 6 - ua;
          ub = 6 - ub;
        }
        const u0 = U(styleIdx * 256 + ua * PX);
        const u1 = U(styleIdx * 256 + ub * PX);
        const v0 = Vt(384 - tv * PX);
        const v1 = Vt(384 - (tv + (yb - ya)) * PX);
        facadeRect(left, t, n, a, c, rowsFrom + ya, rowsFrom + yb, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], color);
      }
      if (H - top > 0.01) {
        const gx = 3 * 256;
        facadeRect(left, t, n, a, c, top, H, [[U(gx + tp * PX), Vt(420)], [U(gx + (tp + c - a) * PX), Vt(420)], [U(gx + (tp + c - a) * PX), Vt(390)], [U(gx + tp * PX), Vt(390)]], color);
      }
    }
  }

  // 建物1棟の4面のうち、見える面だけ返す
  function facesOf(b) {
    const list = [
      { n: [1, 0], c: [b.x + b.w / 2, b.z], W: b.d },
      { n: [-1, 0], c: [b.x - b.w / 2, b.z], W: b.d },
      { n: [0, 1], c: [b.x, b.z + b.d / 2], W: b.w },
      { n: [0, -1], c: [b.x, b.z - b.d / 2], W: b.w },
    ];
    const out = [];
    for (const f of list) {
      const t = [f.n[1], -f.n[0]]; // 外から見て右向き
      f.t = t;
      f.left = [f.c[0] - (t[0] * f.W) / 2, f.c[1] - (t[1] * f.W) / 2];
      // 街の外側を向いていて、カメラが回り込めない面
      if (f.n[0] * f.c[0] > 46 || f.n[1] * f.c[1] > 46) continue;
      let hidden = true;
      for (let k = 0; k < 5 && hidden; k++) {
        const s = ((k + 0.5) / 5) * f.W;
        hidden = insideOther(b, f.left[0] + t[0] * s + f.n[0] * 0.3, f.left[1] + t[1] * s + f.n[1] * 0.3, b.h);
      }
      if (!hidden) out.push(f);
    }
    return out;
  }

  // 屋上：床・手すり壁・設備
  function roof(b, trim, opts = {}) {
    flat(B.props, b.x, b.z, b.w, b.d, b.h + 0.02, { color: shade("#a39f97", (rnd() - 0.5) * 0.12) });
    const ph = opts.low ? 0.45 : 0.75;
    for (const [px, pz, w, d] of [
      [b.x, b.z + b.d / 2 - 0.1, b.w, 0.2],
      [b.x, b.z - b.d / 2 + 0.1, b.w, 0.2],
      [b.x + b.w / 2 - 0.1, b.z, 0.2, b.d - 0.4],
      [b.x - b.w / 2 + 0.1, b.z, 0.2, b.d - 0.4],
    ]) {
      B.props.box(px, b.h + ph / 2, pz, w, ph, d, trim);
    }
    // 室外機・給水タンク・塔屋・アンテナ（影は落とさない＝detail）
    const n = opts.few ? 1 : 2;
    for (let k = 0; k < n; k++) B.detail.box(b.x + (rnd() - 0.5) * b.w * 0.5, b.h + 0.4, b.z + (rnd() - 0.5) * b.d * 0.5, 1.1, 0.8, 0.8, "#dedcd5");
    if ((b.style === "apartment" || b.style === "old") && rnd() < 0.7) {
      const wx = b.x + b.w * 0.22;
      const wz = b.z - b.d * 0.2;
      B.detail.box(wx, b.h + 0.5, wz, 1.4, 1.0, 1.4, "#8f949c");
      B.detail.add(CYL, M(wx, b.h + 1.6, wz, 1.8, 1.3, 1.8), "#c4cfd8");
    }
    if (b.h >= 12) B.props.box(b.x - b.w * 0.2, b.h + 1.25, b.z + b.d * 0.15, Math.min(4, b.w * 0.32), 2.5, Math.min(4, b.d * 0.3), shade(b.color, -0.06));
    if (rnd() < 0.6) B.detail.add(POST, M(b.x + b.w * 0.3, b.h + 2, b.z + b.d * 0.3, 0.06, 4, 0.06), "#8f949c");
  }

  // ---- お店の入った建物・すき間を埋める建物・裏の建物 ----
  const awningData = [];
  for (const b of ALL) {
    const styleIdx = FACADE_STYLES.indexOf(b.style);
    const color = col3(b.color, 0.97 + rnd() * 0.06);
    const trim = shade(b.color, -0.2);
    const faces = facesOf(b);
    const front = b.face ? (b.face === "x" ? [-Math.sign(b.x), 0] : [0, -Math.sign(b.z)]) : null;
    const isFront = (f) => front && f.n[0] === front[0] && f.n[1] === front[1];

    for (const f of faces) {
      // 道路に面した横の面（角の建物）は、窓のない壁にしない
      const street = (f.n[0] && f.n[0] === -Math.sign(f.c[0]) && Math.abs(f.c[0]) <= FR + 0.5) || (f.n[1] && f.n[1] === -Math.sign(f.c[1]) && Math.abs(f.c[1]) <= FR + 0.5);
      if (isFront(f)) {
        if (b.kind === "shop") facadeFace(b, f, FLOOR, null, false, styleIdx, color);
        else facadeFace(b, f, FLOOR, b.ground, false, styleIdx, color);
      } else if (street) {
        facadeFace(b, f, FLOOR, b.ground || "lobby", false, styleIdx, color);
      } else {
        const blank = rnd() < (b.kind === "back" ? 0.3 : 0.45);
        facadeFace(b, f, 0, null, blank, styleIdx, color);
      }
    }
    roof(b, trim, { few: b.kind !== "shop", low: b.kind === "back" && b.h < 14 });

    // 階の境目の出っ張り（オフィス・雑居ビル。道路から見える建物だけ）
    if (b.kind !== "back" && (b.style === "office" || b.style === "mixed")) {
      for (let y = FLOOR * 2; y < b.h - 1; y += FLOOR * (b.style === "office" ? 1 : 2)) {
        B.props.box(b.x, y, b.z, b.w + 0.14, 0.12, b.d + 0.14, shade(b.color, -0.08), 0, 0, 0, BOX6);
      }
    }

    if (!front) continue;
    const nx = front[0];
    const nz = front[1];
    const ry = Math.atan2(nx, nz); // 正面の向き
    const tx = nz; // 正面に沿った右向き
    const tz = -nx;
    const frontW = nx ? b.d : b.w;
    const fx = b.x + (nx * b.w) / 2; // 正面の中心
    const fz = b.z + (nz * b.d) / 2;

    // ベランダ（マンション）：2階以上の正面。床・すりガラスの手すり・室外機
    if (b.style === "apartment") {
      for (let y = FLOOR * 2; y < b.h - 1.5; y += FLOOR) {
        const bw = frontW * 0.9;
        B.props.box(fx + nx * 0.5, y - 0.05, fz + nz * 0.5, nx ? 1.0 : bw, 0.14, nz ? 1.0 : bw, "#e3dfd7", 0, 0, 0, BOX6);
        B.props.box(fx + nx * 0.98, y + 0.5, fz + nz * 0.98, nx ? 0.05 : bw, 0.95, nz ? 0.05 : bw, "#d9e2e8", 0, 0, 0, BOX6);
        const off = frontW * 0.3 * (rnd() < 0.5 ? -1 : 1);
        B.detail.box(fx + nx * 0.55 + tx * off, y + 0.35, fz + nz * 0.55 + tz * off, nx ? 0.35 : 0.7, 0.55, nz ? 0.35 : 0.7, "#e9e7e0");
      }
    }

    // 横の壁：配管と室外機（見えている横の面だけ）
    const side = faces.find((f) => f.n[0] === tx && f.n[1] === tz) || faces.find((f) => f.n[0] === -tx && f.n[1] === -tz);
    if (side) {
      const sx = side.n[0];
      const sz = side.n[1];
      const sideW = sx ? b.w : b.d;
      const cx = b.x + (sx * b.w) / 2;
      const cz = b.z + (sz * b.d) / 2;
      const along = (sideW / 2 - 0.5) * (rnd() < 0.5 ? 1 : -1);
      B.detail.add(POST, M(cx + sx * 0.1 + nx * along, b.h / 2, cz + sz * 0.1 + nz * along, 0.13, b.h, 0.13), "#c9c3b9");
      if (b.style !== "office") {
        for (let y = FLOOR + 1; y < b.h - 2; y += FLOOR * 1.5) {
          const k = (rnd() - 0.5) * sideW * 0.6;
          B.detail.box(cx + sx * 0.28 + nx * k, y, cz + sz * 0.28 + nz * k, sx ? 0.48 : 0.72, 0.52, sz ? 0.48 : 0.72, "#e8e6df");
        }
      }
    }

    if (b.kind !== "shop") continue;
    const i = b.i;
    // 1階：お店の正面（少し光る）・両わきの柱・上の帯・入口の段差
    panel(B.sign, fx + nx * 0.03, 1.55, fz + nz * 0.03, frontW * 0.92, 3.1, ry, { rect: A.shop[b.shop] });
    for (const s of [-1, 1]) {
      const k = (frontW / 2 - 0.2) * s;
      B.props.box(fx + tx * k + nx * 0.06, 1.55, fz + tz * k + nz * 0.06, nx ? 0.14 : 0.4, 3.1, nz ? 0.14 : 0.4, shade(b.color, -0.12));
    }
    B.props.box(fx + nx * 0.06, 3.35, fz + nz * 0.06, nx ? 0.12 : frontW, 0.5, nz ? 0.12 : frontW, trim, 0, 0, 0, BOX6);
    B.detail.box(fx + nx * 0.35, 0.06, fz + nz * 0.35, nx ? 0.7 : 2.2, 0.12, nz ? 0.7 : 2.2, "#b7b0a4");

    // 屋上看板（正面向き、枠つき）
    if (A.roof[b.shop]) {
      const w = Math.min(frontW * 0.8, 7.5);
      const h = 2.2;
      const cx = fx - nx * 1.2;
      const cz = fz - nz * 1.2;
      panel(B.sign, cx + nx * 0.07, b.h + 1.5 + h / 2, cz + nz * 0.07, w, h, ry, { rect: A.roof[b.shop] });
      B.props.box(cx, b.h + 1.5 + h / 2, cz, nx ? 0.1 : w + 0.2, h + 0.2, nz ? 0.1 : w + 0.2, "#454852", 0, 0, 0, BOX6);
      for (const k of [-0.4, 0.4]) B.detail.box(cx + tx * w * k, b.h + 0.75, cz + tz * w * k, 0.12, 1.5, 0.12, "#6b6f78");
    }

    // 袖看板（壁から突き出した縦の看板）
    if (b.h > 8) {
      const k = frontW / 2 - 0.9;
      const sd = i % 2 ? 1 : -1;
      const cx = fx + nx * 0.6 + tx * k * sd;
      const cz = fz + nz * 0.6 + tz * k * sd;
      const y = 4.2 + 1.4;
      B.props.box(cx, y, cz, nx ? 0.9 : 0.18, 2.9, nz ? 0.9 : 0.18, "#3b3d45", 0, 0, 0, BOX6);
      // 文字の面は、道を行き来する人から見える向き（±正面に沿った向き）
      panel(B.sign, cx + tx * 0.1, y, cz + tz * 0.1, 0.78, 2.7, ry + Math.PI / 2, { rect: A.vsign[b.shop] });
      panel(B.sign, cx - tx * 0.1, y, cz - tz * 0.1, 0.78, 2.7, ry - Math.PI / 2, { rect: A.vsign[b.shop] });
    }

    const aw = E.AWNINGS[i];
    awningData.push({ data: aw, color: SIGN_COLORS[i % SIGN_COLORS.length], rot: [nz * 0.22, 0, -nx * 0.22] });
  }

  // ---- ひさし：1つの InstancedMesh（描画1回）。真下に入ったものだけ、半透明の別メッシュに差し替える ----
  const awnings = (() => {
    const n = awningData.length;
    const geo = new THREE.BoxGeometry(1, 0.12, 1);
    const inst = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial(), n);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const matrices = awningData.map((a) => {
      e.set(a.rot[0], a.rot[1], a.rot[2]);
      q.setFromEuler(e);
      return new THREE.Matrix4().compose(V(a.data.x, a.data.y, a.data.z), q, V(a.data.w, 1, a.data.d));
    });
    const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
    awningData.forEach((a, k) => {
      inst.setMatrixAt(k, matrices[k]);
      inst.setColorAt(k, new THREE.Color(a.color));
    });
    inst.name = "awnings";
    inst.frustumCulled = false; // 13個の小さな箱なので、まとめて描く
    scene.add(inst);
    // 半透明の差し替え用（同時に2つまで：角のお店で2つのひさしに近いとき）
    const pool = [0, 1].map(() => {
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ transparent: true, depthWrite: false }));
      mesh.visible = false;
      mesh.matrixAutoUpdate = false;
      mesh.name = "awning-fade";
      scene.add(mesh);
      return { mesh, owner: -1 };
    });
    const opacity = awningData.map(() => 1);
    const slotOf = (k) => (pool[0].owner === k ? pool[0] : pool[1].owner === k ? pool[1] : null);
    return {
      // 毎フレーム呼ぶ（メモリを新しく確保しないように、ふつうのループで書く）
      update(px, pz, dt) {
        let changed = false;
        for (let k = 0; k < n; k++) {
          const d = awningData[k].data;
          const near = Math.abs(px - d.x) < d.w / 2 + 1.2 && Math.abs(pz - d.z) < d.d / 2 + 1.2;
          const target = near ? 0.22 : 1;
          opacity[k] += (target - opacity[k]) * Math.min(1, dt * 8);
          let slot = slotOf(k);
          if (target === 1 && opacity[k] > 0.985) {
            opacity[k] = 1;
            if (slot) {
              slot.owner = -1;
              slot.mesh.visible = false;
              inst.setMatrixAt(k, matrices[k]);
              changed = true;
            }
            continue;
          }
          if (!slot) {
            slot = pool[0].owner === -1 ? pool[0] : pool[1].owner === -1 ? pool[1] : null;
            if (!slot) continue; // 3つ以上は不透明のまま（ふつうは起きない）
            slot.owner = k;
            slot.mesh.matrix.copy(matrices[k]);
            slot.mesh.matrixWorldNeedsUpdate = true;
            slot.mesh.material.color.set(awningData[k].color);
            slot.mesh.visible = true;
            inst.setMatrixAt(k, ZERO);
            changed = true;
          }
          slot.mesh.material.opacity = opacity[k];
        }
        if (changed) inst.instanceMatrix.needsUpdate = true;
      },
      // 起動時にシェーダーを用意しておくため、差し替え用も一度だけ見える状態にする
      setPreview(on) {
        for (const p of pool) if (p.owner === -1) p.mesh.visible = on;
      },
      opacityOf: (k) => opacity[k],
    };
  })();

  // =========================================================
  // 小物
  // =========================================================

  const props = E.PROPS;
  const of = (kind) => props.filter((p) => p.kind === kind);
  // 車道側の向き（車道寄りの小物の「前」）
  const towardRoad = (p) => (Math.abs(p.x) > Math.abs(p.z) ? [0, -Math.sign(p.z)] : [-Math.sign(p.x), 0]);

  // 街灯：細い柱＋道路側へ伸びる腕＋光る笠。足元に光だまり
  for (const p of of("lamp")) {
    const tw = towardRoad(p);
    B.props.add(POST, M(p.x, 2.6, p.z, 0.13, 5.2, 0.13), "#5a6070");
    B.detail.add(CYL, M(p.x, 0.15, p.z, 0.28, 0.3, 0.28), "#4a4f5f");
    const hx = p.x + tw[0] * 0.9;
    const hz = p.z + tw[1] * 0.9;
    B.props.box((p.x + hx) / 2, 5.15, (p.z + hz) / 2, tw[0] ? 1.0 : 0.08, 0.08, tw[1] ? 1.0 : 0.08, "#5a6070", 0, 0, 0, BOX6);
    B.props.box(hx, 5.05, hz, 0.6, 0.16, 0.36, "#3f4352", tw[0] ? Math.PI / 2 : 0, 0, 0, BOX6);
    B.glow.box(hx, 4.96, hz, 0.46, 0.04, 0.26, "#fff1c4", tw[0] ? Math.PI / 2 : 0, 0, 0, BOX6);
    flat(B.pool, p.x + tw[0] * 0.4, p.z + tw[1] * 0.4, 4.2, 4.2, 0.07);
  }

  // 木：先細りの幹＋もこもこの葉（3つの塊）。葉は模様つき。街路樹は根元に鉄の格子
  const greens = ["#5b9f55", "#67ad5d", "#4e8f4c", "#74b566"];
  // 街路樹は高く刈り込まれていて、葉はカメラの高さより上（歩道を歩くとき、カメラが葉に埋もれない）
  of("tree").forEach((p, i) => {
    const s = 0.92 + ((i * 37) % 10) / 40;
    const base = p.park ? 2.6 : 4.3; // 葉の下の高さ
    B.props.add(CONE_TRUNK, M(p.x, (base + 0.6) / 2, p.z, 0.32, base + 0.6, 0.32), "#7d5a40");
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + i;
      const r = 0.55 * s;
      B.foliage.add(BLOB, M(p.x + Math.cos(a) * r, base + (0.9 + (k === 0 ? 0.55 : 0)) * s, p.z + Math.sin(a) * r, 1.2 * s, 0.95 * s, 1.2 * s, a), greens[(i + k) % greens.length], { scale: [2.2, 2.2] });
    }
    if (!p.park) flat(B.decal, p.x, p.z, 1.2, 1.2, 0.06, { rect: A.grate });
  });

  // 自動販売機：本体＋光る正面＋屋根のひさし
  const VEND_RY = [Math.PI, Math.PI / 2, 0, -Math.PI / 2];
  of("vending").forEach((p, i) => {
    const ry = VEND_RY[p.rot];
    const fx = Math.sin(ry);
    const fz = Math.cos(ry);
    const body = ["#d8423a", "#2f68a8", "#efefea", "#2a9050", "#d8423a"][i % 5];
    B.props.box(p.x, 0.92, p.z, p.w, 1.84, p.d, body, ry);
    B.detail.box(p.x + fx * 0.06, 1.88, p.z + fz * 0.06, p.w + 0.06, 0.08, p.d + 0.14, shade(body, -0.25), ry, 0, 0, BOX6);
    panel(B.sign, p.x + fx * (p.d / 2 + 0.012), 0.98, p.z + fz * (p.d / 2 + 0.012), p.w * 0.9, 1.6, ry, { rect: A.vending });
  });

  // 立て看板（A型）
  of("signboard").forEach((p) => {
    const ry = Math.abs(p.z) < Math.abs(p.x) ? Math.PI / 2 : 0;
    for (const s of [-1, 1]) {
      const ox = Math.sin(ry) * 0.12 * s;
      const oz = Math.cos(ry) * 0.12 * s;
      B.detail.box(p.x + ox, 0.55, p.z + oz, 0.84, 1.1, 0.05, "#3b3d45", ry, 0.2 * s, 0, BOX6);
      panel(B.sign, p.x + ox * 1.35, 0.6, p.z + oz * 1.35, 0.72, 0.92, ry + (s < 0 ? Math.PI : 0), { rect: A.board[p.text] });
    }
  });

  // 電柱：コンクリートの柱・腕金・変圧器。電線でつなぐ
  const poles = of("pole");
  poles.forEach((p, i) => {
    const alongX = Math.abs(p.z) < Math.abs(p.x); // 東西の道路沿い
    B.props.add(CYL, M(p.x, 4.6, p.z, 0.34, 9.2, 0.34), "#b9b4ab");
    B.props.box(p.x, 8.4, p.z, alongX ? 0.12 : 1.6, 0.1, alongX ? 1.6 : 0.12, "#7d7a74", 0, 0, 0, BOX6);
    B.detail.box(p.x, 7.7, p.z, alongX ? 0.1 : 1.2, 0.08, alongX ? 1.2 : 0.1, "#7d7a74", 0, 0, 0, BOX6);
    const back = towardRoad(p).map((v) => -v); // 歩道側
    if (i % 3 === 0) B.props.add(CYL, M(p.x + back[0] * 0.35, 6.6, p.z + back[1] * 0.35, 0.5, 0.9, 0.5), "#8b919a");
    // 黄色と黒の巻き付け（足元）
    B.detail.add(POST, M(p.x, 1.2, p.z, 0.36, 1.6, 0.36), "#e9bd1d");
  });
  // 電線（電柱の列ごと＋道路をまたぐ線＋電柱から建物への引き込み線）。線は全部で1回の描画
  const wirePts = [];
  const sagLine = (a, b, sag, segs = 8) => {
    let prev = null;
    for (let k = 0; k <= segs; k++) {
      const t = k / segs;
      const pt = new THREE.Vector3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t), a.z + (b.z - a.z) * t);
      if (prev) wirePts.push(prev, pt);
      prev = pt;
    }
  };
  const byLine = {};
  poles.forEach((p) => (byLine[p.line] = byLine[p.line] || []).push(p));
  for (const line in byLine) {
    const list = byLine[line].sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
    const alongX = Math.abs(list[0].z) < Math.abs(list[0].x);
    // 区画の端（フィールドの外）まで続ける
    const last = list[list.length - 1];
    const ext = { x: alongX ? Math.sign(last.x) * 52 : last.x, z: alongX ? last.z : Math.sign(last.z) * 52 };
    const chain = [...list, ext];
    for (let k = 0; k + 1 < chain.length; k++) {
      const a = chain[k];
      const b = chain[k + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      for (const [h, o] of [[8.45, -0.65], [8.45, 0.65], [7.75, 0]]) {
        const ox = alongX ? 0 : o;
        const oz = alongX ? o : 0;
        sagLine(V(a.x + ox, h, a.z + oz), V(b.x + ox, h, b.z + oz), len * 0.03);
      }
    }
  }
  // 道路をまたぐ線（t=16 の電柱どうし）
  const poleAt = (x, z) => poles.find((p) => Math.abs(p.x - x) < 0.01 && Math.abs(p.z - z) < 0.01);
  for (const t of [-16, 16]) {
    for (const [a, b] of [[poleAt(t, -E.CURB), poleAt(t, E.CURB)], [poleAt(-E.CURB, t), poleAt(E.CURB, t)]]) {
      if (a && b) sagLine(V(a.x, 8.2, a.z), V(b.x, 8.2, b.z), 0.3);
    }
  }
  // 引き込み線：電柱から、歩道の向こうの建物の壁へ
  poles.forEach((p, i) => {
    const back = towardRoad(p).map((v) => -v);
    for (const d of [-1.6, 1.8]) {
      if ((i + (d > 0 ? 1 : 0)) % 2) continue;
      const tx = back[1] !== 0 ? 1 : 0;
      const tz = back[0] !== 0 ? 1 : 0;
      const end = V(p.x + back[0] * (FR - E.CURB) + tx * d, 6.2, p.z + back[1] * (FR - E.CURB) + tz * d);
      const hitWall = ALL.some((b) => Math.abs(end.x - b.x) <= b.w / 2 + 0.05 && Math.abs(end.z - b.z) <= b.d / 2 + 0.05);
      if (hitWall) sagLine(V(p.x, 7.7, p.z), end, 0.35, 6);
    }
  });
  const wires = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(wirePts), new THREE.LineBasicMaterial({ color: "#2b2b33" }));
  wires.name = "wires";
  wires.matrixAutoUpdate = false;
  scene.add(wires);

  // 郵便ポスト（赤くて丸い）
  for (const p of of("mailbox")) {
    B.detail.add(CYL, M(p.x, 0.6, p.z, 0.5, 1.2, 0.5), "#cf2a1e");
    B.detail.add(DOME, M(p.x, 1.2, p.z, 0.54, 0.38, 0.54), "#b9231a");
    const tw = towardRoad(p).map((v) => -v);
    B.detail.box(p.x + tw[0] * 0.25, 1.0, p.z + tw[1] * 0.25, tw[0] ? 0.04 : 0.28, 0.05, tw[1] ? 0.04 : 0.28, "#2b2b33", 0, 0, 0, BOX6);
  }
  // ゴミ箱（缶・ペットボトル）
  of("bin").forEach((p, i) => {
    B.detail.add(CYL, M(p.x, 0.42, p.z, 0.46, 0.84, 0.46), i % 2 ? "#2f68a8" : "#7f8792");
    B.detail.add(CYL, M(p.x, 0.86, p.z, 0.48, 0.05, 0.48), "#3b3d45");
  });
  // 自転車：タイヤ・フレーム・サドル・ハンドル・かご（壁に向かって並べる）
  const BIKE_COLORS = ["#d8423a", "#efefea", "#2a9083", "#e3a72f", "#5a6fd1", "#c93f74"];
  of("bikes").forEach((p, gi) => {
    const dirX = -Math.sign(p.x); // 前輪は建物側
    for (let k = 0; k < p.count; k++) {
      const z = p.z - p.d / 2 + 0.3 + (k * (p.d - 0.6)) / (p.count - 1);
      const x = p.x;
      const c = BIKE_COLORS[(gi * 3 + k) % BIKE_COLORS.length];
      const w1 = V(x - dirX * 0.5, 0.33, z);
      const w2 = V(x + dirX * 0.5, 0.33, z);
      B.detail.add(TORUS, M(w1.x, w1.y, z, 0.3, 0.3, 0.3), "#2b2b33");
      B.detail.add(TORUS, M(w2.x, w2.y, z, 0.3, 0.3, 0.3), "#2b2b33");
      const pedal = V(x - dirX * 0.05, 0.36, z);
      const seat = V(x - dirX * 0.2, 0.85, z);
      const head = V(x + dirX * 0.38, 0.9, z);
      B.detail.rod(w1, seat, 0.025, c);
      B.detail.rod(pedal, seat, 0.025, c);
      B.detail.rod(pedal, head, 0.025, c);
      B.detail.rod(head, w2, 0.025, c);
      B.detail.box(seat.x, seat.y + 0.04, z, 0.24, 0.06, 0.12, "#2b2b33", 0, 0, 0, BOX6);
      B.detail.box(head.x, head.y + 0.08, z, 0.06, 0.04, 0.5, "#8f949c", 0, 0, 0, BOX6);
      B.detail.box(head.x + dirX * 0.18, head.y - 0.05, z, 0.28, 0.2, 0.3, "#8f949c", 0, 0, 0, BOX6);
    }
  });
  // ガードレール：白い支柱＋2本の横棒
  for (const p of of("guardrail")) {
    const len = p.along === "x" ? p.w : p.d;
    for (let t = -len / 2; t <= len / 2 + 0.01; t += 1.8) {
      B.detail.add(POST, M(p.x + (p.along === "x" ? t : 0), 0.4, p.z + (p.along === "x" ? 0 : t), 0.08, 0.8, 0.08), "#efefea");
    }
    for (const y of [0.45, 0.75]) {
      B.detail.box(p.x, y, p.z, p.along === "x" ? len : 0.06, 0.07, p.along === "x" ? 0.06 : len, "#efefea", 0, 0, 0, BOX6);
    }
  }
  // カーブミラー：オレンジの柱＋丸い鏡（交差点のほうを向く）
  for (const p of of("mirror")) {
    const ry = Math.atan2(-p.x, -p.z);
    B.detail.add(POST, M(p.x, 1.4, p.z, 0.09, 2.8, 0.09), "#e8862a");
    B.detail.add(TORUS, M(p.x - Math.sin(ry) * 0.05, 2.9, p.z - Math.cos(ry) * 0.05, 0.38, 0.38, 0.6, ry), "#e8862a");
    B.glow.add(CYL, M(p.x, 2.9, p.z, 0.72, 0.04, 0.72, ry, Math.PI / 2), "#cfe3ee");
  }
  // 消火器ボックス
  for (const p of of("hydrant")) {
    const turned = p.w < p.d;
    B.detail.box(p.x, 0.45, p.z, p.w, 0.9, p.d, "#cc2a2a");
    const fx = turned ? -Math.sign(p.x) : 0;
    const fz = turned ? 0 : -Math.sign(p.z);
    panel(B.sign, p.x + fx * (Math.min(p.w, p.d) / 2 + 0.01), 0.7, p.z + fz * (Math.min(p.w, p.d) / 2 + 0.01), 0.4, 0.2, Math.atan2(fx, fz), { rect: A.extinguisher });
  }
  // 植木鉢
  of("planter").forEach((p, i) => {
    B.detail.add(CYL, M(p.x, 0.25, p.z, 0.56, 0.5, 0.56), "#a8603b");
    B.foliage.add(BLOB0, M(p.x, 0.72, p.z, 0.36, 0.4, 0.36, i), greens[i % greens.length], { scale: [1.5, 1.5] });
    if (i % 2) B.glow.add(SPH, M(p.x + 0.12, 0.9, p.z, 0.12, 0.12, 0.12), "#ff9ab0");
  });
  // ベンチ
  for (const p of of("bench")) {
    for (let k = 0; k < 3; k++) B.detail.box(p.x, 0.46, p.z - 0.18 + k * 0.17, p.w, 0.05, 0.13, "#a8774a", 0, 0, 0, BOX6);
    B.detail.box(p.x, 0.75, p.z + 0.27, p.w, 0.28, 0.05, "#a8774a", 0, 0, 0, BOX6);
    for (const s of [-1, 1]) B.detail.box(p.x + s * (p.w / 2 - 0.15), 0.25, p.z, 0.08, 0.5, 0.5, "#4a4d57");
  }
  // 道路標識（向かってくる車から見える向き）
  for (const p of of("signpost")) {
    // 標識は南北の道路の左側（左側通行）。x>0 は南へ走る車線なので北を向ける
    const ry = p.x > 0 ? Math.PI : 0;
    B.detail.add(POST, M(p.x, 1.3, p.z, 0.07, 2.6, 0.07), "#9aa0a8");
    const rect = A[p.sign === "stop" ? "stop" : p.sign === "crossing" ? "crossing" : "speed"];
    panel(B.sign, p.x + Math.sin(ry) * 0.05, 2.55, p.z + Math.cos(ry) * 0.05, 0.75, 0.75, ry, { rect });
    panel(B.detail, p.x + Math.sin(ry) * 0.04, 2.55, p.z + Math.cos(ry) * 0.04, 0.7, 0.7, ry + Math.PI, { color: "#9aa0a8" });
  }
  // コインパーキング：柵・車止め・精算機・P看板
  for (const p of of("fence")) {
    const alongX = p.w > p.d;
    const len = alongX ? p.w : p.d;
    for (let t = -len / 2; t <= len / 2 + 0.01; t += 2) {
      B.detail.add(POST, M(p.x + (alongX ? t : 0), 0.6, p.z + (alongX ? 0 : t), 0.07, 1.2, 0.07), "#8f949c");
    }
    for (const y of [0.4, 1.15]) B.detail.box(p.x, y, p.z, alongX ? len : 0.05, 0.05, alongX ? 0.05 : len, "#8f949c", 0, 0, 0, BOX6);
  }
  for (let i = 0; i < P.spaces; i++) {
    const x = P.minX + 0.6 + ((i + 0.5) * (P.maxX - P.minX - 1.2)) / P.spaces;
    B.detail.box(x, 0.07, P.minZ + 1.0, 1.2, 0.14, 0.18, "#e9e6df");
    B.detail.box(x, 0.03, P.minZ + 3.4, 0.9, 0.06, 0.6, "#5b5f69"); // ロック板
  }
  for (const p of of("meter")) {
    B.detail.box(p.x, 0.65, p.z, 0.42, 1.3, 0.32, "#5b6b84");
    B.detail.box(p.x, 1.32, p.z, 0.46, 0.08, 0.36, "#e9bd1d", 0, 0, 0, BOX6);
    B.glow.box(p.x, 1.0, p.z + 0.17, 0.26, 0.16, 0.01, "#9fe8ff", 0, 0, 0, BOX6);
  }
  for (const p of of("psign")) {
    B.detail.add(POST, M(p.x, 1.7, p.z, 0.12, 3.4, 0.12), "#8f949c");
    panel(B.sign, p.x, 3.5, p.z + 0.05, 1.1, 1.1, 0, { rect: A.parking });
    panel(B.sign, p.x, 3.5, p.z - 0.05, 1.1, 1.1, Math.PI, { rect: A.parking });
    panel(B.sign, p.x, 2.7, p.z + 0.05, 0.6, 0.38, 0, { rect: A.vacant });
  }

  // 道路の行き止まり（フィールドの端）のバリケード
  for (const [x, z, alongX] of [[F + 0.4, 0, false], [-F - 0.4, 0, false], [0, F + 0.4, true], [0, -F - 0.4, true]]) {
    for (let t = -3; t <= 3; t += 2) {
      const cx = x + (alongX ? t : 0);
      const cz = z + (alongX ? 0 : t);
      for (const s of [-0.7, 0.7]) B.detail.add(POST, M(cx + (alongX ? s : 0), 0.5, cz + (alongX ? 0 : s), 0.08, 1.0, 0.08), "#e9e6df");
      panel(B.sign, cx, 0.85, cz, 1.6, 0.36, alongX ? 0 : Math.PI / 2, { rect: A.hazard });
      panel(B.sign, cx, 0.85, cz, 1.6, 0.36, alongX ? Math.PI : -Math.PI / 2, { rect: A.hazard });
    }
  }

  // =========================================================
  // 遠景：歩けない外側にも街が続いて見えるように
  // =========================================================

  const farColors = ["#c3c6cc", "#d2cbc0", "#b7bec8", "#cfc3bd", "#c2cbc5", "#d8d0c3", "#aab2bd", "#bfb6aa"];
  let farCount = 0;
  let farFaces = 0;
  // 箱の5面（4つの壁＋屋上）のうち、フィールドの中から見える面だけ置く
  const farBox = (x, z, w, d, h, c, y0 = 0, winScale = 6) => {
    for (const [px, pz, fw, rot, nx, nz] of [[x + w / 2, z, d, Math.PI / 2, 1, 0], [x - w / 2, z, d, -Math.PI / 2, -1, 0], [x, z + d / 2, w, 0, 0, 1], [x, z - d / 2, w, Math.PI, 0, -1]]) {
      if (nx * px > 46 || nz * pz > 46) continue; // 外側を向いた面は、どこからも見えない
      B.far.add(PLANE, M(px, y0 + h / 2, pz, fw, h, 1, rot), c, { scale: [fw / winScale, h / winScale], shade: (sx, sy) => 0.8 + 0.2 * Math.min(1, sy / 12) });
      farFaces++;
    }
    B.far.add(FLAT, M(x, y0 + h, z, w, 1, d), shade(c, -0.15), { fixedUV: [0.01, 0.99] });
    farFaces++;
  };
  // 道路の先にも建物が並び、通りがそのまま続いて見える（近いほうは外壁アトラス、遠いほうは軽い柄）
  for (const arm of ["E", "W", "S", "N"]) {
    for (const side of [-1, 1]) {
      let t = 46.5; // フィールドの建物は ±46 まで
      while (t < 125) {
        const w = 6 + rnd() * 8;
        const depth = 10 + rnd() * 5;
        const h = t < 80 ? 7 + rnd() * 18 : 12 + rnd() * 30;
        const c = farColors[Math.floor(rnd() * farColors.length)];
        const o = FR + 0.3 + depth / 2;
        const [x, z, bw, bd] = arm === "E" ? [t + w / 2, side * o, w, depth] : arm === "W" ? [-t - w / 2, side * o, w, depth] : arm === "S" ? [side * o, t + w / 2, depth, w] : [side * o, -t - w / 2, depth, w];
        if (t < 64) {
          // 近い：外壁アトラスで、道路側と両端の面だけ
          const b = { x, z, w: bw, d: bd, h, color: c, style: FACADE_STYLES[Math.floor(rnd() * 4)] };
          const styleIdx = FACADE_STYLES.indexOf(b.style);
          const color = col3(c);
          for (const f of facesOf(b)) {
            const towardRoadFace = arm === "E" || arm === "W" ? f.n[1] === -side : f.n[0] === -side;
            facadeFace(b, f, towardRoadFace ? FLOOR : 0, towardRoadFace ? GROUND_KINDS[Math.floor(rnd() * 3)] : null, !towardRoadFace && rnd() < 0.5, styleIdx, color);
          }
          flat(B.props, x, z, bw, bd, h + 0.02, { color: "#a39f97" });
        } else {
          farBox(x, z, bw, bd, h, c, 0, 12);
        }
        farCount++;
        t += w + (rnd() < 0.3 ? 0.8 + rnd() * 1.5 : 0.2);
      }
    }
  }
  // さらに外側の街（格子状に、道路の並びと重ならないように）
  for (let gx = -180; gx <= 180; gx += 15) {
    for (let gz = -180; gz <= 180; gz += 15) {
      const x = gx + (rnd() - 0.5) * 6;
      const z = gz + (rnd() - 0.5) * 6;
      const m = Math.max(Math.abs(x), Math.abs(z));
      if (m < 52 || Math.hypot(x, z) > 190) continue;
      const corridor = m < 130 ? 26 : 10; // 道路沿いの並びのところは空けておく
      if (Math.abs(x) < corridor || Math.abs(z) < corridor) continue;
      if (m > 80 && rnd() < 0.3) continue;
      const w = 9 + rnd() * 7;
      const d = 9 + rnd() * 7;
      const h = m < 70 ? 10 + rnd() * 14 : 16 + rnd() * 50;
      const c = farColors[Math.floor(rnd() * farColors.length)];
      farBox(x, z, w, d, h, c);
      // 背の高いビルは上を細くして、シルエットに変化をつける
      if (h > 40 && rnd() < 0.5) farBox(x, z, w * 0.6, d * 0.6, 6 + rnd() * 14, shade(c, 0.05), h);
      farCount++;
    }
  }
  // ランドマーク：赤白の電波塔と、細長いタワー（遠くに小さく）
  {
    const tx0 = -95;
    const tz0 = -150;
    for (let k = 0; k < 8; k++) {
      const r0 = 7 - k * 0.8;
      const r1 = 7 - (k + 1) * 0.8;
      B.far.add(new THREE.CylinderGeometry(r1, r0, 14, 4, 1, true), M(tx0, 7 + k * 14, tz0, 1, 1, 1, Math.PI / 4), k % 2 ? "#f4f2ee" : "#e2572f", { fixedUV: [0.01, 0.99] });
    }
    B.far.add(CYL, M(tx0, 60, tz0, 9, 2.5, 9), "#f4f2ee", { fixedUV: [0.01, 0.99] });
    B.far.add(POST, M(tx0, 125, tz0, 0.6, 20, 0.6), "#e2572f", { fixedUV: [0.01, 0.99] });
    const sx0 = 150;
    const sz0 = -95;
    B.far.add(new THREE.CylinderGeometry(1.6, 5, 210, 8, 1, true), M(sx0, 105, sz0), "#cfd9e8", { fixedUV: [0.01, 0.99] });
    B.far.add(CYL, M(sx0, 120, sz0, 9, 6, 9), "#b9c6da", { fixedUV: [0.01, 0.99] });
    B.far.add(CYL, M(sx0, 165, sz0, 6, 3, 6), "#b9c6da", { fixedUV: [0.01, 0.99] });
  }

  // 空（グラデーションの球。色は高さだけで決まるので、分割は少なくてよい）
  {
    const geo = new THREE.SphereGeometry(450, 16, 10);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const top = new THREE.Color("#7aa6dc");
    const mid = new THREE.Color("#bfd4ec");
    const hor = new THREE.Color("#f3cfb1");
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 450;
      if (y > 0.25) c.copy(mid).lerp(top, Math.min(1, (y - 0.25) / 0.75));
      else c.copy(hor).lerp(mid, Math.max(0, y / 0.25));
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    // 空は最後に描く：建物や地面に隠れたところは塗らずに済む
    sky.renderOrder = 10;
    sky.frustumCulled = false;
    sky.name = "sky";
    scene.add(sky);
  }

  // =========================================================
  // メッシュにまとめてシーンへ
  // =========================================================

  const stats = { parts: 0, meshes: 0, tris: {} };
  const put = (name, batch, material, { cast = false, receive = true, order = 0 } = {}) => {
    stats.parts += batch.parts.length;
    stats.tris[name] = batch.tris;
    const list = batch.meshes(material);
    for (const m of list) {
      m.name = name;
      m.castShadow = cast;
      m.receiveShadow = receive;
      m.renderOrder = order;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      scene.add(m);
      stats.meshes++;
    }
    return list;
  };
  put("facade", B.facade, mat.facade, { cast: true });
  put("props", B.props, mat.props, { cast: true });
  put("detail", B.detail, mat.props);
  put("foliage", B.foliage, mat.foliage, { cast: true });
  put("sign", B.sign, mat.sign);
  put("road", B.road, mat.road);
  put("walk", B.walk, mat.walk);
  put("grass", B.grass, mat.grass);
  put("tactile", B.tactile, mat.tactile);
  put("decal", B.decal, mat.decal);
  put("glow", B.glow, mat.glow);
  // 遠景は近くの建物に隠れることが多いので、不透明な物の最後に描く
  put("far", B.far, mat.far, { receive: false, order: 1 });
  put("pool", B.pool, mat.pool, { receive: false });
  stats.buildings = ALL.length;
  stats.far = farCount;
  stats.farFaces = farFaces;
  stats.atlasUsed = Math.round(atlas.used * 100) + "%";

  return { awnings, stats, glowTexture: tex.glow };
}

// =========================================================
// キャラクター（性別がはっきりしない、少しデフォルメした人）
// =========================================================

export function buildPlayer(THREE, scene, { shadowTexture } = {}) {
  const K = createKit(THREE);
  const { M, Batch, BOX6 } = K;
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const C = { skin: "#ffd6b8", hoodie: "#4aa3b2", hoodieDark: "#3a8694", pants: "#394057", hair: "#3a3142", hairLight: "#4d4257", shoe: "#f4f2ee", shoeAccent: "#ef6f68", sole: "#d9d6cf", bag: "#e3a63c", bagDark: "#c48a28", white: "#f4f2ee", eye: "#2b2f3f", blush: "#ffb0a8" };
  const CAPSULE = (r, l, cap = 3, radial = 8) => new THREE.CapsuleGeometry(r, l, cap, radial);
  const SPH = (w, h) => new THREE.SphereGeometry(0.5, w, h);

  // 部位ごとに「まとめて1メッシュ」にして、Group に入れる（描画回数を減らす）
  const part = (build, x = 0, y = 0) => {
    const b = new Batch();
    build(b);
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const mesh = b.meshes(mat)[0];
    pivot.add(mesh);
    g.add(pivot);
    return pivot;
  };

  // 体（パーカー・フード・ポケット・ひも・リュック）
  const body = part((b) => {
    b.add(CAPSULE(0.3, 0.42, 3, 10), M(0, 0, 0, 1, 1, 0.92), C.hoodie);
    b.add(SPH(8, 5), M(0, 0.36, -0.18, 0.56, 0.3, 0.36), C.hoodieDark);
    b.box(0, -0.12, 0.27, 0.36, 0.14, 0.04, C.hoodieDark, 0, 0, 0, BOX6);
    b.box(-0.05, 0.16, 0.285, 0.025, 0.2, 0.02, C.white, 0, 0, 0, BOX6);
    b.box(0.05, 0.16, 0.285, 0.025, 0.2, 0.02, C.white, 0, 0, 0, BOX6);
    b.box(0, 0.04, -0.33, 0.42, 0.48, 0.2, C.bag, 0, 0, 0, BOX6);
    b.box(0, 0.3, -0.33, 0.44, 0.1, 0.22, C.bagDark, 0, 0, 0, BOX6);
    b.box(0, -0.06, -0.44, 0.3, 0.18, 0.05, C.bagDark, 0, 0, 0, BOX6);
  }, 0, 0.95);

  // 頭（顔・ボブっぽい髪・前髪・目・ほっぺ）
  const head = part((b) => {
    b.add(SPH(12, 9), M(0, 0, 0, 0.6, 0.6, 0.6), C.skin);
    b.add(SPH(12, 8), M(0, -0.06, -0.08, 0.65, 0.53, 0.5), C.hair);
    b.add(new THREE.SphereGeometry(0.325, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), M(0, 0, 0, 1, 1, 1, 0, -0.3), C.hair);
    b.box(0, 0.14, 0.24, 0.44, 0.1, 0.12, C.hairLight, 0, 0.35, 0, BOX6);
    for (const s of [-1, 1]) {
      b.add(SPH(6, 4), M(s * 0.1, -0.01, 0.272, 0.084, 0.09, 0.06), C.eye);
      b.add(SPH(6, 4), M(s * 0.17, -0.09, 0.24, 0.09, 0.045, 0.027), C.blush);
    }
  }, 0, 1.62);

  // 腕（袖＋手）・脚（ズボン＋靴＋ソール）は付け根で回せるように
  const arm = (x) => part((b) => {
    b.add(CAPSULE(0.075, 0.3, 2, 6), M(0, -0.22, 0), C.hoodie);
    b.add(CAPSULE(0.08, 0.02, 2, 6), M(0, -0.4, 0), C.hoodieDark);
    b.add(SPH(6, 4), M(0, -0.47, 0, 0.15, 0.15, 0.15), C.skin);
  }, x, 1.25);
  const leg = (x) => part((b) => {
    b.add(CAPSULE(0.09, 0.36, 2, 6), M(0, -0.26, 0), C.pants);
    b.box(0, -0.55, 0.05, 0.19, 0.12, 0.3, C.shoe, 0, 0, 0, BOX6);
    b.box(0, -0.53, 0.0, 0.195, 0.04, 0.2, C.shoeAccent, 0, 0, 0, BOX6);
    b.box(0, -0.62, 0.05, 0.21, 0.04, 0.32, C.sole, 0, 0, 0, BOX6);
  }, x, 0.62);

  const armL = { pivot: arm(-0.38) };
  const armR = { pivot: arm(0.38) };
  const legL = { pivot: leg(-0.13) };
  const legR = { pivot: leg(0.13) };

  scene.add(g);

  // 足もとの丸い影（太陽の影の地図にはプレイヤーを入れず、これで代わりにする → 影を毎フレーム描き直さなくてよい）
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: shadowTexture, color: "#000000", transparent: true, opacity: 0.38, depthWrite: false })
  );
  shadow.scale.set(1.1, 1, 1.1);
  shadow.renderOrder = 3;
  shadow.name = "player-shadow";
  scene.add(shadow);

  // body/head は歩くときに上下させる（app.js の animatePlayer が使う）
  return { g, body, head, armL, armR, legL, legR, shadow, phase: 0 };
}
