// background.js — service worker that calls local Ollama (Llama 3) on http://localhost:11434
// Usage: chrome.runtime.sendMessage({ type: "OLLAMA_GENERATE", model: "llama3", prompt: "..." })


function buildReviewPrompt(userPrompt){
  return `You are reviewing an NAISS compute allocation proposal.

You must output TWO sections in this exact order: "Possibility" then "Efficiency".

Global rules:
- For each question: answer MAX TWO sentences.
- Use exactly this format for each Q/A pair:
Q: <question>
A: <answer>
- After each section’s questions, output:
Rating: <1-5> (<label>)
Comments: <max 3 sentences>

Rating scale (use the label exactly):
1: Poor
2: Weak
3: Good
4: Very good
5: Very good to excellent

=== Possibility ===
Q: Has the applicant previously used the resources listed in the proposal?
A:

Q: Does the applicant have the ability to carry out the calculations described in the proposal?
A:

Q: Is it viable to use the proposed software on the resources listed in the proposal?
A:

Q: In particular, does the resources listed in the proposal have licenses for the software requested in the proposal?
A:

Rating:
Comments:

=== Efficiency ===
Q: Is the planned use of the resources, as described in the proposal, an efficient use of the resources?
A:

Q: Does the proposal describe planned usage of the resources in line with best practice of the application area?
A:

Rating:
Comments:

---------------------
Proposal information:
${userPrompt}
`;
}




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
        prompt: buildReviewPrompt(msg.prompt)
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