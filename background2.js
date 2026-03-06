// background.js — service worker that calls local Ollama (Llama 3) on http://localhost:11434
// Usage: chrome.runtime.sendMessage({ type: "OLLAMA_GENERATE", model: "llama3", prompt: "..." })

async function callOllama({ model, prompt }) {
  const resp = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model || "llama3",
      prompt,
      stream: false
    })
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Ollama error ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  return data.response || "";
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (!msg || msg.type !== "OLLAMA_GENERATE") return;

      if (!msg.prompt || typeof msg.prompt !== "string") {
        throw new Error("Missing prompt.");
      }

      const output = await callOllama({
        model: msg.model,
        prompt: msg.prompt
      });

      sendResponse({ ok: true, output });
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();

  return true; // keep channel open for async response
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_PANEL" });
});