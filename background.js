// background.js — service worker that calls local Ollama (Llama 3) on http://localhost:11434
// Usage: chrome.runtime.sendMessage({ type: "OLLAMA_GENERATE", model: "llama3", prompt: "..." })


function buildReviewPrompt(userPrompt){
  return `You are reviewing an NAISS compute allocation proposal.

You must output FOUR sections in this exact order:
1) Possibility
2) Efficiency
3) Track Record
4) Suggested Allocation

Global rules:
- Important: Do not rewrite or shorten the template. Fill it exactly.
- For each question: answer in 1–3 sentences.
- EXCEPTION: For the Efficiency question "Is the planned use of the resources, as described in the proposal, an efficient use of the resources?"
  you MUST follow the exact multi-line structure given (Compute usage bullets + Storage usage bullets + final judgement),
  even if that exceeds 1–3 sentences.
- The answer must include a short justification based on the proposal information.
- Do not respond with only "Yes" or "No".
- When possible, refer to specific details from the proposal (software, resources, or past usage).
- Use exactly this format for each Q/A pair and leave ONE blank line after each pair:

Q: <question>
A: <answer>

- Answers must be based ONLY on the provided proposal information. Do NOT assume or invent facts.
- When answering "Yes", you must reference a concrete detail from the proposal (e.g. a Berzelius project ID, usage value, or software mentioned).
- If you cannot find supporting evidence in the text, answer "No" or "Insufficient information".

Evidence rules (important):
- If the Past Resource Usage section says "(no Berzelius-* past projects found)" for the PI, then the answer to:
  "Has the applicant previously used the resources listed in the proposal?"
  MUST be "No".
- Do not infer previous usage if none is listed.

Software license rule:
- If the proposal lists open-source software (e.g., PyTorch, RDKit, PyTorch Lightning, PyTorch Geometric, MONAI, etc.), assume no special licenses are required on NAISS resources.
- In that case, answer "Yes" to the license question and explain briefly that the software is open source.
- Only answer "No" if the proposal requests commercial software that requires a license.

After each section (except Suggested Allocation), output:
Rating: <Not Applicable|1-5> (<label if 1-5>)
Comments: <max 3 sentences>

Rating scale:
1: Poor
2: Weak
3: Good
4: Very good
5: Very good to excellent

For the Track Record section, Rating may be "Not Applicable" if there is no prior Berzelius allocation.

Suggested Allocation section:
- Provide a short suggested allocation and justification.
- MAX 3 sentences total.
- Do NOT include a rating line.

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
Output rules for this section:
- The Efficiency section contains TWO questions that must both be answered before the rating.
- The answer must begin by repeating the Q line exactly.
- Do NOT omit the Q line.
- Do NOT write "Final judgement:"; write the judgement sentence(s) directly starting with "Yes." or "No."
Q: Is the planned use of the resources, as described in the proposal, an efficient use of the resources?
A:

Here is a list of the planned usage.

Compute usage: <TOTAL GPU-h/month if stated; otherwise "not specified"> in total
• <project / team member / work package + GPU-h/month if stated>
• <project / team member / work package + GPU-h/month if stated>
• <project / team member / work package + GPU-h/month if stated>
• <project / team member / work package + GPU-h/month if stated>

Storage usage: <TOTAL storage size if stated; otherwise "not specified"> in total
• <what will be stored + where it will be stored + size if stated>
• <what will be stored + where it will be stored + size if stated>
• <what will be stored + where it will be stored + size if stated>

Final judgement sentence (start with "Yes." or "No.") must appear immediately after the Storage bullets.
- Do NOT output any placeholder lines like "<...>".

Rules:
- Use ONLY information explicitly stated in the proposal text.
- Do NOT invent or estimate numbers.
- Do NOT repeat any instructions in the output.
- If any compute value (total GPU-h/month or per-project GPU-h/month) is not explicitly stated, write "not specified".
- If any storage size is not explicitly stated, write "not specified".
- If storage is only stated as "default storage 2,000 GiB", you may write "2,000 GiB (~2 TB)".

Important rules:
- The compute bullets MUST describe planned usage by project, team member, or work package (from the "Estimate by Project and Team Member" section).
- DO NOT use the hardware split (Ampere vs Hopper) as compute bullets.
- If the proposal provides a per-project breakdown, include at least FOUR compute bullets.
- For storage bullets, describe WHAT will be stored (datasets, checkpoints, artifacts).
- Storage bullets must summarize the storage usage plan described in the proposal.
- Only include sizes if they are explicitly stated.

Q: Does the proposal describe planned usage of the resources in line with best practice of the application area?
A:

After answering BOTH Efficiency questions above, output:

Rating:
Comments:

=== Track Record ===
Q: Has the applicant used previous Berzelius allocations, both compute and storage, as granted and described in previous proposals?
A:

Rating:
Comments:

=== Suggested Allocation ===
Output the suggested allocation in a tab-separated table with EXACTLY the following columns:

Resource	Requested	Suggested	Unit	Requested	Suggested	Unit

Then output a short comment explaining the recommendation.

Rules:
- Use the resources listed in the "Resources table" section of the proposal.
- The first Requested column refers to compute or storage capacity.
- The second Requested column refers to file quota (for storage).
- Fill the Suggested columns with your recommendation.
- If you recommend keeping the requested allocation, repeat the same value.
- Use tab-separated values.
- The comment must be 1–3 sentences.
- The comment must appear AFTER the table.

Format example:

Resource	Requested	Suggested	Unit	Requested	Suggested	Unit
Berzelius Ampere @ NSC	7000	7000	GPU-h/month		
Berzelius Hopper @ NSC	3000	3000	GPU-h/month		
Berzelius Storage @ NSC	2000	2000	GiB	2000000	2000000	files

Comment: <short explanation of the recommendation>

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
      stream: false,
      options: { temperature: 0, num_predict: 1400, num_ctx: 4096 }
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