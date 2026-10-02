// ラーメンを伸ばすな：ゲームの中身（画面に依存しない）
//
// stretch（伸び具合 0〜100%）は時間とともに増え、100%で終了。
// 1口食べると伸び具合が下がる。ただし「口の中（mouth）」がいっぱいだと
// あまり食べられず、満杯になると「むせる」＝少しの間食べられない。
// → 連打よりも、飲み込むリズムに合わせて食べるほうが強い。

const RamenEngine = (() => {
  "use strict";

  const C = {
    BITE: 7, // 1口で食べる量（%）。口が空のとき
    MOUTH_PER_BITE: 25, // 1口で口に入る量
    MOUTH_DRAIN: 55, // 1秒で飲み込む量（＝気持ちよく食べられるのは1秒に2口くらい）
    FULL_PENALTY: 0.9, // 口がいっぱいに近いほど、1口の量が減る（最大90%減）
    CHOKE_TIME: 1.5, // むせて食べられない秒数
    CHOKE_MOUTH: 30, // むせたあとの口の中
    CHOKE_SPILL: 12, // むせると麺が戻ってきて、伸び具合が上がる
    BASE_RATE: 5, // 最初の伸びる速さ（%/秒）
    RATE_GROW: 1.1, // 1秒ごとに速くなる量
    KAEDAMA_BONUS: 300, // 1杯（100%）食べるごとの替え玉ボーナス
    KAEDAMA_RELIEF: 15, // 替え玉で伸び具合が下がる量
    POINTS_PER_PERCENT: 10, // 1%食べると10点
  };

  function create() {
    return { t: 0, stretch: 0, eaten: 0, score: 0, mouth: 0, choke: 0, bites: 0, chokes: 0, kaedama: 0, over: false };
  }

  // 伸びる速さ：だんだん速く、少しだけ波がある
  function rate(s) {
    return (C.BASE_RATE + C.RATE_GROW * s.t) * (1 + 0.2 * Math.sin(s.t * 1.9));
  }

  function step(s, dt) {
    if (s.over) return;
    s.t += dt;
    s.stretch += rate(s) * dt;
    s.mouth = Math.max(0, s.mouth - C.MOUTH_DRAIN * dt);
    if (s.choke > 0) s.choke = Math.max(0, s.choke - dt);
    if (s.stretch >= 100) {
      s.stretch = 100;
      s.over = true;
    }
  }

  // 1口食べる。結果の種類を返す（画面の演出に使う）
  function bite(s) {
    if (s.over) return { type: "over" };
    if (s.choke > 0) return { type: "blocked" };

    const eff = 1 - C.FULL_PENALTY * Math.min(1, s.mouth / 100);
    const amount = C.BITE * eff;
    s.stretch = Math.max(0, s.stretch - amount);
    s.eaten += amount;
    s.score += Math.round(amount * C.POINTS_PER_PERCENT);
    s.mouth += C.MOUTH_PER_BITE;
    s.bites++;

    if (s.mouth >= 100) {
      s.choke = C.CHOKE_TIME;
      s.mouth = C.CHOKE_MOUTH;
      s.stretch = Math.min(100, s.stretch + C.CHOKE_SPILL);
      s.chokes++;
      return { type: "choke", amount };
    }
    if (Math.floor(s.eaten / 100) > s.kaedama) {
      s.kaedama++;
      s.score += C.KAEDAMA_BONUS;
      s.stretch = Math.max(0, s.stretch - C.KAEDAMA_RELIEF);
      return { type: "kaedama", amount };
    }
    return { type: "bite", amount, eff };
  }

  return { create, step, bite, rate, C };
})();

if (typeof module !== "undefined") module.exports = RamenEngine;
