// ぽよぽよブラスト V2：ゲームのルール（画面に依存しない。node でもテストできる）
//
// 1ターンの流れ
//   1) （しなくてもよい）ぽよかブースターを1つ選んで、最大2マスまでドラッグで動かす（手数は減らない。来た道を戻れば取り消し）
//   2) 2つ以上つながった同じ色か、ブースターをタップ → 消える（手数 −1）。これが 1 COMBO
//   3) 落ちて補充されたあと、「動いたぽよ」をふくむ同じ色の4つ以上のかたまりは、自動で消える → +1 COMBO
//      爆風で巻き込まれたブースターの発動、ブースターの合体でも COMBO が増える
//   4) 消えるものがなくなったら、そのターンはおしまい（endTurn）
//
// COMBO が増えるほど点数の倍率が上がり、連鎖でできるブースターは強くなる（3 COMBO 目からは「チャージ」つき）
//
// 盤面 grid[r][c]
//   undefined … 盤面の外（穴。形を作る）
//   null      … 空き（このあと上から落ちてくる）
//   piece     … { id, t, color, dir, hp, pow, fixed }
//     t: "c"（色のぽよ） / "mini"（ぷちボム） / "rocket"（dir: "h" 横・"v" 縦） / "bomb" / "disco"（レインボー。color: 消す色）
//        "box"（木箱：hp 1〜2。となりで消す・ブースターで壊れる。動かない）
//        "stone"（石：ブースターでだけ壊れる。動かない）
//        "balloon"（ふうせん：となりで消す・ブースターで割れる。落ちる）
//        "gift"（プレゼント：いちばん下まで落とすと回収。壊れない）
//     pow: 2 なら「チャージ」つきのブースター（ふつうより強い）
//
// タップ・連鎖の結果は「いつ・どこで・何が起きたか」の出来事の列（events）で返す。
// 画面（app.js）は出来事を時間どおりに再生するだけ。盤面そのものは、その時点で最後の状態まで進めてある。

const PopBlast = (() => {
  "use strict";

  const TAP_MIN = 2; // タップで消せる大きさ
  const CHAIN_MIN = 4; // 落ちたあと、自動で消える大きさ（連鎖）
  const DRAG_STEPS = 2; // 1ターンに動かせるマス数
  const CHARGE_AT = 3; // この COMBO 以降の連鎖でできたブースターは「チャージ」つき
  const BOOSTERS = ["mini", "rocket", "bomb", "disco"];
  const RANK = { mini: 1, rocket: 2, bomb: 3, disco: 4 };
  const STATIC = ["box", "stone"];

  const SCORE = { piece: 20, blast: 30, obstacle: 60, booster: 120, gift: 300, perMove: 250 };
  // COMBO の倍率：1 → ×1, 2 → ×1.5, 3 → ×2 … 最大 ×5
  const comboMult = (k) => Math.min(5, 1 + 0.5 * (Math.max(1, k) - 1));
  // 消えた数 → できるブースター
  const boosterFor = (n) => (n >= 7 ? "disco" : n >= 6 ? "bomb" : n >= 5 ? "rocket" : n >= 4 ? "mini" : null);
  // 連鎖で消えたかたまりは、COMBO が進むほど「多く消した」ことにする（3 COMBO 目から +1、5 COMBO 目から +2）
  const comboBonus = (k) => (k >= 5 ? 2 : k >= 3 ? 1 : 0);

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
  const isMovable = (p) => !!p && (p.t === "c" || isBooster(p));
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

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
      this.combo = 0; // いまのターンの COMBO
      this.maxCombo = 0;
      this.comboHist = {}; // COMBO 数 → ターン数
      this.used = { mini: 0, rocket: 0, bomb: 0, disco: 0 };
      this.goals = level.goals.map((g) => ({ ...g, left: g.count }));
      this.giftsLeftToSpawn = level.spawnGifts || 0;
      this.moved = new Set(); // 直前の落下で動いた（新しく来た）駒の id
      this.drag = null; // { id, path: [[r, c], ...] }
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
      // 始めの盤面：4つ以上のかたまりはない（ブースターや連鎖は自分で作る）。消せる所はそこそこある
      const want = Math.max(3, (this.rows * this.cols) / 8);
      for (let k = 0; k < 40; k++) {
        this.breakBig();
        if (this.groupCount() >= want) break;
        this.recolor();
      }
      this.breakBig();
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
        case "M": return this.newPiece("mini");
        case "R": return this.newPiece("rocket", { dir: "h" });
        case "V": return this.newPiece("rocket", { dir: "v" });
        case "O": return this.newPiece("bomb");
        case "D": return this.newPiece("disco", { color: this.randomColor() });
        default:
          if (ch >= "0" && ch <= "4") return this.newPiece("c", { color: +ch, fixed: true });
          return this.newPiece("c", { color: this.randomColor() });
      }
    }
    // 色のぽよ（決まった色以外）を塗り直す（初期盤面の調整・シャッフル用）
    recolor() {
      this.each((p) => {
        if (p && p.t === "c" && !p.fixed) p.color = this.randomColor();
      });
    }
    // 4つ以上のかたまりを、色を変えてくずす（決まった色のぽよは変えない）
    breakBig() {
      for (let guard = 0; guard < 6; guard++) {
        let changed = false;
        this.each((p, r, c) => {
          if (!p || p.t !== "c" || p.fixed) return;
          if (this.groupAt(r, c).length < CHAIN_MIN) return;
          const start = this.randomColor();
          for (let i = 0; i < this.level.colors; i++) {
            p.color = (start + i) % this.level.colors;
            if (this.groupAt(r, c).length < CHAIN_MIN) break;
          }
          changed = true;
        });
        if (!changed) return;
      }
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
    find(id) {
      for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
        const p = this.grid[r][c];
        if (p && p.id === id) return [r, c];
      }
      return null;
    }

    // 同じ色でつながっているグループ（色のぽよだけ）
    groupAt(r, c) {
      const p = this.at(r, c);
      if (!p || p.t !== "c") return [];
      const seen = new Set([r * 100 + c]);
      const out = [[r, c]];
      for (let i = 0; i < out.length; i++) {
        const [y, x] = out[i];
        for (const [dy, dx] of DIRS) {
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
        for (const [dy, dx] of DIRS) {
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
        if (g.length >= TAP_MIN) n++;
      });
      return n;
    }
    // タップできる所があるか、1マス動かせばできるか
    hasMoves() {
      let ok = false;
      this.each((p) => {
        if (isBooster(p)) ok = true;
      });
      if (ok || this.groupCount() > 0) return true;
      for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
        if (!isMovable(this.at(r, c))) continue;
        for (const [dy, dx] of [[0, 1], [1, 0]]) {
          if (!isMovable(this.at(r + dy, c + dx))) continue;
          this.swap(r, c, r + dy, c + dx);
          const good = this.groupAt(r, c).length >= TAP_MIN || this.groupAt(r + dy, c + dx).length >= TAP_MIN;
          this.swap(r, c, r + dy, c + dx);
          if (good) return true;
        }
      }
      return false;
    }
    // どこをタップできるか（ヒント・ボット用）：[{r, c, size, kind}]
    options() {
      const out = [];
      const seen = new Set();
      this.each((p, r, c) => {
        if (!p || seen.has(r * 100 + c)) return;
        if (isBooster(p)) {
          out.push({ r, c, size: this.boosterClusterAt(r, c).length, kind: "booster", t: p.t });
          return;
        }
        if (p.t !== "c") return;
        const g = this.groupAt(r, c);
        g.forEach(([y, x]) => seen.add(y * 100 + x));
        if (g.length >= TAP_MIN) out.push({ r, c, size: g.length, kind: "group", color: p.color, cells: g });
      });
      return out;
    }

    // ---------- ドラッグ（1ターンに1つの駒を、最大 DRAG_STEPS マス） ----------
    swap(r1, c1, r2, c2) {
      const t = this.grid[r1][c1];
      this.grid[r1][c1] = this.grid[r2][c2];
      this.grid[r2][c2] = t;
    }
    canPick(r, c) {
      const p = this.at(r, c);
      if (!isMovable(p)) return false;
      return !this.drag || this.drag.id === p.id;
    }
    pick(r, c) {
      if (!this.canPick(r, c)) return false;
      if (!this.drag) this.drag = { id: this.at(r, c).id, path: [[r, c]] };
      return true;
    }
    dragStepsUsed() {
      return this.drag ? this.drag.path.length - 1 : 0;
    }
    // いまドラッグ中の駒を、となりのマス (r2, c2) へ。来た道を戻るのは取り消し（何マスでも戻れる）
    // 返り値：null（動けない）か { back, a: {id, fr, fc, tr, tc}, b: {id, fr, fc, tr, tc}, used }
    step(r2, c2) {
      if (!this.drag) return null;
      const path = this.drag.path;
      const [r, c] = path[path.length - 1];
      if (Math.abs(r - r2) + Math.abs(c - c2) !== 1) return null;
      const prev = path.length >= 2 ? path[path.length - 2] : null;
      const back = !!prev && prev[0] === r2 && prev[1] === c2;
      if (!back && path.length - 1 >= DRAG_STEPS) return null;
      const q = this.at(r2, c2);
      if (!isMovable(q)) return null;
      const p = this.at(r, c);
      this.swap(r, c, r2, c2);
      if (back) path.pop();
      else path.push([r2, c2]);
      return { back, a: { id: p.id, fr: r, fc: c, tr: r2, tc: c2 }, b: { id: q.id, fr: r2, fc: c2, tr: r, tc: c }, used: path.length - 1 };
    }
    // 指を離したとき：1マスも動いていなければ、選びなおせる
    release() {
      if (this.drag && this.drag.path.length <= 1) this.drag = null;
    }

    // ---------- タップ ----------
    // 返り値：null（消せない）か { kind, events, gain, duration, combo, ... }
    tap(r, c, { free = false } = {}) {
      const p = this.at(r, c);
      if (!p || (this.moves <= 0 && !free)) return null;
      let res = null;
      if (p.t === "c") {
        const g = this.groupAt(r, c);
        if (g.length < TAP_MIN) return null;
        this.combo = 0;
        res = this.resolveGroups([{ cells: g, pivot: [r, c] }], true);
      } else if (isBooster(p)) {
        this.combo = 0;
        res = this.resolveBooster(r, c);
      } else return null;
      if (!free) {
        this.moves--;
        this.movesUsed++;
      }
      this.drag = null;
      this.moved = new Set();
      this.score += res.gain;
      return res;
    }

    // 落ちたあとの自動消去（連鎖）。消えるものがなければ null
    cascade() {
      const seen = new Set();
      const groups = [];
      this.each((p, r, c) => {
        if (!p || p.t !== "c" || !this.moved.has(p.id) || seen.has(r * 100 + c)) return;
        const g = this.groupAt(r, c);
        g.forEach(([y, x]) => seen.add(y * 100 + x));
        if (g.length < CHAIN_MIN) return;
        // ブースターができる場所：動いてきたぽよのうち、いちばん下（同じなら左）
        let pivot = null;
        for (const [y, x] of g) {
          if (!this.moved.has(this.grid[y][x].id)) continue;
          if (!pivot || y > pivot[0] || (y === pivot[0] && x < pivot[1])) pivot = [y, x];
        }
        groups.push({ cells: g, pivot });
      });
      this.moved = new Set();
      if (!groups.length) return null;
      const res = this.resolveGroups(groups, false);
      this.score += res.gain;
      return res;
    }

    // ターンのおしまい：COMBO の記録・COMBO の目標
    endTurn() {
      const k = this.combo;
      this.combo = 0;
      if (k > 0) {
        this.maxCombo = Math.max(this.maxCombo, k);
        this.comboHist[k] = (this.comboHist[k] || 0) + 1;
      }
      const done = [];
      for (const g of this.goals) {
        if (g.type === "combo" && g.left > 0 && k >= g.min) {
          g.left--;
          done.push(g);
        }
      }
      // あと1 COMBO で届いた目標（「惜しい！」の表示用）
      const near = this.goals.find((g) => g.type === "combo" && g.left > 0 && k === g.min - 1);
      return { combo: k, goals: done, near: near ? near.min : 0 };
    }

    // 出来事を集める入れ物。新しい「波」なので COMBO +1
    startResolve() {
      this.combo++;
      const R = { events: [], gone: new Set(), hitBy: new Map(), gain: 0, triggered: new Set(), queue: [], comboStart: this.combo };
      R.events.push({ t: 0, type: "combo", n: this.combo, mult: comboMult(this.combo) });
      return R;
    }
    addCombo(R, t) {
      this.combo++;
      R.events.push({ t, type: "combo", n: this.combo, mult: comboMult(this.combo), chain: true });
    }
    pts(n) {
      return Math.round(n * comboMult(this.combo));
    }
    addGoal(type, key) {
      for (const g of this.goals) {
        if (g.left > 0 && g.type === type && (type !== "color" || g.color === key) && (type !== "use" || g.booster === key || g.booster === "any")) {
          g.left--;
          return g;
        }
      }
      return null;
    }
    useBooster(p) {
      this.used[p.t] = (this.used[p.t] || 0) + 1;
      return this.addGoal("use", p.t);
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
          R.gain += this.pts(10);
          return;
        }
        R.gone.add(key);
        this.grid[r][c] = null;
        R.events.push({ t, type: "pop", r, c, id: p.id, piece: p, by, goal: this.addGoal(p.t) });
        R.gain += this.pts(SCORE.obstacle);
        return;
      }
      if (isBooster(p)) {
        // 爆発に巻き込まれたブースターは、少し遅れて自分も発動（連鎖。COMBO +1）
        if (R.triggered.has(p.id)) return;
        R.triggered.add(p.id);
        R.gone.add(key);
        this.grid[r][c] = null;
        R.events.push({ t, type: "pop", r, c, id: p.id, piece: p, by, chain: true, goal: this.useBooster(p) });
        R.gain += this.pts(SCORE.booster);
        R.queue.push({ t: t + 0.1, r, c, kind: p.t, dir: p.dir, color: p.color, pow: p.pow || 1, chain: true });
        return;
      }
      R.gone.add(key);
      this.grid[r][c] = null;
      const goal = p.t === "balloon" ? this.addGoal("balloon") : this.addGoal("color", p.color);
      R.events.push({ t, type: "pop", r, c, id: p.id, piece: p, by, goal });
      R.gain += this.pts(p.t === "balloon" ? SCORE.obstacle : by === "group" ? SCORE.piece : SCORE.blast);
    }

    // 同じ色のかたまりを消す（タップ：1つ / 連鎖：いくつも同時に）
    resolveGroups(groups, isTap) {
      const R = this.startResolve();
      groups = groups.slice().sort((a, b) => b.cells.length - a.cells.length);
      const made = [];
      const colors = [];
      let total = 0;
      for (const { cells, pivot } of groups) {
        const [r, c] = pivot;
        const color = this.at(r, c).color;
        const n = cells.length;
        colors.push(color);
        total += n;
        // 連鎖の波でブースターになるのは、いちばん大きいかたまり1つだけ（盤面がブースターだらけにならない）
        const make = isTap ? boosterFor(n) : made.length ? null : boosterFor(n + comboBonus(this.combo));
        const pow = make && !isTap && this.combo >= CHARGE_AT ? 2 : 1;
        // タップした所から波のように消える（ブースターを作るときは、その場所へ集まる）
        for (const [y, x] of cells) {
          if (make && y === r && x === c) continue;
          const d = Math.hypot(y - r, x - c);
          this.hit(R, y, x, make ? 0 : d * 0.018, "g", "group");
          if (make) R.events[R.events.length - 1].merge = [r, c];
        }
        if (make) {
          const old = this.at(r, c);
          const piece = this.newPiece(make, make === "rocket" ? { dir: this.rng() < 0.5 ? "h" : "v" } : make === "disco" ? { color } : {});
          if (pow > 1) piece.pow = pow;
          this.grid[r][c] = piece;
          R.gone.add(r * 100 + c);
          const goal = this.addGoal("color", old.color);
          R.events.push({ t: 0, type: "pop", r, c, id: old.id, piece: old, by: "group", merge: [r, c], goal });
          R.events.push({ t: 0.2, type: "spawn", r, c, id: piece.id, piece });
          R.gain += this.pts(SCORE.piece);
          made.push({ t: make, pow, r, c });
        }
        R.gain += n >= 4 ? this.pts(n * 10) : 0;
      }
      // となりの木箱・ふうせんにダメージ（1つの波で1回だけ）
      const near = new Set();
      for (const { cells } of groups) {
        for (const [y, x] of cells) {
          for (const [dy, dx] of DIRS) {
            const q = this.at(y + dy, x + dx);
            if (q && (q.t === "box" || q.t === "balloon") && !near.has(q.id)) {
              near.add(q.id);
              this.hit(R, y + dy, x + dx, 0.06, "near", "near");
            }
          }
        }
      }
      this.runQueue(R);
      return this.finish(R, isTap ? "group" : "cascade", {
        size: total,
        created: made.length ? made[0].t : null,
        made,
        groups: groups.map((g) => g.cells),
        pivot: groups[0].pivot,
        color: colors[0],
        colors,
      });
    }
    resolveBooster(r, c) {
      const R = this.startResolve();
      const cluster = this.boosterClusterAt(r, c);
      const pieces = cluster.map(([y, x]) => this.at(y, x));
      for (const p of pieces) R.triggered.add(p.id);
      // かたまりのブースターは、タップした所へ集まって合体（1つ増えるごとに COMBO +1）
      for (const [y, x] of cluster) {
        const p = this.at(y, x);
        R.gone.add(y * 100 + x);
        this.grid[y][x] = null;
        R.events.push({ t: 0, type: "pop", r: y, c: x, id: p.id, piece: p, by: "booster", merge: cluster.length > 1 ? [r, c] : null, goal: this.useBooster(p) });
      }
      const tapped = pieces[0];
      let fusion = null;
      const t0 = cluster.length > 1 ? 0.22 : 0;
      if (cluster.length === 1) {
        R.queue.push({ t: 0, r, c, kind: tapped.t, dir: tapped.dir, color: tapped.color, pow: tapped.pow || 1 });
      } else {
        for (let i = 1; i < cluster.length; i++) this.addCombo(R, t0 + i * 0.02);
        const sorted = pieces.slice().sort((a, b) => RANK[b.t] - RANK[a.t]);
        const [a, b] = sorted;
        const disco = pieces.find((p) => p.t === "disco");
        const key = a.t + "+" + b.t;
        const charged = pieces.some((p) => p.pow > 1);
        if (key === "disco+disco") fusion = { kind: "all" };
        else if (a.t === "disco") fusion = { kind: "discoTo", into: b.t, color: disco.color };
        else if (key === "bomb+bomb") fusion = { kind: "blast", radius: 4.2, big: true };
        else if (key === "bomb+rocket") fusion = { kind: "megarocket" };
        else if (key === "bomb+mini") fusion = { kind: "blast", radius: 3.5, big: true };
        else if (key === "rocket+rocket") fusion = { kind: "cross" };
        else if (key === "rocket+mini") fusion = { kind: "rocket", dir: a.dir, pow: 2 };
        else fusion = { kind: "blast", radius: 2.5 }; // ぷちボム＋ぷちボム
        if (charged && fusion.kind === "blast") fusion.radius += 0.8;
        R.events.push({ t: 0, type: "fusion", r, c, fusion: key, count: cluster.length, goal: this.addGoal("fusion") });
        R.queue.push({ t: t0, r, c, dir: tapped.dir, ...fusion });
      }
      R.gain += this.pts(SCORE.booster * cluster.length);
      this.runQueue(R);
      return this.finish(R, cluster.length > 1 ? "fusion" : "booster", { fusion: fusion && pieces.length > 1 ? pieces.map((p) => p.t).sort((x, y) => RANK[y] - RANK[x]).slice(0, 2).join("+") : null, size: cluster.length, booster: tapped.t });
    }

    // 爆発を時間順に処理（巻き込まれたブースターが次の爆発をキューに足す）
    runQueue(R) {
      let chain = 0;
      while (R.queue.length) {
        R.queue.sort((a, b) => a.t - b.t);
        const a = R.queue.shift();
        if (a.chain) {
          chain++;
          if (!a.quiet) this.addCombo(R, a.t);
        }
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
      const colorTargets = (color) => {
        const out = [];
        this.each((p, y, x) => {
          if (p && p.t === "c" && p.color === color) out.push([y, x]);
        });
        return out;
      };
      switch (a.kind) {
        case "mini": {
          const radius = a.pow > 1 ? 2.5 : 1.5;
          R.events.push({ t, type: "fx", fx: "bomb", r, c, radius, mini: true, big: a.pow > 1 });
          blast(radius, t);
          break;
        }
        case "rocket":
          if (a.pow > 1) {
            // チャージつき：3本まとめて
            for (const k of [-1, 0, 1]) {
              const y = a.dir === "h" ? r + k : r;
              const x = a.dir === "v" ? c + k : c;
              if (y < 0 || y >= this.rows || x < 0 || x >= this.cols) continue;
              R.events.push({ t, type: "fx", fx: "rocket", r: y, c: x, dir: a.dir, big: true });
              ray(y, x, a.dir, t);
            }
          } else {
            R.events.push({ t, type: "fx", fx: "rocket", r, c, dir: a.dir });
            ray(r, c, a.dir, t);
          }
          break;
        case "cross":
          R.events.push({ t, type: "fx", fx: "rocket", r, c, dir: "h", big: true }, { t, type: "fx", fx: "rocket", r, c, dir: "v", big: true });
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
        case "bomb": {
          const radius = a.pow > 1 ? 3.5 : 2.5;
          R.events.push({ t, type: "fx", fx: "bomb", r, c, radius, big: a.pow > 1 });
          blast(radius, t);
          break;
        }
        case "blast":
          R.events.push({ t, type: "fx", fx: "bomb", r, c, radius: a.radius, big: !!a.big || a.radius > 3 });
          blast(a.radius, t);
          break;
        case "disco": {
          // その色のぽよを全部消す（チャージつきは2色）。色が盤面にないときは、いちばん多い色
          const color = this.pickDiscoColor(a.color);
          let targets = colorTargets(color);
          let color2 = null;
          if (a.pow > 1) {
            color2 = this.pickDiscoColor(undefined, color);
            if (color2 !== null) targets = targets.concat(colorTargets(color2));
          }
          R.events.push({ t, type: "fx", fx: "disco", r, c, color, color2, targets });
          this.hit(R, r, c, t, src, "blast");
          targets.forEach(([y, x], i) => this.hit(R, y, x, t + 0.12 + i * 0.016, src, "blast"));
          break;
        }
        case "discoTo": {
          // レインボー＋ほかのブースター：その色のぽよが全部そのブースターに変わって、順に発動
          const color = this.pickDiscoColor(a.color);
          const targets = colorTargets(color);
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
            R.queue.push({ t: start + i * 0.06, r: y, c: x, kind: a.into, dir: nb.dir, pow: 1, chain: true, quiet: true });
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

    // レインボーで消す色（その色がないときは、いちばん多い色。not は除く）
    pickDiscoColor(color, not = null) {
      const counts = new Array(this.level.colors).fill(0);
      this.each((p) => {
        if (p && p.t === "c") counts[p.color]++;
      });
      if (color !== undefined && color !== not && counts[color] > 0) return color;
      let best = null;
      counts.forEach((n, i) => {
        if (i !== not && n > 0 && (best === null || n > counts[best])) best = i;
      });
      return best === null ? 0 : best;
    }

    finish(R, kind, extra) {
      R.events.sort((a, b) => a.t - b.t);
      const duration = R.events.reduce((m, e) => Math.max(m, e.t), 0);
      const popped = R.events.filter((e) => e.type === "pop").length;
      return { kind, events: R.events, gain: R.gain, duration, popped, chain: R.chain || 0, combo: this.combo, comboStart: R.comboStart, mult: comboMult(this.combo), ...extra };
    }

    // ---------- 落下と補充 ----------
    // 返り値：{ moves: [{ id, fr, fc, tr, tc }], spawns: [{ id, piece, tr, tc, from }], collected: [{ id, r, c, piece }] }
    // 動いた・新しく来た駒は this.moved に記録（次の cascade() で使う）
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
              if (fr !== tr) {
                moves.push({ id: p.id, fr, fc: c, tr, tc: c });
                this.moved.add(p.id);
              }
              this.grid[tr][c] = p;
            }
            // 上の空きを埋める（開いている区間だけ）
            const empty = k + 1;
            for (let j = 0; j < empty; j++) this.grid[rows[j]][c] = null;
            if (seg.open) {
              for (let j = empty - 1, n = 0; j >= 0; j--, n++) {
                const p = this.spawnPiece();
                this.grid[rows[j]][c] = p;
                this.moved.add(p.id);
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
      this.colorSpawns(spawns);
      return { moves, spawns, collected };
    }
    // 補充されたぽよの色を決める：新しいぽよが入って4つ以上のかたまりにはならない色を選ぶ
    // （連鎖は、盤面にあったぽよが落ちてそろったときだけ起きる＝盤面を見れば読める）
    colorSpawns(spawns) {
      const list = spawns.filter((s) => s.piece.t === "c" && this.grid[s.tr][s.tc] === s.piece);
      for (const s of list) s.piece.color = -1;
      list.sort((a, b) => b.tr - a.tr || a.tc - b.tc);
      for (const s of list) {
        const p = s.piece;
        const start = this.randomColor();
        let pick = start;
        for (let i = 0; i < this.level.colors; i++) {
          p.color = (start + i) % this.level.colors;
          if (this.groupAt(s.tr, s.tc).length < CHAIN_MIN) {
            pick = p.color;
            break;
          }
        }
        p.color = pick;
      }
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
      this.drag = null;
      for (let k = 0; k < 40; k++) {
        this.recolor();
        this.breakBig();
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

    // ボット・先読み用の複製（補充の乱数は別にする＝未来は見えない）
    clone(seed) {
      const g = Object.create(Game.prototype);
      Object.assign(g, this);
      g.rng = makeRng(seed);
      g.grid = this.grid.map((row) => row.map((p) => (p ? { ...p } : p)));
      g.goals = this.goals.map((x) => ({ ...x }));
      g.moved = new Set(this.moved);
      g.drag = this.drag ? { id: this.drag.id, path: this.drag.path.map((x) => x.slice()) } : null;
      g.comboHist = { ...this.comboHist };
      g.used = { ...this.used };
      return g;
    }
  }

  return { Game, makeRng, isBooster, isStatic, isMovable, boosterFor, comboMult, comboBonus, TAP_MIN, CHAIN_MIN, DRAG_STEPS, CHARGE_AT, SCORE, RANK };
})();

if (typeof module !== "undefined") module.exports = PopBlast;
