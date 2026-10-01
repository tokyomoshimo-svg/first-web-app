// サイト共通のシェア処理
// スマホの共有機能が使えればそれを使い、使えなければ文章をクリップボードにコピーする

(() => {
  "use strict";

  let toastTimer = null;

  function showToast(el, message) {
    if (!el) return;
    el.textContent = message;
    el.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("is-visible"), 2000);
  }

  // text: 共有する文章 / title: 共有タイトル / toastEl: コピー時のお知らせを出す要素
  async function shareText({ title, text, toastEl }) {
    const url = location.href.split("#")[0];

    if (navigator.share) {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (e) {
        if (e.name === "AbortError") return; // ユーザーがキャンセル
      }
    }

    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      showToast(toastEl, "結果をコピーしました");
    } catch (e) {
      showToast(toastEl, "コピーできませんでした");
    }
  }

  window.SiteShare = { shareText, showToast };
})();
