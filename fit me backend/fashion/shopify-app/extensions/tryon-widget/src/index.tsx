const mount = () => {
  const target = document.querySelector("form[action*='/cart/add']");
  if (!target || document.getElementById("fitme-shopify-button")) return;
  const button = document.createElement("button");
  button.id = "fitme-shopify-button";
  button.type = "button";
  button.textContent = "Try On Me";
  button.style.cssText = "width:100%;margin:12px 0;background:#A0392B;color:#fff;border:0;border-radius:999px;padding:14px 18px;font-weight:700";
  target.prepend(button);
};
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();

