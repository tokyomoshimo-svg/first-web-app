// ぽよぽよブラスト：ゲームのルール（画面に依存しない。node でもテストできる）
//
// 盤面 grid[r][c]
//   undefined … 盤面の外（穴。形を作る）
//   null      … 空き（このあと上から落ちてくる）
//   piece     … { id, t, color, dir, hp }
//     t: "c"（色のぽよ） / "rocket"（dir: "h" 横・"v" 縦） / "bomb" / "disco"（color: 消す色）
//        "box"（木箱：hp 1〜2。となりで消す・ブースターで壊れる。動かない）
//        "stone"（石：ブースターでだけ壊れる。動かない）
//        "balloon"（ふうせん：となりで消す・ブースターで割れる。落ちる）
//        "gift"（プレゼント：いちばん下まで落とすと回収。壊れない）
//
// タップの結果は「いつ・どこで・何が起きたか」の出来事の列（events）で返す。
// 画面（app.js）は出来事を時間どおりに再生するだけ。盤面そのものは、タップの時点で最後の状態まで進めてある。

const PopBlast = (() => {
  "use strict";

  const GROUP_MIN = 2; // これ以上つながっていれば消せる
  const ROCKET_AT = 5; // 5〜6個 → ロケット
  const BOMB_AT = 7; // 7〜8個 → ボム
  const DISCO_AT = 9; // 9個以上 → レインボー
  const BOOSTERS = ["rocket", "bomb", "disco"];
  const STATIC = ["box", "stone"];

  const SCORE = { piece: 20, blast: 30, obstacle: 60, booster: 120, gift: 300, perMove: 250 };

  function makeRng(seed) {
    let s = seed >>> 0 || 1;
    return () => {
      s ^= s << 13;
      s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5;
      s >>>= 0;
      return s / 4294967296;
    };
  }

  const isBooster = (p) => !!p && BOOSTERS.includes(p.t);
  const isStatic = (p) => !!p && STATIC.includes(p.t);

  class Game {
    constructor(level, seed = 1) {
      this.level = level;
      this.rows = level.rows;
      this.cols = level.cols;
      this.rng = makeRng(seed);
      this.nextId = 1;
      this.moves = level.moves;
      this.movesUsed = 0;
      this.score = 0;
      this.goals = level.goals.map((g) => ({ ...g, left: g.count }));
      this.giftsLeftToSpawn = level.spawnGifts || 0;
      this.grid = [];
      for (let r = 0; r < this.rows; r++) {
        const row = [];
        const line = (level.layout && level.layout[r]) || ".".repeat(this.cols);
        for (let c = 0; c < this.cols; c++) {
          const ch = line[c] || ".";
          row.push(ch === " " ? undefined : this.pieceFor(ch));
        }
        this.grid.push(row);
      }
      // 始めから消せるグループが少なすぎないように（序盤の「すぐ分かる」ため）
      for (let k = 0; k < 30 && this.groupCount() < Math.max(3, (this.rows * this.cols) / 9); k++) this.recolor();
    }

    newPiece(t, extra = {}) {
      return { id: this.nextId++, t, ...extra };
    }
    randomColor() {
      return Math.floor(this.rng() * this.level.colors);
    }
    pieceFor(ch) {
      switch (ch) {
        case "B": return this.newPiece("box", { hp: 1 });
        case "b": return this.newPiece("box", { hp: 2 });
        case "S": return this.newPiece("stone", { hp: 1 });
        case "L": return this.newPiece("balloon");
        case "G": return this.newPiece("gift");
        case "R": return this.newPiece("rocket", { dir: this.rng() < 0.5 ? "h" : "v" });
        case "O": return this.newPiece("bomb");
        case "D": return this.newPiece("disco", { color: this.randomColor() });
        default:
          if (ch >= "0" && ch <= "4") return this.newPiece("c", { color: +ch });
          return this.newPiece("c", { color: this.randomColor() });
      }
    }
    // 色のぽよだけ塗り直す（初期盤面の調整・シャッフル用）
    recolor() {
      this.each((p) => {
        if (p && p.t === "c") p.color = this.randomColor();
      });
    }

    inside(r, c) {
      return r >= 0 && c >= 0 && r < this.rows && c < this.cols && this.grid[r][c] !== undefined;
    }
    at(r, c) {
      return this.inside(r, c) ? this.grid[r][c] : undefined;
    }
    each(fn) {
      for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) if (this.grid[r][c] !== undefined) fn(this.grid[r][c], r, c);
    }

    // 同じ色でつながっているグループ（色のぽよだけ）
    groupAt(r, c) {
      const p = this.at(r, c);
      if (!p || p.t !== "c") return [];
      const seen = new Set([r * 100 + c]);
      const out = [[r, c]];
      for (let i = 0; i < out.length; i++) {
        const [y, x] = out[i];
        for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const q = this.at(y + dy, x + dx);
          const k = (y + dy) * 100 + x + dx;
          if (q && q.t === "c" && q.color === p.color && !seen.has(k)) {
            seen.add(k);
            out.push([y + dy, x + dx]);
          }
        }
      }
      return out;
    }
    // となり合ったブースターのかたまり（タップしたブースターから）
    boosterClusterAt(r, c) {
      if (!isBooster(this.at(r, c))) return [];
      const seen = new Set([r * 100 + c]);
      const out = [[r, c]];
      for (let i = 0; i < out.length; i++) {
        const [y, x] = out[i];
        for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const k = (y + dy) * 100 + x + dx;
          if (!seen.has(k) && isBooster(this.at(y + dy, x + dx))) {
            seen.add(k);
            out.push([y + dy, x + dx]);
          }
        }
      }
      return out;
    }
    groupCount() {
      let n = 0;
      const seen = new Set();
      this.each((p, r, c) => {
        if (!p || p.t !== "c" || seen.has(r * 100 + c)) return;
        const g = this.groupAt(r, c);
        g.forEach(([y, x]) => seen.add(y * 100 + x));
        if (g.length >= GROUP_MIN) n++;
      });
      return n;
    }
    hasMoves() {
      let ok = false;
      this.each((p) => {
        if (isBooster(p)) ok = true;
      });
      return ok || this.groupCount() > 0;
    }
    // どこをタップできるか（ヒント・ボット用）：[{r, c, size, kind}]
    options() {
      const out = [];
      const seen = new Set();
      this.each((p, r, c) => {
        if (!p || seen.has(r * 100 + c)) return;
        if (isBooster(p)) {
          out.push({ r, c, size: this.boosterClusterAt(r, c).length, kind: "booster" });
          return;
        }
        if (p.t !== "c") return;
        const g = this.groupAt(r, c);
        g.forEach(([y, x]) => seen.add(y * 100 + x));
        if (g.length >= GROUP_MIN) out.push({ r, c, size: g.length, kind: "group", color: p.color, cells: g });
      });
      return out;
    }

    // ---------- タップ ----------
    // 返り値：null（消せない）か { kind, events, gain, created }
    tap(r, c, { free = false } = {}) {
      const p = this.at(r, c);
      if (!p || this.moves <= 0 && !free) return null;
      let res = null;
      if (p.t === "c") {
        const g = this.groupAt(r, c);
        if (g.length < GROUP_MIN) return null;
        res = this.resolveGroup(r, c, g);
      } else if (isBooster(p)) {
        res = this.resolveBooster(r, c);
      } else return null;
      if (!free) {
        this.moves--;
        this.movesUsed++;
      }
      this.score += res.gain;
      return res;
    }

    // 出来事を集める入れ物
    startResolve() {
      return { events: [], gone: new Set(), hitBy: new Map(), gain: 0, triggered: new Set(), queue: [] };
    }
    addGoal(type, color) {
      for (const g of this.goals) {
        if (g.left > 0 && g.type === type && (type !== "color" || g.color === color)) {
          g.left--;
          return g;
        }
      }
      return null;
    }
    // マスを1つ消す（または壊す）。src は「同じ爆発で同じ障害物を2回たたかない」ための印
    hit(R, r, c, t, src, by) {
      const p = this.at(r, c);
      if (!p) return;
      const key = r * 100 + c;
      if (R.gone.has(key)) return;
      if (p.t === "gift") return; // プレゼントは壊れない
      if (isStatic(p) || (p.t === "balloon" && by === "near")) {
        if (p.t === "stone" && by === "near") return; // 石はとなりで消しても壊れない
        const hk = key + ":" + src;
        if (R.hitBy.has(hk)) return;
        R.hitBy.set(hk, true);
      }
      if (p.t === "box" || p.t === "stone") {
        p.hp--;
        if (p.hp > 0) {
          R.events.push({ t, type: "hit", r, c, id: p.id, piece: { ...p } });
          R.gain += 10;
          return;
        }
        R.gone.add(key);
        this.grid[r][c] = null;
        R.events.push({ t, type: "pop", r, c, id: p.id, piece: p, by, goal: this.addGoal(p.t) });
        R.gain += SCORE.obstacle;
        return;
      }
      if (isBooster(p)) {
        // 爆発に巻き込まれたブースターは、少し遅れて自分も発動（連鎖）
        if (R.triggered.has(p.id)) return;
        R.triggered.add(p.id);
        R.gone.add(key);
        this.grid[r][c] = null;
        R.events.push({ t, type: "pop", r, c, id: p.id, piece: p, by, chain: true });
        R.gain += SCORE.booster;
        R.queue.push({ t: t + 0.09, r, c, kind: p.t, dir: p.dir, color: p.color, chain: true });
        return;
      }
      R.gone.add(key);
      this.grid[r][c] = null;
      const goal = p.t === "balloon" ? this.addGoal("balloon") : this.addGoal("color", p.color);
      R.events.push({ t, type: "pop", r, c, id: p.id, piece: p, by, goal });
      R.gain += p.t === "balloon" ? SCORE.obstacle : by === "group" ? SCORE.piece : SCORE.blast;
    }

    resolveGroup(r, c, cells) {
      const R = this.startResolve();
      const color = this.at(r, c).color;
      const n = cells.length;
      const make = n >= DISCO_AT ? "disco" : n >= BOMB_AT ? "bomb" : n >= ROCKET_AT ? "rocket" : null;
      // タップした所から波のように消える（ブースターを作るときは、タップした所へ集まる）
      for (const [y, x] of cells) {
        const d = Math.hypot(y - r, x - c);
        if (make && y === r && x === c) continue;
        this.hit(R, y, x, make ? 0 : d * 0.018, "g", "group");
        if (make) R.events[R.events.length - 1].merge = [r, c];
      }
      // となりの木箱・ふうせんにダメージ（1回のタップで1回だけ）
      const near = new Set();
      for (const [y, x] of cells) {
        for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const q = this.at(y + dy, x + dx);
          if (q && (q.t === "box" || q.t === "balloon") && !near.has(q.id)) {
            near.add(q.id);
            this.hit(R, y + dy, x + dx, 0.06, "near", "near");
          }
        }
      }
      let created = null;
      if (make) {
        const old = this.at(r, c);
        const piece = this.newPiece(make, make === "rocket" ? { dir: this.rng() < 0.5 ? "h" : "v" } : make === "disco" ? { color } : {});
        this.grid[r][c] = piece;
        // タップしたマスのぽよも数える（目標）
        const goal = this.addGoal("color", old.color);
        R.events.push({ t: 0, type: "pop", r, c, id: old.id, piece: old, by: "group", merge: [r, c], goal });
        R.events.push({ t: 0.2, type: "spawn", r, c, id: piece.id, piece });
        R.gain += SCORE.piece;
        created = make;
      }
      R.gain += n >= ROCKET_AT ? n * 10 : 0;
      this.runQueue(R);
      return this.finish(R, "group", { size: n, created, color });
    }

    resolveBooster(r, c) {
      const R = this.startResolve();
      const cluster = this.boosterClusterAt(r, c);
      const pieces = cluster.map(([y, x]) => this.at(y, x));
      for (const p of pieces) R.triggered.add(p.id);
      // かたまりのブースターは、タップした所へ集まって合体
      for (const [y, x] of cluster) {
        const p = this.at(y, x);
        R.gone.add(y * 100 + x);
        this.grid[y][x] = null;
        R.events.push({ t: 0, type: "pop", r: y, c: x, id: p.id, piece: p, by: "booster", merge: cluster.length > 1 ? [r, c] : null });
      }
      const kinds = pieces.map((p) => p.t);
      const count = (k) => kinds.filter((x) => x === k).length;
      const t0 = cluster.length > 1 ? 0.22 : 0;
      let combo = null;
      const tapped = pieces[0];
      const discoColor = (pieces.find((p) => p.t === "disco") || {}).color;
      if (cluster.length === 1) {
        R.queue.push({ t: 0, r, c, kind: tapped.t, dir: tapped.dir, color: tapped.color });
      } else if (count("disco") >= 2) {
        combo = "disco+disco";
        R.queue.push({ t: t0, r, c, kind: "all" });
      } else if (count("disco") === 1 && count("bomb") >= 1) {
        combo = "disco+bomb";
        R.queue.push({ t: t0, r, c, kind: "discoTo", into: "bomb", color: discoColor });
      } else if (count("disco") === 1 && count("rocket") >= 1) {
        combo = "disco+rocket";
        R.queue.push({ t: t0, r, c, kind: "discoTo", into: "rocket", color: discoColor });
      } else if (count("bomb") >= 2) {
        combo = "bomb+bomb";
        R.queue.push({ t: t0, r, c, kind: "bigbomb" });
      } else if (count("bomb") >= 1 && count("rocket") >= 1) {
        combo = "rocket+bomb";
        R.queue.push({ t: t0, r, c, kind: "megarocket" });
      } else {
        combo = "rocket+rocket";
        R.queue.push({ t: t0, r, c, kind: "cross" });
      }
      if (combo) R.events.push({ t: 0, type: "combo", r, c, combo, count: cluster.length });
      R.gain += SCORE.booster * cluster.length;
      this.runQueue(R);
      return this.finish(R, cluster.length > 1 ? "combo" : "booster", { combo, size: cluster.length });
    }

    // 爆発を時間順に処理（巻き込まれたブースターが次の爆発をキューに足す）
    runQueue(R) {
      let chain = 0;
      while (R.queue.length) {
        R.queue.sort((a, b) => a.t - b.t);
        const a = R.queue.shift();
        if (a.chain) chain++;
        this.activate(R, a);
      }
      R.chain = chain;
    }

    activate(R, a) {
      const { r, c, t } = a;
      const src = "a" + R.events.length + ":" + r + ":" + c;
      const ray = (y0, x0, dir, startT) => {
        // ロケット：中心のマスと、左右（上下）へ飛ぶ
        this.hit(R, y0, x0, startT, src, "blast");
        if (dir === "h") {
          for (const s of [-1, 1]) for (let k = 1; k < this.cols; k++) {
            const x = x0 + s * k;
            if (x < 0 || x >= this.cols) break;
            this.hit(R, y0, x, startT + k * 0.032, src, "blast");
          }
        } else {
          for (const s of [-1, 1]) for (let k = 1; k < this.rows; k++) {
            const y = y0 + s * k;
            if (y < 0 || y >= this.rows) break;
            this.hit(R, y, x0, startT + k * 0.032, src, "blast");
          }
        }
      };
      const blast = (radius, startT) => {
        for (let y = Math.floor(r - radius); y <= r + radius; y++) {
          for (let x = Math.floor(c - radius); x <= c + radius; x++) {
            const d = Math.hypot(y - r, x - c);
            if (d <= radius) this.hit(R, y, x, startT + d * 0.035, src, "blast");
          }
        }
      };
      switch (a.kind) {
        case "rocket":
          R.events.push({ t, type: "fx", fx: "rocket", r, c, dir: a.dir });
          ray(r, c, a.dir, t);
          break;
        case "cross":
          R.events.push({ t, type: "fx", fx: "rocket", r, c, dir: "h" }, { t, type: "fx", fx: "rocket", r, c, dir: "v" });
          ray(r, c, "h", t);
          ray(r, c, "v", t);
          break;
        case "megarocket":
          for (const k of [-1, 0, 1]) {
            if (r + k >= 0 && r + k < this.rows) {
              R.events.push({ t, type: "fx", fx: "rocket", r: r + k, c, dir: "h", big: true });
              ray(r + k, c, "h", t);
            }
            if (c + k >= 0 && c + k < this.cols) {
              R.events.push({ t, type: "fx", fx: "rocket", r, c: c + k, dir: "v", big: true });
              ray(r, c + k, "v", t);
            }
          }
          break;
        case "bomb":
          R.events.push({ t, type: "fx", fx: "bomb", r, c, radius: 2 });
          blast(2, t);
          break;
        case "bigbomb":
          R.events.push({ t, type: "fx", fx: "bomb", r, c, radius: 3.4, big: true });
          blast(3.4, t);
          break;
        case "disco": {
          // その色のぽよを全部消す（色が盤面にないときは、いちばん多い色）
          const color = this.pickDiscoColor(a.color);
          const targets = [];
          this.each((p, y, x) => {
            if (p && p.t === "c" && p.color === color) targets.push([y, x]);
          });
          R.events.push({ t, type: "fx", fx: "disco", r, c, color, targets });
          this.hit(R, r, c, t, src, "blast");
          targets.forEach(([y, x], i) => this.hit(R, y, x, t + 0.12 + i * 0.018, src, "blast"));
          break;
        }
        case "discoTo": {
          // レインボー＋ロケット/ボム：その色のぽよが全部ロケット（ボム）に変わって、順に発動
          const color = this.pickDiscoColor(a.color);
          const targets = [];
          this.each((p, y, x) => {
            if (p && p.t === "c" && p.color === color) targets.push([y, x]);
          });
          R.events.push({ t, type: "fx", fx: "disco", r, c, color, targets, into: a.into });
          targets.forEach(([y, x], i) => {
            const p = this.at(y, x);
            const nb = this.newPiece(a.into, a.into === "rocket" ? { dir: this.rng() < 0.5 ? "h" : "v" } : {});
            this.grid[y][x] = nb;
            R.events.push({ t: t + 0.12 + i * 0.02, type: "transform", r: y, c: x, id: p.id, piece: nb, from: p });
            const goal = this.addGoal("color", p.color);
            if (goal) R.events.push({ t: t + 0.12 + i * 0.02, type: "goal", r: y, c: x, goal, piece: p });
          });
          const start = t + 0.25 + targets.length * 0.02;
          targets.forEach(([y, x], i) => {
            const nb = this.at(y, x);
            if (!nb || R.triggered.has(nb.id)) return;
            R.triggered.add(nb.id);
            R.gone.add(y * 100 + x);
            this.grid[y][x] = null;
            R.events.push({ t: start + i * 0.06, type: "pop", r: y, c: x, id: nb.id, piece: nb, by: "blast", chain: true });
            R.queue.push({ t: start + i * 0.06, r: y, c: x, kind: a.into, dir: nb.dir, chain: true });
          });
          break;
        }
        case "all": {
          R.events.push({ t, type: "fx", fx: "bomb", r, c, radius: 9, big: true, all: true });
          blast(Math.hypot(this.rows, this.cols), t);
          break;
        }
      }
    }

    pickDiscoColor(color) {
      const counts = new Array(this.level.colors).fill(0);
      this.each((p) => {
        if (p && p.t === "c") counts[p.color]++;
      });
      if (color !== undefined && counts[color] > 0) return color;
      let best = 0;
      counts.forEach((n, i) => {
        if (n > counts[best]) best = i;
      });
      return best;
    }

    finish(R, kind, extra) {
      R.events.sort((a, b) => a.t - b.t);
      const duration = R.events.reduce((m, e) => Math.max(m, e.t), 0);
      const popped = R.events.filter((e) => e.type === "pop").length;
      return { kind, events: R.events, gain: R.gain, duration, popped, chain: R.chain || 0, ...extra };
    }

    // ---------- 落下と補充 ----------
    // 返り値：{ moves: [{ id, fr, fc, tr, tc }], spawns: [{ id, piece, tr, tc, from }], collected: [{ id, r, c, piece }] }
    collapse() {
      const moves = [];
      const spawns = [];
      const collected = [];
      for (let guard = 0; guard < 4; guard++) {
        for (let c = 0; c < this.cols; c++) {
          // 上から下へ、盤面のマス（穴は飛ばす）。動かない障害物で区切る
          const cells = [];
          for (let r = 0; r < this.rows; r++) if (this.grid[r][c] !== undefined) cells.push(r);
          const segments = [];
          let cur = [];
          let open = true; // この区間は上から補充されるか
          for (const r of cells) {
            if (isStatic(this.grid[r][c])) {
              if (cur.length) segments.push({ rows: cur, open });
              cur = [];
              open = false;
            } else cur.push(r);
          }
          if (cur.length) segments.push({ rows: cur, open });
          for (const seg of segments) {
            const items = seg.rows.filter((r) => this.grid[r][c]).map((r) => ({ p: this.grid[r][c], fr: r }));
            // 下から詰める
            const rows = seg.rows;
            let k = rows.length - 1;
            for (let i = items.length - 1; i >= 0; i--, k--) {
              const { p, fr } = items[i];
              const tr = rows[k];
              if (fr !== tr) moves.push({ id: p.id, fr, fc: c, tr, tc: c });
              this.grid[tr][c] = p;
            }
            // 上の空きを埋める（開いている区間だけ）
            const empty = k + 1;
            for (let j = 0; j < empty; j++) this.grid[rows[j]][c] = null;
            if (seg.open) {
              for (let j = empty - 1, n = 0; j >= 0; j--, n++) {
                const p = this.spawnPiece();
                this.grid[rows[j]][c] = p;
                spawns.push({ id: p.id, piece: p, tr: rows[j], tc: c, from: -1 - n });
              }
            }
          }
        }
        // いちばん下まで来たプレゼントを回収
        let got = false;
        for (let c = 0; c < this.cols; c++) {
          let bottom = -1;
          for (let r = this.rows - 1; r >= 0; r--) if (this.grid[r][c] !== undefined) {
            bottom = r;
            break;
          }
          const p = bottom >= 0 ? this.grid[bottom][c] : null;
          if (p && p.t === "gift") {
            this.grid[bottom][c] = null;
            collected.push({ id: p.id, r: bottom, c, piece: p, goal: this.addGoal("gift") });
            this.score += SCORE.gift;
            got = true;
          }
        }
        if (!got) break;
      }
      return { moves, spawns, collected };
    }
    spawnPiece() {
      if (this.giftsLeftToSpawn > 0 && this.rng() < 0.12) {
        this.giftsLeftToSpawn--;
        return this.newPiece("gift");
      }
      if (this.level.spawnBalloons && this.rng() < this.level.spawnBalloons) return this.newPiece("balloon");
      return this.newPiece("c", { color: this.randomColor() });
    }

    // 消せる所がなくなったら、色のぽよだけ並べかえ（色を塗り直す）
    shuffle() {
      for (let k = 0; k < 40; k++) {
        this.recolor();
        if (this.groupCount() >= 2) break;
      }
    }

    goalsDone() {
      return this.goals.every((g) => g.left <= 0);
    }

    // クリア後：残り手数1つにつき、ランダムなぽよを1つブースターに変える（そのあと順に発動する）
    finaleConvert() {
      const cells = [];
      this.each((p, r, c) => {
        if (p && p.t === "c") cells.push([r, c]);
      });
      if (!cells.length || this.moves <= 0) return null;
      const [r, c] = cells[Math.floor(this.rng() * cells.length)];
      const old = this.grid[r][c];
      const nb = this.newPiece(this.rng() < 0.65 ? "rocket" : "bomb", { dir: this.rng() < 0.5 ? "h" : "v" });
      this.grid[r][c] = nb;
      this.moves--;
      this.score += SCORE.perMove;
      return { r, c, piece: nb, from: old };
    }
    boosterCells() {
      const out = [];
      this.each((p, r, c) => {
        if (isBooster(p)) out.push([r, c]);
      });
      return out;
    }

    stars() {
      if (!this.goalsDone()) return 0;
      const [s2, s3] = this.level.stars;
      return this.score >= s3 ? 3 : this.score >= s2 ? 2 : 1;
    }
  }

  return { Game, makeRng, isBooster, isStatic, GROUP_MIN, ROCKET_AT, BOMB_AT, DISCO_AT, SCORE };
})();

if (typeof module !== "undefined") module.exports = PopBlast;
