(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const screens = {
    start: $("screen-start"),
    question: $("screen-question"),
    loading: $("screen-loading"),
    result: $("screen-result"),
  };

  const LOADING_MS = 1400;

  // answers[i] = 選んだ選択肢のインデックス
  let answers = [];
  let current = 0;
  let locked = false; // 連打防止

  function showScreen(name) {
    Object.entries(screens).forEach(([key, el]) => {
      el.classList.toggle("is-active", key === name);
    });
    window.scrollTo({ top: 0 });
  }

  // ---------- 質問 ----------

  function startQuiz() {
    answers = [];
    current = 0;
    showScreen("question");
    renderQuestion();
  }

  function renderQuestion() {
    const q = QUESTIONS[current];
    const total = QUESTIONS.length;

    $("q-number").textContent = current + 1;
    $("q-total").textContent = total;
    $("q-label-num").textContent = current + 1;
    $("q-text").textContent = q.text;

    const percent = Math.round((current / total) * 100);
    $("progress-fill").style.width = percent + "%";
    document.querySelector(".progress-bar").setAttribute("aria-valuenow", percent);

    const optionsEl = $("q-options");
    optionsEl.innerHTML = "";
    q.options.forEach((opt, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "option";
      if (answers[current] === i) btn.classList.add("is-selected");
      btn.style.animationDelay = i * 60 + "ms";

      const emoji = document.createElement("span");
      emoji.className = "option-emoji";
      emoji.setAttribute("aria-hidden", "true");
      emoji.textContent = opt.emoji;

      const label = document.createElement("span");
      label.className = "option-label";
      label.textContent = opt.label;

      btn.append(emoji, label);
      btn.addEventListener("click", () => selectOption(i, btn));
      optionsEl.appendChild(btn);
    });

    // カードの入場アニメーションをやり直す
    const card = $("q-card");
    card.classList.remove("slide-in");
    void card.offsetWidth;
    card.classList.add("slide-in");

    locked = false;
  }

  function selectOption(index, btn) {
    if (locked) return;
    locked = true;

    answers[current] = index;
    document.querySelectorAll(".option").forEach((el) => el.classList.remove("is-selected"));
    btn.classList.add("is-selected");
    if (navigator.vibrate) navigator.vibrate(15);

    setTimeout(() => {
      if (current < QUESTIONS.length - 1) {
        current++;
        renderQuestion();
      } else {
        $("progress-fill").style.width = "100%";
        showLoading();
      }
    }, 280);
  }

  function goBack() {
    if (locked) return;
    if (current === 0) {
      showScreen("start");
      return;
    }
    current--;
    renderQuestion();
  }

  // ---------- 診断 ----------

  // points: 合計点 / hits: 加点された質問の数（同点時の判定に使う）
  function calcScores() {
    const points = {};
    const hits = {};
    Object.keys(TOWNS).forEach((key) => {
      points[key] = 0;
      hits[key] = 0;
    });
    answers.forEach((optIndex, qIndex) => {
      const opt = QUESTIONS[qIndex].options[optIndex];
      Object.entries(opt.scores).forEach(([town, pt]) => {
        points[town] += pt;
        hits[town]++;
      });
    });
    return { points, hits };
  }

  // 合計点の高い順。同点なら多くの質問で選ばれた街を優先し、それでも同じならTOWNSの定義順
  function rankTowns({ points, hits }) {
    return Object.keys(TOWNS).sort((a, b) => points[b] - points[a] || hits[b] - hits[a]);
  }

  function showLoading() {
    showScreen("loading");
    setTimeout(showResult, LOADING_MS);
  }

  let lastResult = null;

  function showResult() {
    const ranking = rankTowns(calcScores());
    const town = TOWNS[ranking[0]];
    const sub = TOWNS[ranking[1]];
    lastResult = town;

    document.documentElement.style.setProperty("--result-color", town.color);
    $("result-emoji").textContent = town.emoji;
    $("result-type").textContent = town.type;
    $("result-town").textContent = town.name;
    $("result-catch").textContent = town.catch;
    $("result-desc").textContent = town.desc;
    $("result-sub").textContent = `${sub.emoji} ${sub.name}（${sub.type}タイプ）`;

    const featuresEl = $("result-features");
    featuresEl.innerHTML = "";
    town.features.forEach((f) => {
      const li = document.createElement("li");
      li.textContent = f;
      featuresEl.appendChild(li);
    });

    $("share-toast").textContent = "";
    showScreen("result");

    const card = $("result-card");
    card.classList.remove("pop-in");
    void card.offsetWidth;
    card.classList.add("pop-in");
  }

  // ---------- シェア ----------

  async function share() {
    if (!lastResult) return;
    const text = `東京の街診断の結果、私は「${lastResult.type}タイプ」でした！おすすめの街は${lastResult.name}${lastResult.emoji}`;
    const url = location.href.split("#")[0];

    if (navigator.share) {
      try {
        await navigator.share({ title: "東京の街診断", text, url });
        return;
      } catch (e) {
        if (e.name === "AbortError") return; // ユーザーがキャンセル
      }
    }

    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      toast("結果をコピーしました");
    } catch (e) {
      toast("コピーできませんでした");
    }
  }

  let toastTimer = null;
  function toast(message) {
    const el = $("share-toast");
    el.textContent = message;
    el.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("is-visible"), 2000);
  }

  // ---------- イベント ----------

  $("btn-start").addEventListener("click", startQuiz);
  $("btn-back").addEventListener("click", goBack);
  $("btn-retry").addEventListener("click", () => showScreen("start"));
  $("btn-share").addEventListener("click", share);
})();
