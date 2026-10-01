// どうでもいい裁判所：判決エンジン（画面に依存しない純粋な処理）
// 同じ文章からは、いつも同じ判決が出る（文章から乱数の種を作るため）。

const Court = (() => {
  "use strict";

  const MAX_LENGTH = 200;

  // 文字列 → 32bitハッシュ（FNV-1a）
  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  // 種から決まった順番の乱数を出す（mulberry32）
  function createRandom(seed) {
    let a = seed;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 全角英数を半角に、英字を小文字にそろえる
  function normalize(text) {
    return String(text || "").normalize("NFKC").toLowerCase().trim();
  }

  function countHits(text, keywords) {
    return keywords.reduce((n, k) => n + (text.includes(k) ? 1 : 0), 0);
  }

  // 文章の中で最初にキーワードが出てくる位置（なければ Infinity）
  function firstIndex(text, keywords) {
    return keywords.reduce((min, k) => {
      const i = text.indexOf(k);
      return i >= 0 && i < min ? i : min;
    }, Infinity);
  }

  // 当たったキーワードが最も多いものを選ぶ。同数なら文章の前のほうに出てきたものを優先
  function bestMatch(text, list) {
    let best = null;
    let bestHits = 0;
    let bestPos = Infinity;
    list.forEach((item) => {
      const hits = countHits(text, item.keywords);
      if (!hits) return;
      const pos = firstIndex(text, item.keywords);
      if (hits > bestHits || (hits === bestHits && pos < bestPos)) {
        best = item;
        bestHits = hits;
        bestPos = pos;
      }
    });
    return best;
  }

  const KANJI_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 半: 0.5 };
  const UNIT_MINUTES = { 秒: 1 / 60, 分: 1, 時間: 60, 日: 1440, 週間: 10080, か月: 43200, ヶ月: 43200, ヵ月: 43200, 年: 525600 };

  // 「5分」「3時間」「三日」などを分に換算する
  function findDuration(text) {
    const m = text.match(/(\d+(?:\.\d+)?|[一二三四五六七八九十半])\s*(秒|分|時間|日|週間|か月|ヶ月|ヵ月|年)/);
    if (!m) return null;
    const num = KANJI_NUM[m[1]] !== undefined ? KANJI_NUM[m[1]] : parseFloat(m[1]);
    return { text: m[0], minutes: num * UNIT_MINUTES[m[2]] };
  }

  // 「500円」「1,000円」「3万円」などを数値にする
  function findYen(text) {
    const m = text.match(/(\d[\d,]*(?:\.\d+)?)\s*(万)?\s*円/);
    if (!m) return null;
    const yen = parseFloat(m[1].replace(/,/g, "")) * (m[2] ? 10000 : 1);
    return { text: m[0], yen };
  }

  function durationRule(d) {
    if (!d) return null;
    if (d.minutes <= 5) {
      return { delta: -15, reason: `「${d.text}」は、東京の電車がもう1本来るくらいの時間であり、誤差の範囲とみなす。` };
    }
    if (d.minutes >= 180) {
      const cups = Math.floor(d.minutes / 3);
      return { delta: 10, reason: `「${d.text}」は、カップ麺を${cups.toLocaleString()}個作れる長さであり、看過できない。` };
    }
    return { delta: 0, reason: `「${d.text}」という時間の長さを、裁判所は慎重に検討した。` };
  }

  function yenRule(y) {
    if (!y) return null;
    if (y.yen <= 500) {
      return { delta: -10, reason: `「${y.text}」は、自販機の飲み物${Math.max(1, Math.floor(y.yen / 150))}本分程度の金額である。` };
    }
    if (y.yen >= 10000) {
      return { delta: 10, reason: `「${y.text}」は、どうでもよくない金額である。` };
    }
    return { delta: 0, reason: `「${y.text}」という金額は、ランチ数回分として考慮した。` };
  }

  const SELF_BLAME = /(俺|おれ|オレ|僕|ぼく|私|わたし|あたし|自分|うち)(が|って)悪い/;
  // 「〜された」「〜してくれない」「返信がない」など、相手が加害者っぽい言い方
  const OTHER_IS_GUILTY = /(され|られ)(た|て|る|ま)|くれな|返信がな|返事がな|連絡がな/;
  const PEOPLE_LABEL = { family: "家族", partner: "恋人", friend: "友人" };

  function pick(list, rand) {
    return list[Math.floor(rand() * list.length)];
  }

  function clamp(n) {
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  // 判決を出す。text が空のときは null を返す
  function judge(rawText, now = new Date()) {
    const original = String(rawText || "").trim().slice(0, MAX_LENGTH);
    const text = normalize(original);
    if (!text) return null;

    const rand = createRandom(hash(text));
    const act = bestMatch(text, ACTS);
    const people = bestMatch(text, PEOPLE);

    // 基本の有罪度
    const range = act ? act.guilt : GENERIC.guilt;
    let guilt = range[0] + rand() * (range[1] - range[0]);

    const reasons = [];
    reasons.push(pick(act ? act.reasons : GENERIC.reasons, rand));
    if (people) reasons.push(pick(people.reasons, rand));

    // 補正（謝った・わざと・常習など）
    const modReasons = [];
    MODIFIERS.forEach((mod) => {
      if (countHits(text, mod.keywords) > 0) {
        guilt += mod.delta;
        modReasons.push(mod.reason);
      }
    });

    [durationRule(findDuration(text)), yenRule(findYen(text))].forEach((r) => {
      if (r) {
        guilt += r.delta;
        modReasons.push(r.reason);
      }
    });

    const exclaims = (text.match(/!/g) || []).length;
    if (exclaims >= 2) {
      guilt += 5;
      modReasons.push("供述から強い怒りを感じる。裁判所も少しびびっている。");
    }

    if (text.length < 8) {
      modReasons.push("供述が短すぎるため、足りない部分は裁判長の想像で補った。");
    } else if (text.length > 100) {
      modReasons.push("供述がとても長い。その熱意だけは認める。");
    }

    // 判決理由は最大3つまで
    reasons.push(...modReasons);
    const shownReasons = reasons.slice(0, 3);

    guilt = clamp(guilt);
    const verdict = VERDICTS.find((v) => guilt <= v.max);
    const sentence = pick(act ? act.sentences : GENERIC.sentences, rand);

    // 被告は誰か：「〜された」なら相手、「俺が悪い？」なら自分
    let defendant = "あなた";
    if (OTHER_IS_GUILTY.test(text) && !SELF_BLAME.test(text)) {
      defendant = people ? `相手（${PEOPLE_LABEL[people.id]}）` : "相手";
    }

    // 裁判長の一言：事件の種類・相手・判決の重さからひとつ選ぶ
    const commentPool = [
      ...(act ? act.comments : GENERIC.comments),
      ...(people ? people.comments : []),
      ...VERDICT_COMMENTS[verdict.tone],
    ];

    const year = now.getFullYear() - 2018; // 令和
    const caseNo = `令和${year}年（ど）第${(hash(text + "#") % 9000) + 1000}号`;
    const title = original.length > 40 ? original.slice(0, 40) + "…" : original;

    return {
      caseNo,
      caseTitle: `「${title}」事件`,
      defendant,
      crime: act ? act.crime : pick(GENERIC.crimes, rand),
      guilt,
      verdict: verdict.label,
      tone: verdict.tone,
      main: verdict.main(sentence),
      reasons: shownReasons,
      comment: pick(commentPool, rand),
      matched: { act: act ? act.id : null, people: people ? people.id : null },
    };
  }

  return { judge, MAX_LENGTH };
})();
