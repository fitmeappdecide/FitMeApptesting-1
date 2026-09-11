(function () {
  const script = document.currentScript;
  const brandKey = script && script.dataset ? script.dataset.brandKey : "";
  const apiBase = script && script.dataset && script.dataset.apiBase ? script.dataset.apiBase : "http://localhost:8000";

  function openModal() {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(26,18,8,.82);z-index:999999;display:grid;place-items:center;color:#fff;font-family:system-ui";
    overlay.innerHTML = '<div style="width:min(460px,92vw);background:#2A2018;border:1px solid #3A3028;border-radius:12px;padding:24px"><div style="color:#C9974A;font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700">FitMe Try-On</div><h2 style="font-family:Georgia,serif;font-size:32px;margin:12px 0">See this on you</h2><p style="color:#9E9080;line-height:1.6">Upload a front photo to get a size recommendation and visual try-on for this product.</p><button id="fitme-close" style="margin-top:18px;background:#A0392B;color:white;border:0;border-radius:999px;padding:12px 18px;font-weight:700">Start</button></div>';
    document.body.appendChild(overlay);
    overlay.querySelector("#fitme-close").addEventListener("click", () => overlay.remove());
  }

  function mount() {
    const addToCart = document.querySelector("[name='add'], button[type='submit'], .add-to-cart");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Try On Me";
    button.style.cssText = "width:100%;margin:12px 0;background:#A0392B;color:white;border:0;border-radius:999px;padding:14px 18px;font-weight:700;cursor:pointer";
    button.addEventListener("click", openModal);
    if (addToCart && addToCart.parentNode) addToCart.parentNode.insertBefore(button, addToCart);
    else document.body.appendChild(button);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
  window.FitMeWidget = { open: openModal, apiBase, brandKey };
})();

