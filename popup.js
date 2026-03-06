async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function setStatus(msg) {
  document.getElementById("status").innerText = msg;
}

function setPreview(text) {
  document.getElementById("preview").value = text || "";
}

async function sendToContentScript(messageOrType) {
  const tab = await getActiveTab();
  const message = typeof messageOrType === "string" ? { type: messageOrType } : messageOrType;
  return await chrome.tabs.sendMessage(tab.id, message);
}

function buildReviewPrompt(suprProposal) {
  return `
You are assisting with reviewing an HPC compute proposal.

Use the proposal information below and draft answers in a paste-ready format for a reviewer.

### Proposal (scraped)
${suprProposal.promptText}

### Review questions
1) Briefly summarize the project and its relevance.
2) Is the requested compute reasonable and consistent with the described work? Mention any red flags.
3) What clarification questions should the reviewer ask?
4) Provide a recommended decision (approve / approve with concerns / reject) with rationale.

Write clearly. Use short paragraphs and bullet points where helpful.
`.trim();
}

document.getElementById("scrape").addEventListener("click", async () => {
  try {
    setStatus("Scraping...");
    const resp = await sendToContentScript("SCRAPE_PROPOSAL");
    if (!resp?.ok) throw new Error(resp?.error || "Scrape failed.");

    await chrome.storage.local.set({ suprProposal: resp.data });
    setPreview(resp.data?.promptText || "");
    setStatus("Saved scraped proposal.");
  } catch (e) {
    setStatus(`Error: ${e.message}`);
  }
});

document.getElementById("show").addEventListener("click", async () => {
  const { suprProposal, suprDraft } = await chrome.storage.local.get(["suprProposal", "suprDraft"]);

  if (suprDraft) {
    setPreview(suprDraft);
    setStatus("Showing last generated draft.");
    return;
  }

  if (!suprProposal) {
    setStatus("No stored proposal found.");
    setPreview("");
    return;
  }

  setPreview(suprProposal.promptText || "");
  setStatus("Showing stored proposal.");
});

document.getElementById("clear").addEventListener("click", async () => {
  await chrome.storage.local.remove(["suprProposal", "suprDraft"]);
  setStatus("Cleared stored proposal + draft.");
  setPreview("");
});

document.getElementById("generate").addEventListener("click", async () => {
  try {
    setStatus("Loading stored proposal...");
    const { suprProposal } = await chrome.storage.local.get(["suprProposal"]);
    if (!suprProposal?.promptText) throw new Error("No stored proposal. Click Scrape first.");

    const prompt = buildReviewPrompt(suprProposal);

    setStatus("Calling local Llama3 (Ollama)...");
    const resp = await chrome.runtime.sendMessage({
      type: "OLLAMA_GENERATE",
      model: "llama3",
      prompt
    });

    if (!resp?.ok) throw new Error(resp?.error || "Generation failed.");

    await chrome.storage.local.set({ suprDraft: resp.output });
    setPreview(resp.output);
    setStatus("Draft generated (local).");
  } catch (e) {
    setStatus(`Error: ${e.message}`);
  }
});