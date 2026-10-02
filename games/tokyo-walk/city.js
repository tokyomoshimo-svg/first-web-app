// 東京、歩く。2.0：街・遠景・空・キャラクターの見た目をつくる
//
// 軽く見せるための基本方針
// ・動かない物は「材質ごとに1つのメッシュ」にまとめる（色は頂点カラーで持つ）→ 描画回数を大きく減らす
// ・看板・お店・道路標示の絵は 1024×1024 の1枚（アトラス）に詰めて共有する
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

// 細かいザラつき（アスファルトやコンクリートの質感）
function speckle(g, w, h, amount, rnd) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  g.putImageData(img, 0, 0);
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
  } while (g.measureText(text).width > maxW && s > 8);
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

// =========================================================
// ジオメトリをまとめる（材質ごとに1メッシュにする）
// =========================================================

function createKit(THREE) {
  const BOX = new THREE.BoxGeometry(1, 1, 1);
  const CYL6 = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
  const CYL10 = new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1);
  const CONE_TRUNK = new THREE.CylinderGeometry(0.35, 0.5, 1, 7);
  const SPH = new THREE.SphereGeometry(0.5, 8, 6);
  const DOME = new THREE.SphereGeometry(0.5, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  const BLOB = new THREE.IcosahedronGeometry(1, 1);
  const PLANE = new THREE.PlaneGeometry(1, 1); // +z を向く板
  const FLAT = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2); // 上を向く板（絵の上は -z）
  const TORUS = new THREE.TorusGeometry(1, 0.11, 4, 10);

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

  // parts: { geo, matrix, color, rect(アトラスの範囲), scale(UV倍率), fixedUV, rotate }
  function merge(parts) {
    let count = 0;
    const geos = parts.map((p) => {
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
      const n = g.attributes.position.count;
      pos.set(g.attributes.position.array, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      c.set(p.color === undefined ? 0xffffff : p.color);
      const uv = g.attributes.uv;
      for (let k = 0; k < n; k++) {
        const j = o + k;
        col[j * 3] = c.r;
        col[j * 3 + 1] = c.g;
        col[j * 3 + 2] = c.b;
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
  // → 画面外や影の範囲外の区画は描かれない（視錐台カリング）
  class Batch {
    constructor({ chunk = 0 } = {}) {
      this.parts = [];
      this.chunk = chunk;
    }
    add(geo, matrix, color, opts) {
      this.parts.push({ geo, matrix, color, ...opts });
      return this;
    }
    box(x, y, z, sx, sy, sz, color, ry = 0, rx = 0, rz = 0) {
      return this.add(BOX, M(x, y, z, sx, sy, sz, ry, rx, rz), color);
    }
    // 2点を結ぶ円柱（フレームや電柱の腕など）
    rod(a, b, r, color, geo = CYL6) {
      const dir = new THREE.Vector3().subVectors(b, a);
      const len = dir.length();
      const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      const m = new THREE.Matrix4().compose(mid, q, new THREE.Vector3(r * 2, len, r * 2));
      return this.add(geo, m, color);
    }
    get tris() {
      return this.parts.reduce((n, p) => n + (p.geo.index ? p.geo.index.count : p.geo.attributes.position.count) / 3, 0);
    }
    meshes(material) {
      if (!this.parts.length) return [];
      if (!this.chunk) return [new THREE.Mesh(merge(this.parts), material)];
      const groups = new Map();
      for (const p of this.parts) {
        const e = p.matrix.elements;
        const key = Math.floor(e[12] / this.chunk) + "," + Math.floor(e[14] / this.chunk);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(p);
      }
      return [...groups.values()].map((list) => new THREE.Mesh(merge(list), material));
    }
  }

  return { BOX, CYL6, CYL10, CONE_TRUNK, SPH, DOME, BLOB, PLANE, FLAT, TORUS, M, Batch };
}

// =========================================================
// アトラス（看板・お店・道路標示の絵を1枚に詰める）
// =========================================================

class Atlas {
  constructor(size) {
    this.size = size;
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.canvas.height = size;
    this.g = this.canvas.getContext("2d");
    this.requests = [];
    this.pad = 6;
  }
  // w×h の区画を予約する。返す配列には pack() のあとで UV の範囲 [u0, v0, u1, v1] が入る
  alloc(w, h, draw) {
    const rect = [];
    this.requests.push({ w, h, draw, rect });
    return rect;
  }
  // 背の高いものから順に棚に並べる（すき間が少なくなる）
  pack() {
    const S = this.size;
    const g = this.g;
    let x = 0;
    let y = 0;
    let rowH = 0;
    for (const r of [...this.requests].sort((a, b) => b.h - a.h || b.w - a.w)) {
      if (x + r.w > S) {
        x = 0;
        y += rowH + this.pad;
        rowH = 0;
      }
      if (y + r.h > S) throw new Error("atlas full");
      g.save();
      g.translate(x, y);
      g.beginPath();
      g.rect(0, 0, r.w, r.h);
      g.clip();
      r.draw(g, r.w, r.h);
      g.restore();
      r.rect.push((x + 1) / S, 1 - (y + r.h - 1) / S, (x + r.w - 1) / S, 1 - (y + 1) / S);
      x += r.w + this.pad;
      rowH = Math.max(rowH, r.h);
    }
    this.used = (y + rowH) / S;
  }
}

// =========================================================
// テクスチャ
// =========================================================

function canvasTex(THREE, w, h, draw, { repeat = true, aniso = 4 } = {}) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// 外壁：256px = 6m × 6m（2部屋 × 2階）。白っぽく描いて、建物ごとの色を頂点カラーで掛ける
function facadeTexture(THREE, style, rnd) {
  return canvasTex(THREE, 256, 256, (g) => {
    const wall = { apartment: "#f3efe7", office: "#e9edf2", mixed: "#f1ece6", old: "#ebe3d6" }[style];
    g.fillStyle = wall;
    g.fillRect(0, 0, 256, 256);
    speckle(g, 256, 256, 10, rnd);

    // 窓1つ：くぼみ（影）→ 枠 → ガラス（映り込み）→ 下に水切り
    const win = (x, y, w, h, lit) => {
      g.fillStyle = "rgba(60,55,50,0.35)"; // くぼみの影
      g.fillRect(x - 3, y - 3, w + 6, h + 7);
      g.fillStyle = "#f8f6f2";
      g.fillRect(x - 2, y - 2, w + 4, h + 4);
      const glass = g.createLinearGradient(x, y, x + w, y + h);
      if (lit) {
        glass.addColorStop(0, "#ffe2a8");
        glass.addColorStop(1, "#f3b86a");
      } else {
        glass.addColorStop(0, "#9fb6cc");
        glass.addColorStop(0.55, "#5d7690");
        glass.addColorStop(1, "#4a6079");
      }
      g.fillStyle = glass;
      g.fillRect(x, y, w, h);
      g.fillStyle = "rgba(255,255,255,0.28)"; // 斜めの映り込み
      g.beginPath();
      g.moveTo(x, y + h * 0.55);
      g.lineTo(x + w * 0.45, y);
      g.lineTo(x + w * 0.62, y);
      g.lineTo(x, y + h * 0.82);
      g.fill();
      g.fillStyle = "rgba(40,40,40,0.35)"; // 上の影（奥行き）
      g.fillRect(x, y, w, 4);
      g.fillStyle = "#d9d5ce"; // 水切り
      g.fillRect(x - 4, y + h + 2, w + 8, 4);
    };

    for (let fy = 0; fy < 2; fy++) {
      for (let fx = 0; fx < 2; fx++) {
        const ox = fx * 128;
        const oy = fy * 128;
        const lit = rnd() < 0.3;
        if (style === "apartment") {
          // 掃き出し窓（ベランダに出る大きな窓）＋小さな窓
          win(ox + 14, oy + 22, 62, 82, lit);
          g.fillStyle = "rgba(0,0,0,0.25)";
          g.fillRect(ox + 44, oy + 22, 2, 82); // 引き違いの境目
          g.fillStyle = ["#e9d4b7", "#cfe1d6", "#ead1d6", "#d6dbe9"][Math.floor(rnd() * 4)]; // カーテン
          g.fillRect(ox + 16, oy + 24, 14, 78);
          win(ox + 92, oy + 30, 24, 34, rnd() < 0.3);
        } else if (style === "office") {
          // 横長の連続窓（リボンウインドウ）
          g.fillStyle = "#cfd6de";
          g.fillRect(ox, oy + 96, 128, 32); // 腰壁
          win(ox + 6, oy + 14, 116, 74, lit);
          g.fillStyle = "#e9edf2";
          for (let m = 1; m < 4; m++) g.fillRect(ox + 6 + m * 29, oy + 12, 3, 78); // 縦の桟
        } else if (style === "mixed") {
          win(ox + 18, oy + 22, 40, 52, lit);
          win(ox + 72, oy + 22, 40, 52, rnd() < 0.3);
          g.fillStyle = "#e7e5df"; // 壁にかかった室外機
          g.fillRect(ox + 82, oy + 90, 30, 22);
          g.strokeStyle = "#b9b7b0";
          g.lineWidth = 2;
          g.beginPath();
          g.arc(ox + 92, oy + 101, 7, 0, Math.PI * 2);
          g.stroke();
          g.fillStyle = "rgba(0,0,0,0.08)"; // 階の境目
          g.fillRect(ox, oy + 124, 128, 4);
        } else {
          // 古いビル：小さめの窓と、雨だれのしみ
          win(ox + 22, oy + 26, 34, 46, lit);
          win(ox + 76, oy + 26, 34, 46, rnd() < 0.25);
          g.fillStyle = "rgba(90,80,70,0.12)";
          g.fillRect(ox + 30, oy + 80, 6, 40);
          g.fillRect(ox + 86, oy + 80, 5, 30);
          g.fillStyle = "#c9c2b6"; // 格子
          for (let b = 0; b < 3; b++) g.fillRect(ox + 24 + b * 15, oy + 26, 2, 46);
        }
      }
    }
  });
}

function asphaltTexture(THREE, rnd) {
  return canvasTex(THREE, 256, 256, (g) => {
    g.fillStyle = "#5b5f69";
    g.fillRect(0, 0, 256, 256);
    // 補修のあと
    for (let i = 0; i < 5; i++) {
      g.fillStyle = `rgba(${rnd() < 0.5 ? "40,42,48" : "90,92,98"},0.35)`;
      g.fillRect(rnd() * 220, rnd() * 220, 30 + rnd() * 60, 16 + rnd() * 40);
    }
    speckle(g, 256, 256, 34, rnd);
    // 細いひび
    g.strokeStyle = "rgba(30,30,35,0.35)";
    g.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      let x = rnd() * 256;
      let y = rnd() * 256;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 5; k++) {
        x += (rnd() - 0.5) * 30;
        y += (rnd() - 0.3) * 24;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  }, { aniso: 8 });
}

// 歩道のインターロッキングブロック（256px = 3m）
function pavingTexture(THREE, rnd) {
  return canvasTex(THREE, 256, 256, (g) => {
    g.fillStyle = "#b9b0a3";
    g.fillRect(0, 0, 256, 256);
    const colors = ["#ddd3c4", "#d4c9b8", "#e3dacb", "#cfc3b1", "#d9cdbd"];
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 4; x++) {
        const off = y % 2 ? 32 : 0;
        g.fillStyle = colors[Math.floor(rnd() * colors.length)];
        g.fillRect(((x * 64 + off) % 256) + 2, y * 32 + 2, 60, 28);
        if (off) {
          g.fillRect(-32 + 2, y * 32 + 2, 60, 28);
        }
      }
    }
    speckle(g, 256, 256, 14, rnd);
  }, { aniso: 8 });
}

function concreteTexture(THREE, rnd) {
  return canvasTex(THREE, 128, 128, (g) => {
    g.fillStyle = "#cfc8bc";
    g.fillRect(0, 0, 128, 128);
    speckle(g, 128, 128, 16, rnd);
    g.fillStyle = "rgba(0,0,0,0.12)";
    g.fillRect(0, 0, 128, 1);
    g.fillRect(0, 0, 1, 128);
  });
}

function grassTexture(THREE, rnd) {
  return canvasTex(THREE, 128, 128, (g) => {
    g.fillStyle = "#8fc673";
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 500; i++) {
      g.fillStyle = rnd() < 0.5 ? "rgba(60,120,50,0.35)" : "rgba(190,230,150,0.35)";
      g.fillRect(rnd() * 128, rnd() * 128, 1, 2 + rnd() * 3);
    }
  });
}

// 点字ブロック（黄色）：64px = 0.6m
function tactileTexture(THREE) {
  return canvasTex(THREE, 64, 64, (g) => {
    g.fillStyle = "#f2c41c";
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = "#d9a90f";
    g.fillRect(0, 0, 64, 2);
    g.fillRect(0, 0, 2, 64);
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        g.fillStyle = "#ffe066";
        g.beginPath();
        g.arc(8 + x * 12, 8 + y * 12, 3.4, 0, Math.PI * 2);
        g.fill();
      }
    }
  });
}

// 光だまり（街灯の下にふんわり）
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
// アトラスの中身
// =========================================================

const SHOP_STYLE = {
  cafe: { band: "#6b4a3a", text: "#ffe9c9", inside: ["#ffe1b0", "#e9a96a"] },
  realty: { band: "#2f6fb3", text: "#ffffff", inside: ["#eef6ff", "#bcd3ea"] },
  dental: { band: "#ffffff", text: "#2f8fbf", inside: ["#f2fbff", "#cfe9f3"] },
  ramen: { band: "#b8261b", text: "#fff3d6", inside: ["#ffd9a0", "#e98f4a"] },
  salon: { band: "#2b2b33", text: "#f4d7e0", inside: ["#fff0f4", "#e8c0cc"] },
  cleaning: { band: "#3a9ad9", text: "#ffffff", inside: ["#f5fbff", "#cde4f3"] },
  izakaya: { band: "#3b2414", text: "#ffd34d", inside: ["#ffcf8a", "#d8763a"] },
  books: { band: "#556b2f", text: "#fff7e0", inside: ["#fff1d0", "#d8b98a"] },
  bento: { band: "#e8742a", text: "#ffffff", inside: ["#fff0d6", "#f2c08a"] },
  drug: { band: "#2a9d5c", text: "#ffffff", inside: ["#f4fff6", "#c8ecd2"] },
  sento: { band: "#2a4a8a", text: "#ffffff", inside: ["#fff4dc", "#e6c08a"] },
  conbini: { band: "#ffffff", text: "#e8413a", inside: ["#fbffff", "#dbe9ef"], stripe: ["#3a86ff", "#2ec27e"] },
  flower: { band: "#f7c6d0", text: "#7a3a4a", inside: ["#fff5f5", "#f2c7cf"] },
};

// 1階のお店の正面（256×86 ≒ 幅9m×高さ3m）
function drawShopfront(g, w, h, shop, kind) {
  const st = SHOP_STYLE[kind];
  g.fillStyle = "#cfcac2";
  g.fillRect(0, 0, w, h);
  // 看板の帯
  g.fillStyle = st.band;
  g.fillRect(0, 0, w, 24);
  if (st.stripe) {
    g.fillStyle = st.stripe[0];
    g.fillRect(0, 20, w, 3);
    g.fillStyle = st.stripe[1];
    g.fillRect(0, 23, w, 3);
  }
  g.fillStyle = st.text;
  fitText(g, shop, w / 2, 12, w - 20, 18, 800);
  // ガラス（店内の明かり）
  const glass = g.createLinearGradient(0, 28, 0, h);
  glass.addColorStop(0, st.inside[0]);
  glass.addColorStop(1, st.inside[1]);
  g.fillStyle = glass;
  g.fillRect(8, 30, w - 16, h - 34);
  // 店内のシルエット（棚・テーブル）
  g.fillStyle = "rgba(90,70,60,0.25)";
  for (let i = 0; i < 5; i++) g.fillRect(16 + i * 46, 56, 30, 20);
  // サッシ
  g.fillStyle = "#8f8a84";
  for (let i = 1; i < 6; i++) g.fillRect(8 + i * ((w - 16) / 6), 30, 2, h - 34);
  // 入口（真ん中）
  g.fillStyle = "rgba(60,50,45,0.55)";
  g.fillRect(w / 2 - 18, 34, 36, h - 38);
  g.fillStyle = "#e9e5df";
  g.fillRect(w / 2 + 10, 58, 3, 12);
  // 映り込み
  g.fillStyle = "rgba(255,255,255,0.25)";
  g.beginPath();
  g.moveTo(20, h - 4);
  g.lineTo(70, 30);
  g.lineTo(90, 30);
  g.lineTo(40, h - 4);
  g.fill();
}

function drawVerticalSign(g, w, h, text, color, textColor) {
  g.fillStyle = color;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = "rgba(255,255,255,0.85)";
  g.lineWidth = 3;
  g.strokeRect(3, 3, w - 6, h - 6);
  g.fillStyle = textColor;
  verticalText(g, text, w / 2, 10, h - 10, w * 0.8);
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
  fitText(g, text, w / 2, h / 2 + 2, w - 30, h * 0.6, 900);
}

// 色を明るく/暗く
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.round(Math.max(0, Math.min(255, k < 0 ? c * (1 + k) : c + (255 - c) * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// =========================================================
// 街をつくる
// =========================================================

export function buildWorld(THREE, E, scene, { isTouch, maxAniso = 4 }) {
  const K = createKit(THREE);
  const { M, Batch, BOX, CYL6, CYL10, CONE_TRUNK, SPH, DOME, BLOB, PLANE, FLAT, TORUS } = K;
  const rnd = makeRandom(20261002);
  const aniso = Math.min(maxAniso, isTouch ? 2 : 8);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  // ---- テクスチャ ----
  const tex = {
    asphalt: asphaltTexture(THREE, rnd),
    paving: pavingTexture(THREE, rnd),
    concrete: concreteTexture(THREE, rnd),
    grass: grassTexture(THREE, rnd),
    tactile: tactileTexture(THREE),
    glow: glowTexture(THREE),
    far: farTexture(THREE, rnd),
  };
  for (const t of [tex.asphalt, tex.paving]) t.anisotropy = aniso;
  const facade = {};
  for (const style of ["apartment", "office", "mixed", "old"]) facade[style] = facadeTexture(THREE, style, rnd);

  // ---- アトラス ----
  const atlas = new Atlas(1024);
  const A = {};
  A.white = atlas.alloc(16, 16, (g) => {
    g.fillStyle = "#fff";
    g.fillRect(0, 0, 16, 16);
  });
  A.yellow = atlas.alloc(16, 16, (g) => {
    g.fillStyle = "#f2c41c";
    g.fillRect(0, 0, 16, 16);
  });
  A.dark = atlas.alloc(16, 16, (g) => {
    g.fillStyle = "#3b3d45";
    g.fillRect(0, 0, 16, 16);
  });
  A.shop = {};
  for (const b of E.BUILDINGS) A.shop[b.shop] = atlas.alloc(256, 86, (g, w, h) => drawShopfront(g, w, h, b.shop, b.shopKind));
  const SIGN_COLORS = ["#e8413a", "#2f6fb3", "#2a9d8f", "#f08a24", "#7b4fd1", "#d63d7a", "#3a3f4f"];
  A.vsign = {};
  E.BUILDINGS.forEach((b, i) => {
    const color = SIGN_COLORS[i % SIGN_COLORS.length];
    A.vsign[b.shop] = atlas.alloc(48, 192, (g, w, h) => drawVerticalSign(g, w, h, b.vsign, i % 3 === 1 ? "#fffaf0" : color, i % 3 === 1 ? color : "#fff"));
  });
  A.roof = {};
  E.BUILDINGS.filter((b) => b.sign).forEach((b, i) => {
    A.roof[b.shop] = atlas.alloc(256, 80, (g, w, h) => drawRoofSign(g, w, h, b.sign, SIGN_COLORS[(i * 3 + 1) % SIGN_COLORS.length]));
  });
  A.board = {};
  E.PROPS.filter((p) => p.kind === "signboard").forEach((p, i) => {
    A.board[p.text] = atlas.alloc(96, 128, (g, w, h) => {
      g.fillStyle = ["#2b2f3f", "#fff8e8", "#1f5f4a", "#fff"][i % 4];
      g.fillRect(0, 0, w, h);
      g.strokeStyle = "#c9a227";
      g.lineWidth = 4;
      g.strokeRect(4, 4, w - 8, h - 8);
      g.fillStyle = ["#fff", "#b8261b", "#fff", "#2a9d5c"][i % 4];
      fitText(g, p.text, w / 2, h / 2, w - 16, 30);
    });
  });
  A.tomare = atlas.alloc(96, 192, (g, w, h) => {
    g.fillStyle = "#fff";
    g.font = `900 64px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    // 手前（下）から読む：止 → ま → れ
    ["れ", "ま", "止"].forEach((ch, i) => {
      g.save();
      g.translate(w / 2, 32 + i * 64);
      g.scale(1, 1.15);
      g.fillText(ch, 0, 0);
      g.restore();
    });
  });
  A.manhole = atlas.alloc(96, 96, (g) => {
    g.fillStyle = "#56565c";
    g.beginPath();
    g.arc(48, 48, 46, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#3a3a40";
    g.lineWidth = 3;
    for (let r = 14; r < 46; r += 10) {
      g.beginPath();
      g.arc(48, 48, r, 0, Math.PI * 2);
      g.stroke();
    }
    for (let k = 0; k < 8; k++) {
      g.beginPath();
      g.moveTo(48, 48);
      g.lineTo(48 + Math.cos((k * Math.PI) / 4) * 44, 48 + Math.sin((k * Math.PI) / 4) * 44);
      g.stroke();
    }
  });
  A.drain = atlas.alloc(128, 32, (g) => {
    g.fillStyle = "#3a3c42";
    g.fillRect(0, 0, 128, 32);
    g.fillStyle = "#1f2025";
    for (let i = 0; i < 14; i++) g.fillRect(6 + i * 8.6, 6, 4, 20);
  });
  A.grate = atlas.alloc(64, 64, (g) => {
    g.fillStyle = "#4a4a50";
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = "#2c2c31";
    for (let i = 0; i < 8; i++) g.fillRect(4, 4 + i * 7.5, 56, 3);
    g.fillStyle = "#6a5a48";
    g.beginPath();
    g.arc(32, 32, 10, 0, Math.PI * 2);
    g.fill();
  });
  A.stop = atlas.alloc(96, 96, (g) => {
    // 一時停止（赤い逆三角形）
    g.fillStyle = "#fff";
    g.beginPath();
    g.moveTo(4, 10);
    g.lineTo(92, 10);
    g.lineTo(48, 90);
    g.closePath();
    g.fill();
    g.fillStyle = "#d42a2a";
    g.beginPath();
    g.moveTo(14, 16);
    g.lineTo(82, 16);
    g.lineTo(48, 78);
    g.closePath();
    g.fill();
    g.fillStyle = "#fff";
    g.font = `900 17px ${FONT}`;
    g.textAlign = "center";
    g.fillText("止まれ", 48, 36);
  });
  A.crossing = atlas.alloc(96, 96, (g) => {
    g.fillStyle = "#fff";
    g.fillRect(2, 2, 92, 92);
    g.fillStyle = "#2a62c9";
    g.fillRect(8, 8, 80, 80);
    g.fillStyle = "#fff";
    g.beginPath();
    g.moveTo(48, 16);
    g.lineTo(80, 76);
    g.lineTo(16, 76);
    g.closePath();
    g.fill();
    g.fillStyle = "#2b2f3f";
    g.beginPath();
    g.arc(50, 38, 5, 0, Math.PI * 2);
    g.fill();
    g.fillRect(46, 44, 7, 16);
    g.fillRect(40, 60, 6, 12);
    g.fillRect(53, 60, 6, 12);
    for (let i = 0; i < 4; i++) g.fillRect(24 + i * 13, 70, 8, 4);
  });
  A.speed = atlas.alloc(96, 96, (g) => {
    g.fillStyle = "#d42a2a";
    g.beginPath();
    g.arc(48, 48, 46, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#fff";
    g.beginPath();
    g.arc(48, 48, 36, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#2a62c9";
    g.font = `900 38px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("30", 48, 50);
  });
  A.parking = atlas.alloc(96, 96, (g) => {
    g.fillStyle = "#2a62c9";
    roundRect(g, 2, 2, 92, 92, 10);
    g.fill();
    g.fillStyle = "#fff";
    g.font = `900 70px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("P", 48, 52);
  });
  A.vacant = atlas.alloc(64, 40, (g) => {
    g.fillStyle = "#1a1a1a";
    g.fillRect(0, 0, 64, 40);
    g.fillStyle = "#4dff7a";
    g.font = `900 26px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("空", 32, 21);
  });
  A.hazard = atlas.alloc(128, 32, (g) => {
    g.fillStyle = "#f2c41c";
    g.fillRect(0, 0, 128, 32);
    g.fillStyle = "#1d1f2b";
    for (let i = -2; i < 10; i++) {
      g.beginPath();
      g.moveTo(i * 16, 32);
      g.lineTo(i * 16 + 8, 32);
      g.lineTo(i * 16 + 24, 0);
      g.lineTo(i * 16 + 16, 0);
      g.fill();
    }
  });
  A.extinguisher = atlas.alloc(64, 32, (g) => {
    g.fillStyle = "#fff";
    g.fillRect(0, 0, 64, 32);
    g.fillStyle = "#d42a2a";
    fitText(g, "消火器", 32, 16, 56, 16);
  });
  A.vending = atlas.alloc(64, 128, (g) => {
    g.fillStyle = "#f6fbff";
    g.fillRect(0, 0, 64, 128);
    const colors = ["#2f7de1", "#f2b134", "#3cb371", "#e8413a", "#8a5cd1", "#1fb5c9"];
    for (let r = 0; r < 3; r++) {
      g.fillStyle = "#dfe8f0";
      g.fillRect(4, 8 + r * 24, 56, 22);
      for (let c = 0; c < 5; c++) {
        g.fillStyle = colors[(r * 5 + c) % colors.length];
        roundRect(g, 7 + c * 11, 11 + r * 24, 7, 15, 2);
        g.fill();
        g.fillStyle = "#2a2a2a";
        g.fillRect(8 + c * 11, 28 + r * 24, 5, 2);
      }
    }
    g.fillStyle = "#e8413a";
    g.fillRect(0, 84, 64, 44);
    g.fillStyle = "#222";
    g.fillRect(10, 108, 44, 12);
    g.fillStyle = "#fff";
    g.fillRect(46, 90, 8, 12);
  });

  atlas.pack();
  const atlasTex = new THREE.CanvasTexture(atlas.canvas);
  atlasTex.colorSpace = THREE.SRGBColorSpace;
  atlasTex.anisotropy = aniso;

  // ---- 材質 ----
  const mat = {
    props: new THREE.MeshLambertMaterial({ vertexColors: true }),
    foliage: new THREE.MeshLambertMaterial({ vertexColors: true }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
    road: new THREE.MeshLambertMaterial({ map: tex.asphalt }),
    walk: new THREE.MeshLambertMaterial({ map: tex.paving }),
    ground: new THREE.MeshLambertMaterial({ map: tex.concrete }),
    grass: new THREE.MeshLambertMaterial({ map: tex.grass }),
    tactile: new THREE.MeshLambertMaterial({ map: tex.tactile, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    decal: new THREE.MeshLambertMaterial({ map: atlasTex, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    sign: new THREE.MeshLambertMaterial({ map: atlasTex, emissive: "#ffffff", emissiveMap: atlasTex, emissiveIntensity: 0.32, alphaTest: 0.5 }),
    pool: new THREE.MeshBasicMaterial({ map: tex.glow, color: "#ffc98a", transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }),
    far: new THREE.MeshLambertMaterial({ map: tex.far, vertexColors: true }),
  };
  const facadeMat = {};
  for (const style in facade) facadeMat[style] = new THREE.MeshLambertMaterial({ map: facade[style], vertexColors: true });

  // ---- まとめ役 ----
  const B = {
    props: new Batch({ chunk: 40 }), // 色だけの小物・建物の細部
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
    facade: { apartment: new Batch({ chunk: 40 }), office: new Batch({ chunk: 40 }), mixed: new Batch({ chunk: 40 }), old: new Batch({ chunk: 40 }) },
  };

  // 地面に貼る板（y は少しずつずらして重なりのチラつきを防ぐ）
  const flat = (batch, x, z, w, d, y, opts = {}, ry = 0) => batch.add(FLAT, M(x, y, z, w, 1, d, ry), opts.color, opts);
  // 立てた板（+z 向きを ry だけ回す）
  const panel = (batch, x, y, z, w, h, ry, opts = {}) => batch.add(PLANE, M(x, y, z, w, h, 1, ry), opts.color, opts);

  const F = E.FIELD;
  const R = E.ROAD;
  const S = E.SIDEWALK;
  const L = 75; // 歩道を描く範囲（フィールドの外まで少し続ける）
  const LR = 170; // 車道を描く範囲（遠くへ消えていく）

  // =========================================================
  // 地面・道路・歩道
  // =========================================================

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(700, 700).rotateX(-Math.PI / 2), mat.ground);
  ground.geometry.attributes.uv.array.forEach((v, i, a) => (a[i] = v * 175)); // 4m ごとにくり返し
  ground.receiveShadow = true;
  // 道路・歩道より後に描く → 道路の下に隠れる部分は深度テストで早めに捨てられ、塗る量が減る
  ground.renderOrder = 2;
  scene.add(ground);

  // 車道（交差点は東西の道路に含める）
  const road = (x0, x1, z0, z1) => flat(B.road, (x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, 0.02, { scale: [(x1 - x0) / 8, (z1 - z0) / 8] });
  road(-LR, LR, -R, R);
  road(-R, R, -LR, -R);
  road(-R, R, R, LR);
  // コインパーキングの舗装
  const P = E.PARKING;
  road(P.minX, P.maxX, P.minZ, P.maxZ);

  // 歩道（重ならないように4つの角ごとに分ける）
  const walk = (x0, x1, z0, z1) => flat(B.walk, (x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, 0.04, { scale: [(x1 - x0) / 3, (z1 - z0) / 3] });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      // 東西の道路沿い（角を含む）
      walk(Math.min(sx * R, sx * L), Math.max(sx * R, sx * L), Math.min(sz * R, sz * S), Math.max(sz * R, sz * S));
      // 南北の道路沿い
      walk(Math.min(sx * R, sx * S), Math.max(sx * R, sx * S), Math.min(sz * S, sz * L), Math.max(sz * S, sz * L));
    }
  }

  // 縁石（車道との境目）
  const curbColor = "#d8d2c6";
  for (const s of [-1, 1]) {
    for (const [a, b] of [[-L, -R], [R, L]]) {
      B.props.box((a + b) / 2, 0.07, s * (R + 0.11), b - a, 0.14, 0.22, curbColor);
      B.props.box(s * (R + 0.11), 0.07, (a + b) / 2, 0.22, 0.14, b - a, curbColor);
    }
  }

  // 公園の芝生と小道・植え込み
  flat(B.grass, -27.75, 15.5, 16.5, 17, 0.03, { scale: [16.5 / 4, 17 / 4] });
  flat(B.walk, -27.75, 15.5, 1.6, 17, 0.045, { scale: [1.6 / 3, 17 / 3] });
  flat(B.walk, -27.75, 15.5, 16.5, 1.6, 0.046, { scale: [16.5 / 3, 1.6 / 3] });
  for (const [x, z, w, d] of [[-32.6, 7.4, 6.5, 0.6], [-22.9, 7.4, 6.5, 0.6], [-19.8, 13, 0.6, 9], [-19.8, 21.5, 0.6, 5]]) {
    B.foliage.box(x, 0.35, z, w, 0.7, d, "#5fa65a");
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
    if (Math.abs(t) < S + 2) continue;
    flat(B.decal, t, 0, 3, 0.15, 0.05, white);
    flat(B.decal, 0, t, 0.15, 3, 0.05, white);
  }
  for (const s of [-1, 1]) {
    for (const [a, b] of [[-LR, -S - 1], [S + 1, LR]]) {
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
  for (const [x, z, r] of [[12, 1.8, 0.65], [-20, -2, 0.65], [1.8, 18, 0.65], [-2, -26, 0.65], [5.5, -20, 0.35], [-18, 5.6, 0.35], [26, -5.2, 0.35]]) {
    flat(B.decal, x, z, r * 2, r * 2, 0.055, { rect: A.manhole });
  }
  for (let t = -36; t <= 36; t += 9) {
    if (Math.abs(t) < S + 1) continue;
    for (const s of [-1, 1]) {
      flat(B.decal, t, s * (R - 0.55), 1.2, 0.3, 0.055, { rect: A.drain });
      flat(B.decal, s * (R - 0.55), t + 4, 0.3, 1.2, 0.055, { rect: A.drain, rotate: true });
    }
  }
  // 点字ブロック（横断歩道の前と、歩道の真ん中の誘導線）
  const tactile = (x, z, w, d) => flat(B.tactile, x, z, w, d, 0.055, { scale: [w / 0.6, d / 0.6] });
  for (const s of [-1, 1]) {
    tactile(s * (R + 0.45), s * (R + 1.4), 0.6, 2.4);
    tactile(-s * (R + 0.45), s * (R + 1.4), 0.6, 2.4);
    tactile(s * (R + 1.4), s * (R + 0.45), 2.4, 0.6);
    tactile(s * (R + 1.4), -s * (R + 0.45), 2.4, 0.6);
    for (const [a, b] of [[-F, -S], [S, F]]) {
      tactile((a + b) / 2, s * 5.2, b - a, 0.3);
      tactile(s * 5.2, (a + b) / 2, 0.3, b - a);
    }
  }

  // =========================================================
  // 建物
  // =========================================================

  const awnings = [];
  const FLOOR = 3;

  E.BUILDINGS.forEach((b, i) => {
    const aw = E.AWNINGS[i];
    const nx = aw.towardX;
    const nz = aw.towardZ;
    const ry = Math.atan2(nx, nz); // 正面の向き
    const tx = Math.cos(ry); // 正面に沿った向き
    const tz = -Math.sin(ry);
    const frontW = nx ? b.d : b.w;
    const sideW = nx ? b.w : b.d;
    const fx = b.x + (nx * b.w) / 2; // 正面の中心
    const fz = b.z + (nz * b.d) / 2;
    const wall = b.color;
    const trim = shade(b.color, -0.18);

    // 外壁（4面）：同じ種類の外壁はまとめて1メッシュ
    const fb = B.facade[b.style];
    for (const [px, pz, w, rot] of [
      [b.x + b.w / 2, b.z, b.d, Math.PI / 2],
      [b.x - b.w / 2, b.z, b.d, -Math.PI / 2],
      [b.x, b.z + b.d / 2, b.w, 0],
      [b.x, b.z - b.d / 2, b.w, Math.PI],
    ]) {
      fb.add(PLANE, M(px, b.h / 2, pz, w, b.h, 1, rot), wall, { scale: [w / 6, b.h / 6] });
    }

    // 屋上・パラペット（手すり壁）
    B.props.box(b.x, b.h + 0.05, b.z, b.w, 0.1, b.d, "#a8a39b");
    for (const [px, pz, w, d] of [
      [b.x, b.z + b.d / 2 - 0.12, b.w + 0.1, 0.24],
      [b.x, b.z - b.d / 2 + 0.12, b.w + 0.1, 0.24],
      [b.x + b.w / 2 - 0.12, b.z, 0.24, b.d],
      [b.x - b.w / 2 + 0.12, b.z, 0.24, b.d],
    ]) {
      B.props.box(px, b.h + 0.45, pz, w, 0.9, d, trim);
    }

    // 階の境目の出っ張り（オフィス・雑居ビル）
    if (b.style === "office" || b.style === "mixed") {
      for (let y = FLOOR * 2; y < b.h - 1; y += FLOOR * (b.style === "office" ? 1 : 2)) {
        B.props.box(b.x, y, b.z, b.w + 0.16, 0.14, b.d + 0.16, shade(b.color, -0.08));
      }
    }

    // 1階：お店の正面（少し光る）・ひさしの上の帯・入口の段差
    panel(B.sign, fx + nx * 0.03, 1.55, fz + nz * 0.03, frontW * 0.94, 3.1, ry, { rect: A.shop[b.shop] });
    B.props.box(fx + nx * 0.04, 3.35, fz + nz * 0.04, nx ? 0.08 : frontW, 0.5, nz ? 0.08 : frontW, trim);
    B.props.box(fx + nx * 0.35, 0.06, fz + nz * 0.35, nx ? 0.7 : 2.2, 0.12, nz ? 0.7 : 2.2, "#bdb6aa");

    // ベランダ（マンション）：2階以上の正面
    if (b.style === "apartment") {
      for (let y = FLOOR * 2; y < b.h - 1.5; y += FLOOR) {
        const cx = fx + nx * 0.5;
        const cz = fz + nz * 0.5;
        B.props.box(cx, y - 0.05, cz, nx ? 1.0 : frontW * 0.92, 0.14, nz ? 1.0 : frontW * 0.92, "#e6e2da");
        // 手すり（すりガラス風の板）
        B.props.box(fx + nx * 0.98, y + 0.5, fz + nz * 0.98, nx ? 0.05 : frontW * 0.92, 0.95, nz ? 0.05 : frontW * 0.92, "#dfe8ee");
        B.props.box(fx + nx * 0.98, y + 1.0, fz + nz * 0.98, nx ? 0.09 : frontW * 0.93, 0.07, nz ? 0.09 : frontW * 0.93, "#9aa3ad");
        // ベランダの室外機
        const off = (frontW * 0.3) * (rnd() < 0.5 ? -1 : 1);
        B.props.box(fx + nx * 0.55 + tx * off, y + 0.35, fz + nz * 0.55 + tz * off, nx ? 0.35 : 0.7, 0.55, nz ? 0.35 : 0.7, "#ebe9e2");
      }
    }

    // 横の壁：配管と室外機
    const sx = tx; // 横の壁の向き（正面に沿った向き＝横の壁の外側）
    const sz = tz;
    const sideCx = b.x + (sx * (nx ? b.d : b.w)) / 2;
    const sideCz = b.z + (sz * (nx ? b.d : b.w)) / 2;
    const along = (sideW / 2 - 0.5) * (i % 2 ? 1 : -1);
    B.props.add(CYL6, M(sideCx + sx * 0.12 + nx * along, b.h / 2, sideCz + sz * 0.12 + nz * along, 0.14, b.h, 0.14), "#cfc9bf");
    B.props.add(CYL6, M(sideCx + sx * 0.12 + nx * (along - 0.3 * Math.sign(along || 1)), b.h / 2, sideCz + sz * 0.12 + nz * (along - 0.3 * Math.sign(along || 1)), 0.1, b.h, 0.1), "#bdb7ad");
    if (b.style !== "office") {
      for (let y = FLOOR + 1; y < b.h - 2; y += FLOOR * 1.5) {
        const k = (rnd() - 0.5) * sideW * 0.6;
        B.props.box(sideCx + sx * 0.3 + nx * k, y, sideCz + sz * 0.3 + nz * k, sx ? 0.5 : 0.75, 0.55, sz ? 0.5 : 0.75, "#ebe9e2");
      }
    }

    // 屋上設備：室外機・給水タンク・アンテナ・塔屋
    for (let k = 0; k < 3; k++) {
      B.props.box(b.x + (rnd() - 0.5) * b.w * 0.5, b.h + 0.45, b.z + (rnd() - 0.5) * b.d * 0.5, 1.1, 0.8, 0.8, "#e4e3dd");
    }
    if (b.style === "apartment" || b.style === "old") {
      const wx = b.x + b.w * 0.22;
      const wz = b.z - b.d * 0.2;
      for (const [lx, lz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) B.props.box(wx + lx, b.h + 0.6, wz + lz, 0.08, 1.2, 0.08, "#8f949c");
      B.props.add(CYL10, M(wx, b.h + 1.8, wz, 1.8, 1.4, 1.8), "#c9d4de");
    }
    if (b.h >= 12) B.props.box(b.x - b.w * 0.2, b.h + 1.3, b.z + b.d * 0.15, b.w * 0.32, 2.6, b.d * 0.3, shade(b.color, -0.05));
    B.props.add(CYL6, M(b.x + b.w * 0.3, b.h + 2, b.z + b.d * 0.3, 0.05, 4, 0.05), "#8f949c");

    // 屋上看板（正面向き、枠つき）
    if (A.roof[b.shop]) {
      const w = Math.min(frontW * 0.8, 7.5);
      const h = 2.2;
      const cx = fx - nx * 1.2;
      const cz = fz - nz * 1.2;
      panel(B.sign, cx + nx * 0.06, b.h + 1.5 + h / 2, cz + nz * 0.06, w, h, ry, { rect: A.roof[b.shop] });
      B.props.box(cx, b.h + 1.5 + h / 2, cz, nx ? 0.1 : w + 0.2, h + 0.2, nz ? 0.1 : w + 0.2, "#4a4d57");
      for (const k of [-0.4, 0.4]) {
        B.props.box(cx + tx * w * k, b.h + 0.75, cz + tz * w * k, 0.12, 1.5, 0.12, "#6b6f78");
      }
    }

    // 袖看板（壁から突き出した縦の看板）
    if (b.h > 8) {
      const k = frontW / 2 - 0.9;
      const side = i % 2 ? 1 : -1;
      const cx = fx + nx * 0.6 + tx * k * side;
      const cz = fz + nz * 0.6 + tz * k * side;
      const y = 4.2 + 1.4;
      B.props.box(cx, y, cz, nx ? 0.9 : 0.18, 2.9, nz ? 0.9 : 0.18, "#3b3d45");
      // 文字の面は、道を行き来する人から見える向き（±正面に沿った向き）
      panel(B.sign, cx + tx * 0.1, y, cz + tz * 0.1, 0.78, 2.7, ry + Math.PI / 2, { rect: A.vsign[b.shop] });
      panel(B.sign, cx - tx * 0.1, y, cz - tz * 0.1, 0.78, 2.7, ry - Math.PI / 2, { rect: A.vsign[b.shop] });
    }

    // ひさし（少し傾ける。真下に入ると半透明にするので、建物ごとに別メッシュ）
    const awning = new THREE.Mesh(
      new THREE.BoxGeometry(aw.w, 0.12, aw.d),
      new THREE.MeshLambertMaterial({ color: SIGN_COLORS[i % SIGN_COLORS.length], transparent: true })
    );
    awning.position.set(aw.x, aw.y, aw.z);
    awning.rotation.set(nz * 0.22, 0, -nx * 0.22);
    scene.add(awning);
    awnings.push({ mesh: awning, data: aw });
  });

  // =========================================================
  // 小物
  // =========================================================

  const props = E.PROPS;
  const of = (kind) => props.filter((p) => p.kind === kind);

  // 街灯：細い柱＋道路側へ伸びる腕＋光る笠。足元に光だまり
  for (const p of of("lamp")) {
    const toward = Math.abs(p.x) > Math.abs(p.z) ? [-Math.sign(p.x), 0] : [0, -Math.sign(p.z)]; // 道路側
    B.props.add(CYL6, M(p.x, 2.6, p.z, 0.14, 5.2, 0.14), "#5c6274");
    B.props.add(CYL6, M(p.x, 0.15, p.z, 0.3, 0.3, 0.3), "#4a4f5f");
    const hx = p.x + toward[0] * 1.0;
    const hz = p.z + toward[1] * 1.0;
    B.props.box((p.x + hx) / 2, 5.15, (p.z + hz) / 2, toward[0] ? 1.1 : 0.08, 0.08, toward[1] ? 1.1 : 0.08, "#5c6274");
    B.props.box(hx, 5.05, hz, 0.6, 0.16, 0.36, "#3f4352", toward[0] ? Math.PI / 2 : 0);
    B.glow.box(hx, 4.95, hz, 0.46, 0.05, 0.26, "#fff1c4", toward[0] ? Math.PI / 2 : 0);
    flat(B.pool, hx, hz, 5, 5, 0.07);
  }

  // 木：先細りの幹＋もこもこの葉（3つの塊）。街路樹は根元に鉄の格子
  const greens = ["#5fae5a", "#6dbb63", "#4f9e52", "#7cc46b"];
  of("tree").forEach((p, i) => {
    const s = 0.9 + ((i * 37) % 10) / 30;
    B.props.add(CONE_TRUNK, M(p.x, 1.1 * s, p.z, 0.36, 2.2 * s, 0.36), "#8a5a3b");
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + i;
      const r = 0.55 * s;
      B.foliage.add(BLOB, M(p.x + Math.cos(a) * r, (2.5 + (k === 0 ? 0.6 : 0)) * s, p.z + Math.sin(a) * r, 1.05 * s, 0.95 * s, 1.05 * s, a), greens[(i + k) % greens.length]);
    }
    B.foliage.add(BLOB, M(p.x, 3.3 * s, p.z, 0.85 * s, 0.8 * s, 0.85 * s), greens[(i + 2) % greens.length]);
    if (!p.park) flat(B.decal, p.x, p.z, 1.3, 1.3, 0.06, { rect: A.grate });
  });

  // 自動販売機：本体＋光る正面＋屋根のひさし
  const VEND_RY = [Math.PI, Math.PI / 2, 0, -Math.PI / 2];
  of("vending").forEach((p, i) => {
    const ry = VEND_RY[p.rot];
    const fx = Math.sin(ry);
    const fz = Math.cos(ry);
    const body = ["#e8413a", "#2f6fb3", "#f2f2f2", "#2a9d5c", "#e8413a"][i % 5];
    B.props.box(p.x, 0.92, p.z, p.w, 1.84, p.d, body, ry);
    B.props.box(p.x + fx * 0.06, 1.88, p.z + fz * 0.06, p.w + 0.06, 0.08, p.d + 0.14, shade(body, -0.25), ry);
    panel(B.sign, p.x + fx * (p.d / 2 + 0.012), 0.98, p.z + fz * (p.d / 2 + 0.012), p.w * 0.9, 1.6, ry, { rect: A.vending });
  });

  // 立て看板（A型）
  of("signboard").forEach((p) => {
    const ry = Math.abs(p.z) < Math.abs(p.x) ? Math.PI / 2 : 0;
    for (const s of [-1, 1]) {
      const ox = Math.sin(ry) * 0.12 * s;
      const oz = Math.cos(ry) * 0.12 * s;
      B.props.box(p.x + ox, 0.55, p.z + oz, 0.84, 1.1, 0.05, "#3b3d45", ry, 0.2 * s);
      panel(B.sign, p.x + ox * 1.35, 0.6, p.z + oz * 1.35, 0.72, 0.92, ry + (s < 0 ? Math.PI : 0), { rect: A.board[p.text] });
    }
  });

  // 電柱：コンクリートの柱・腕金・変圧器。電線でつなぐ
  const poles = of("pole");
  poles.forEach((p, i) => {
    const alongX = p.line === "N" || p.line === "S";
    B.props.add(CYL10, M(p.x, 4.6, p.z, 0.36, 9.2, 0.36), "#bcb7ae");
    B.props.add(CYL10, M(p.x, 9.25, p.z, 0.3, 0.1, 0.3), "#a9a49b");
    B.props.box(p.x, 8.4, p.z, alongX ? 0.12 : 1.6, 0.1, alongX ? 1.6 : 0.12, "#7d7a74");
    B.props.box(p.x, 7.7, p.z, alongX ? 0.1 : 1.2, 0.08, alongX ? 1.2 : 0.1, "#7d7a74");
    if (i % 3 === 0) B.props.add(CYL10, M(p.x + (alongX ? 0 : 0.35), 6.6, p.z + (alongX ? 0.35 : 0), 0.5, 0.9, 0.5), "#8d939b");
    // 黄色と黒の巻き付け（足元）
    B.props.add(CYL10, M(p.x, 1.2, p.z, 0.38, 1.6, 0.38), "#f2c41c");
  });
  // 電線（電柱の列ごと＋道路をまたぐ線）
  const wirePts = [];
  const span = (a, b, offs) => {
    const alongX = Math.abs(b.x - a.x) > Math.abs(b.z - a.z);
    for (const [h, o] of offs) {
      const sag = Math.hypot(b.x - a.x, b.z - a.z) * 0.035;
      let prev = null;
      for (let k = 0; k <= 10; k++) {
        const t = k / 10;
        const pt = new THREE.Vector3(
          a.x + (b.x - a.x) * t + (alongX ? 0 : o),
          h - sag * 4 * t * (1 - t),
          a.z + (b.z - a.z) * t + (alongX ? o : 0)
        );
        if (prev) wirePts.push(prev, pt);
        prev = pt;
      }
    }
  };
  const byLine = {};
  poles.forEach((p) => (byLine[p.line] = byLine[p.line] || []).push(p));
  for (const line in byLine) {
    const list = byLine[line].sort((a, b) => (line === "N" || line === "S" ? a.x - b.x : a.z - b.z));
    for (let i = 0; i + 1 < list.length; i++) span(list[i], list[i + 1], [[8.45, -0.6], [8.45, 0.6], [7.75, 0]]);
  }
  for (const t of [-19, 19]) {
    const find = (x, z) => poles.find((p) => Math.abs(p.x - x) < 0.01 && Math.abs(p.z - z) < 0.01);
    span(find(t, -7.4), find(t, 7.4), [[8.3, 0]]);
    span(find(-7.4, t), find(7.4, t), [[8.3, 0]]);
  }
  const wires = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(wirePts), new THREE.LineBasicMaterial({ color: "#2b2b33" }));
  scene.add(wires);

  // 郵便ポスト（赤くて丸い）
  for (const p of of("mailbox")) {
    B.props.add(CYL10, M(p.x, 0.6, p.z, 0.5, 1.2, 0.5), "#d8261b");
    B.props.add(DOME, M(p.x, 1.2, p.z, 0.54, 0.4, 0.54), "#c21f15");
    B.props.box(p.x, 1.0, p.z + 0.25, 0.28, 0.05, 0.04, "#2b2b33");
    B.props.add(CYL10, M(p.x, 0.04, p.z, 0.56, 0.08, 0.56), "#7a7a80");
  }
  // ゴミ箱（缶・ペットボトル）
  of("bin").forEach((p, i) => {
    B.props.add(CYL10, M(p.x, 0.42, p.z, 0.5, 0.84, 0.5), i % 2 ? "#2f6fb3" : "#7f8792");
    B.props.add(CYL10, M(p.x, 0.86, p.z, 0.52, 0.06, 0.52), "#3b3d45");
  });
  // 自転車：タイヤ・フレーム・サドル・ハンドル・かご
  const BIKE_COLORS = ["#e8413a", "#f2f2f2", "#2a9d8f", "#f2b134", "#5a6fd1", "#d63d7a"];
  of("bikes").forEach((p, gi) => {
    for (let k = 0; k < p.count; k++) {
      const z = p.z - p.d / 2 + 0.3 + (k * (p.d - 0.6)) / (p.count - 1);
      const x = p.x;
      const c = BIKE_COLORS[(gi * 3 + k) % BIKE_COLORS.length];
      const w1 = V(x - 0.5, 0.33, z);
      const w2 = V(x + 0.5, 0.33, z);
      B.props.add(TORUS, M(w1.x, w1.y, z, 0.3, 0.3, 0.3), "#2b2b33");
      B.props.add(TORUS, M(w2.x, w2.y, z, 0.3, 0.3, 0.3), "#2b2b33");
      const pedal = V(x - 0.05, 0.36, z);
      const seat = V(x - 0.2, 0.85, z);
      const head = V(x + 0.38, 0.9, z);
      B.props.rod(w1, pedal, 0.025, c);
      B.props.rod(pedal, seat, 0.025, c);
      B.props.rod(seat, head, 0.025, c);
      B.props.rod(pedal, head, 0.025, c);
      B.props.rod(head, w2, 0.025, c);
      B.props.rod(w1, seat, 0.02, c);
      B.props.box(seat.x, seat.y + 0.04, z, 0.24, 0.06, 0.12, "#2b2b33");
      B.props.box(head.x, head.y + 0.08, z, 0.06, 0.04, 0.5, "#8f949c");
      B.props.box(head.x + 0.18, head.y - 0.05, z, 0.28, 0.2, 0.3, "#8f949c");
    }
  });
  // ガードレール：白い支柱＋2本の横棒
  for (const p of of("guardrail")) {
    const len = p.along === "x" ? p.w : p.d;
    for (let t = -len / 2; t <= len / 2 + 0.01; t += 2) {
      B.props.add(CYL6, M(p.x + (p.along === "x" ? t : 0), 0.4, p.z + (p.along === "x" ? 0 : t), 0.08, 0.8, 0.08), "#f2f2ee");
    }
    for (const y of [0.45, 0.75]) {
      B.props.box(p.x, y, p.z, p.along === "x" ? len : 0.06, 0.07, p.along === "x" ? 0.06 : len, "#f2f2ee");
    }
  }
  // カーブミラー：オレンジの柱＋丸い鏡
  for (const p of of("mirror")) {
    const ry = Math.atan2(-p.x, -p.z);
    B.props.add(CYL6, M(p.x, 1.4, p.z, 0.1, 2.8, 0.1), "#f28c28");
    B.props.add(TORUS, M(p.x - Math.sin(ry) * 0.05, 2.9, p.z - Math.cos(ry) * 0.05, 0.38, 0.38, 0.6, ry), "#f28c28");
    B.glow.add(CYL10, M(p.x, 2.9, p.z, 0.72, 0.04, 0.72, ry, Math.PI / 2), "#cfe3ee");
  }
  // 消火器ボックス
  for (const p of of("hydrant")) {
    const turned = p.w < p.d;
    B.props.box(p.x, 0.45, p.z, p.w, 0.9, p.d, "#d42a2a");
    const fx = turned ? -Math.sign(p.x) : 0;
    const fz = turned ? 0 : -Math.sign(p.z);
    panel(B.sign, p.x + fx * (Math.min(p.w, p.d) / 2 + 0.01), 0.7, p.z + fz * (Math.min(p.w, p.d) / 2 + 0.01), 0.4, 0.2, Math.atan2(fx, fz), { rect: A.extinguisher });
  }
  // 植木鉢
  of("planter").forEach((p, i) => {
    B.props.add(CONE_TRUNK, M(p.x, 0.25, p.z, 0.6, 0.5, 0.6, 0, Math.PI), "#b8683f");
    B.foliage.add(BLOB, M(p.x, 0.75, p.z, 0.38, 0.42, 0.38, i), greens[i % greens.length]);
    if (i % 2) B.glow.add(SPH, M(p.x + 0.12, 0.92, p.z, 0.12, 0.12, 0.12), "#ff9ab0");
  });
  // ベンチ
  for (const p of of("bench")) {
    for (let k = 0; k < 3; k++) B.props.box(p.x, 0.46, p.z - 0.18 + k * 0.17, p.w, 0.05, 0.13, "#b07a4a");
    B.props.box(p.x, 0.75, p.z + 0.27, p.w, 0.28, 0.05, "#b07a4a");
    for (const s of [-1, 1]) B.props.box(p.x + s * (p.w / 2 - 0.15), 0.25, p.z, 0.08, 0.5, 0.5, "#4a4d57");
  }
  // 道路標識
  for (const p of of("signpost")) {
    const ry = Math.atan2(-p.x, -p.z); // 交差点のほうを向く
    B.props.add(CYL6, M(p.x, 1.3, p.z, 0.08, 2.6, 0.08), "#9aa0a8");
    const rect = A[p.sign === "stop" ? "stop" : p.sign === "crossing" ? "crossing" : "speed"];
    panel(B.sign, p.x + Math.sin(ry) * 0.05, 2.55, p.z + Math.cos(ry) * 0.05, 0.75, 0.75, ry, { rect });
    panel(B.props, p.x + Math.sin(ry) * 0.04, 2.55, p.z + Math.cos(ry) * 0.04, 0.7, 0.7, ry + Math.PI, { color: "#9aa0a8" });
  }
  // コインパーキング：柵・車止め・精算機・P看板
  for (const p of of("fence")) {
    const alongX = p.w > p.d;
    const len = alongX ? p.w : p.d;
    for (let t = -len / 2; t <= len / 2 + 0.01; t += 1.5) {
      B.props.add(CYL6, M(p.x + (alongX ? t : 0), 0.6, p.z + (alongX ? 0 : t), 0.07, 1.2, 0.07), "#8f949c");
    }
    for (const y of [0.4, 1.15]) B.props.box(p.x, y, p.z, alongX ? len : 0.05, 0.05, alongX ? 0.05 : len, "#8f949c");
  }
  for (let i = 0; i < P.spaces; i++) {
    const x = P.minX + 0.6 + ((i + 0.5) * (P.maxX - P.minX - 1.2)) / P.spaces;
    B.props.box(x, 0.07, P.minZ + 1.0, 1.2, 0.14, 0.18, "#e9e6df");
    B.props.box(x, 0.03, P.minZ + 3.4, 0.9, 0.06, 0.6, "#5b5f69"); // ロック板
  }
  for (const p of of("meter")) {
    B.props.box(p.x, 0.65, p.z, 0.42, 1.3, 0.32, "#5b6b84");
    B.props.box(p.x, 1.32, p.z, 0.46, 0.08, 0.36, "#f2c41c");
    B.glow.box(p.x, 1.0, p.z + 0.17, 0.26, 0.16, 0.01, "#9fe8ff");
  }
  for (const p of of("psign")) {
    B.props.add(CYL6, M(p.x, 1.7, p.z, 0.12, 3.4, 0.12), "#8f949c");
    panel(B.sign, p.x, 3.5, p.z + 0.05, 1.1, 1.1, 0, { rect: A.parking });
    panel(B.sign, p.x, 3.5, p.z - 0.05, 1.1, 1.1, Math.PI, { rect: A.parking });
    panel(B.sign, p.x, 2.7, p.z + 0.05, 0.6, 0.38, 0, { rect: A.vacant });
  }

  // 道路の行き止まり（フィールドの端）のバリケード
  for (const [x, z, alongX] of [[F + 0.4, 0, false], [-F - 0.4, 0, false], [0, F + 0.4, true], [0, -F - 0.4, true]]) {
    for (let t = -3; t <= 3; t += 2) {
      const cx = x + (alongX ? t : 0);
      const cz = z + (alongX ? 0 : t);
      for (const s of [-0.7, 0.7]) B.props.box(cx + (alongX ? s : 0), 0.5, cz + (alongX ? 0 : s), 0.08, 1.0, 0.08, "#e9e6df");
      panel(B.sign, cx, 0.85, cz, 1.6, 0.36, alongX ? 0 : Math.PI / 2, { rect: A.hazard });
      panel(B.sign, cx, 0.85, cz, 1.6, 0.36, alongX ? Math.PI : -Math.PI / 2, { rect: A.hazard });
    }
  }

  // =========================================================
  // 遠景：歩けない外側にも街が続いて見えるように
  // =========================================================

  const farColors = ["#c3cad6", "#d6cdbf", "#b9c4d3", "#d3c4c2", "#c3d0ca", "#dcd3c4", "#aeb8c7"];
  let farCount = 0;
  for (let gx = -180; gx <= 180; gx += 15) {
    for (let gz = -180; gz <= 180; gz += 15) {
      const x = gx + (rnd() - 0.5) * 6;
      const z = gz + (rnd() - 0.5) * 6;
      const m = Math.max(Math.abs(x), Math.abs(z));
      if (m < 47 || Math.hypot(x, z) > 190) continue;
      if (Math.abs(x) < 10 || Math.abs(z) < 10) continue; // 道路の先は空けておく
      if (m > 80 && rnd() < 0.35) continue;
      const w = 8 + rnd() * 7;
      const d = 8 + rnd() * 7;
      const h = m < 70 ? 8 + rnd() * 14 : 16 + rnd() * 50;
      const c = farColors[Math.floor(rnd() * farColors.length)];
      for (const [px, pz, fw, rot] of [[x + w / 2, z, d, Math.PI / 2], [x - w / 2, z, d, -Math.PI / 2], [x, z + d / 2, w, 0], [x, z - d / 2, w, Math.PI]]) {
        B.far.add(PLANE, M(px, h / 2, pz, fw, h, 1, rot), c, { scale: [fw / 6, h / 6] });
      }
      B.far.add(FLAT, M(x, h, z, w, 1, d), shade(c, -0.15), { fixedUV: [0.01, 0.99] });
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
      B.far.add(new THREE.CylinderGeometry(r1, r0, 14, 4), M(tx0, 7 + k * 14, tz0, 1, 1, 1, Math.PI / 4), k % 2 ? "#f4f2ee" : "#e2572f", { fixedUV: [0.01, 0.99] });
    }
    B.far.add(CYL10, M(tx0, 60, tz0, 9, 2.5, 9), "#f4f2ee", { fixedUV: [0.01, 0.99] });
    B.far.add(CYL6, M(tx0, 125, tz0, 0.6, 20, 0.6), "#e2572f", { fixedUV: [0.01, 0.99] });
    const sx0 = 150;
    const sz0 = -95;
    B.far.add(new THREE.CylinderGeometry(1.6, 5, 210, 8), M(sx0, 105, sz0), "#cfd9e8", { fixedUV: [0.01, 0.99] });
    B.far.add(CYL10, M(sx0, 120, sz0, 9, 6, 9), "#b9c6da", { fixedUV: [0.01, 0.99] });
    B.far.add(CYL10, M(sx0, 165, sz0, 6, 3, 6), "#b9c6da", { fixedUV: [0.01, 0.99] });
  }

  // 空（グラデーションの半球）
  {
    const geo = new THREE.SphereGeometry(450, 24, 14);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const top = new THREE.Color("#6f9fdc");
    const mid = new THREE.Color("#b9d2ee");
    const hor = new THREE.Color("#f7cfae");
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
    scene.add(sky);
  }

  // =========================================================
  // メッシュにまとめてシーンへ
  // =========================================================

  const stats = { parts: 0, meshes: 0 };
  const put = (batch, material, { cast = false, receive = true } = {}) => {
    stats.parts += batch.parts.length;
    const list = batch.meshes(material);
    for (const m of list) {
      m.castShadow = cast;
      m.receiveShadow = receive;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      scene.add(m);
      stats.meshes++;
    }
    return list;
  };
  put(B.road, mat.road);
  put(B.walk, mat.walk);
  put(B.grass, mat.grass);
  put(B.tactile, mat.tactile);
  put(B.decal, mat.decal);
  for (const style in B.facade) put(B.facade[style], facadeMat[style], { cast: true });
  put(B.props, mat.props, { cast: true });
  put(B.foliage, mat.foliage, { cast: true });
  put(B.glow, mat.glow);
  put(B.sign, mat.sign);
  put(B.pool, mat.pool, { receive: false });
  put(B.far, mat.far, { receive: false });
  stats.far = farCount;
  stats.atlasUsed = Math.round(atlas.used * 100) + "%";

  return { awnings, stats };
}

// =========================================================
// キャラクター（性別がはっきりしない、少しデフォルメした人）
// =========================================================

export function buildPlayer(THREE, scene) {
  const K = createKit(THREE);
  const { M, Batch } = K;
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const C = { skin: "#ffd9bd", hoodie: "#4fb3bf", hoodieDark: "#3e97a3", pants: "#3d4466", hair: "#3a3346", shoe: "#ff7a7a", sole: "#f4f2ee", bag: "#f2b134", bagDark: "#d99a22", white: "#f4f2ee", eye: "#2b2f3f", blush: "#ffb3b0" };
  const CAPSULE = (r, l) => new THREE.CapsuleGeometry(r, l, 4, 10);

  // 部位ごとに「まとめて1メッシュ」にして、Group に入れる（描画回数を減らす）
  const part = (build, x = 0, y = 0) => {
    const b = new Batch();
    build(b);
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const mesh = b.meshes(mat)[0];
    mesh.castShadow = true;
    pivot.add(mesh);
    g.add(pivot);
    return pivot;
  };

  // 体（パーカー・フード・ポケット・ひも・リュック）
  const body = part((b) => {
    b.add(CAPSULE(0.3, 0.42), M(0, 0, 0), C.hoodie);
    b.add(K.SPH, M(0, 0.36, -0.2, 0.53, 0.31, 0.35), C.hoodieDark);
    b.box(0, -0.12, 0.29, 0.34, 0.14, 0.04, C.hoodieDark);
    b.box(0, 0.2, 0.3, 0.14, 0.18, 0.02, C.white);
    b.box(0, 0.04, -0.34, 0.42, 0.46, 0.2, C.bag);
    b.box(0, 0.28, -0.34, 0.44, 0.12, 0.22, C.bagDark);
  }, 0, 0.95);

  // 頭（顔・ボブっぽい髪・前髪・目・ほっぺ）
  const head = part((b) => {
    b.add(new THREE.SphereGeometry(0.3, 16, 12), M(0, 0, 0), C.skin);
    b.add(new THREE.SphereGeometry(0.31, 14, 10), M(0, -0.06, -0.08, 1.05, 0.85, 0.8), C.hair);
    b.add(new THREE.SphereGeometry(0.325, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), M(0, 0, 0, 1, 1, 1, 0, -0.3), C.hair);
    b.box(0, 0.14, 0.24, 0.44, 0.1, 0.12, C.hair, 0, 0.35);
    for (const s of [-1, 1]) {
      b.add(K.SPH, M(s * 0.1, -0.01, 0.272, 0.084, 0.084, 0.084), C.eye);
      b.add(K.SPH, M(s * 0.17, -0.09, 0.24, 0.09, 0.045, 0.027), C.blush);
    }
  }, 0, 1.62);

  // 腕（袖＋手）・脚（ズボン＋靴＋白いソール）は付け根で回せるように
  const arm = (x) => part((b) => {
    b.add(CAPSULE(0.075, 0.3), M(0, -0.22, 0), C.hoodie);
    b.add(K.SPH, M(0, -0.46, 0, 0.15, 0.15, 0.15), C.skin);
  }, x, 1.25);
  const leg = (x) => part((b) => {
    b.add(CAPSULE(0.09, 0.36), M(0, -0.26, 0), C.pants);
    b.box(0, -0.56, 0.05, 0.19, 0.1, 0.3, C.shoe);
    b.box(0, -0.62, 0.05, 0.21, 0.05, 0.32, C.sole);
  }, x, 0.62);

  const armL = { pivot: arm(-0.38) };
  const armR = { pivot: arm(0.38) };
  const legL = { pivot: leg(-0.13) };
  const legR = { pivot: leg(0.13) };

  scene.add(g);
  // body/head は歩くときに上下させる（app.js の animatePlayer が使う）
  return { g, body, head, armL, armR, legL, legR, phase: 0 };
}
