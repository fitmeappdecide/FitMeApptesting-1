chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "FITME_OPEN") {
    const encoded = encodeURIComponent(JSON.stringify(message.product));
    chrome.tabs.create({ url: `http://localhost:3000/tryon/preload?product=${encoded}` });
    sendResponse({ status: "opened" });
  }
});

