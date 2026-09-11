function extractProduct() {
  const title = document.querySelector("meta[property='og:title']")?.content || document.title;
  const image = document.querySelector("meta[property='og:image']")?.content;
  const price = document.querySelector("meta[property='product:price:amount']")?.content;
  return { title, brand: title.split(" ")[0], price, images: image ? [image] : [], source_url: location.href, platform: location.hostname };
}

function mountFitMeButton() {
  if (document.getElementById("fitme-lens-button")) return;
  const button = document.createElement("button");
  button.id = "fitme-lens-button";
  button.textContent = "Try on FitMe";
  button.style.cssText = "position:fixed;right:18px;bottom:18px;z-index:2147483647;background:#A0392B;color:#fff;border:1px solid #3A3028;border-radius:999px;padding:13px 18px;font-weight:700;box-shadow:0 12px 32px rgba(0,0,0,.35)";
  button.addEventListener("click", () => chrome.runtime.sendMessage({ type: "FITME_OPEN", product: extractProduct() }));
  document.body.appendChild(button);
}

mountFitMeButton();

