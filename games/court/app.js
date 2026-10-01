(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const EXAMPLES = [
    "既読無視3時間は有罪？",
    "友達との待ち合わせに5分遅れた",
    "最後のプリンを食べた",
    "家族に勝手にスマホを見られた",
    "「何でもいい」と言われて本当に何でもいいものを選んだ",
  ];

  const LOADING_MS = 1600;

  const screens = {
    input: $("screen-input"),
    loading: $("screen-loading"),
    result: $("screen-result"),
  };

  const form = $("case-form");
  const textarea = $("case-text");
  let lastResult = null;
  let busy = false;

  function showScreen(name) {
    Object.entries(screens).forEach(([key, el]) => {
      el.classList.toggle("is-active", key === name);
    });
    window.scrollTo({ top: 0 });
  }

  // ---------- 入力 ----------

  function renderExamples() {
    const list = $("examples");
    EXAMPLES.forEach((text) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "example";
      btn.textContent = text;
      btn.addEventListener("click", () => {
        textarea.value = text;
        updateCount();
        clearError();
      });
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  function updateCount() {
    $("case-count").textContent = textarea.value.length;
  }

  function showError(message) {
    $("case-error").textContent = message;
    form.classList.remove("is-error");
    void form.offsetWidth; // アニメーションをやり直す
    form.classList.add("is-error");
  }

  function clearError() {
    $("case-error").textContent = "";
    form.classList.remove("is-error");
  }

  function submitCase(e) {
    e.preventDefault();
    if (busy) return;

    const result = Court.judge(textarea.value);
    if (!result) {
      showError("事件の内容を入力してください（法廷は暇です）");
      textarea.focus();
      return;
    }

    busy = true;
    clearError();
    textarea.blur(); // スマホのキーボードを閉じる
    lastResult = result;
    showScreen("loading");
    setTimeout(() => {
      renderResult(result);
      busy = false;
    }, LOADING_MS);
  }

  // ---------- 判決 ----------

  function renderResult(r) {
    $("v-caseno").textContent = r.caseNo;
    $("v-case").textContent = r.caseTitle;
    $("v-defendant").textContent = r.defendant;
    $("v-crime").textContent = r.crime;
    $("v-main").textContent = r.main;
    $("v-comment").textContent = r.comment;

    const reasons = $("v-reasons");
    reasons.innerHTML = "";
    r.reasons.forEach((text) => {
      const li = document.createElement("li");
      li.textContent = text;
      reasons.appendChild(li);
    });

    const card = $("verdict-card");
    card.className = "verdict-card tone-" + r.tone;

    const stamp = $("v-stamp");
    stamp.textContent = r.verdict;
    stamp.classList.remove("stamp-in");

    const fill = $("v-guilt-fill");
    fill.style.width = "0";
    $("v-guilt").textContent = "0";
    document.querySelector(".guilt-bar").setAttribute("aria-valuenow", r.guilt);
    $("share-toast").textContent = "";

    showScreen("result");

    void card.offsetWidth;
    card.classList.add("pop-in");
    stamp.classList.add("stamp-in");
    if (navigator.vibrate) navigator.vibrate([20, 60, 40]);

    requestAnimationFrame(() => {
      fill.style.width = r.guilt + "%";
      countUp($("v-guilt"), r.guilt, 900);
    });
  }

  function countUp(el, target, ms) {
    const start = performance.now();
    function step(now) {
      const t = Math.min(1, (now - start) / ms);
      el.textContent = Math.round(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function share() {
    if (!lastResult) return;
    const r = lastResult;
    const text =
      `【どうでもいい裁判所】\n` +
      `${r.caseTitle}\n` +
      `判決：${r.verdict}（有罪度${r.guilt}%）\n` +
      `罪名：${r.crime}\n` +
      `裁判長「${r.comment}」`;
    SiteShare.shareText({ title: "どうでもいい裁判所", text, toastEl: $("share-toast") });
  }

  function again() {
    textarea.value = "";
    updateCount();
    clearError();
    showScreen("input");
  }

  // ---------- イベント ----------

  renderExamples();
  updateCount();
  form.addEventListener("submit", submitCase);
  textarea.addEventListener("input", () => {
    updateCount();
    if (textarea.value.trim()) clearError();
  });
  $("btn-share").addEventListener("click", share);
  $("btn-again").addEventListener("click", again);
})();
