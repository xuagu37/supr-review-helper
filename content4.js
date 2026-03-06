// content.js (SUPR scraper: Proposal fields + Resources table + Past Resource Usage (PI, Berzelius-* only))
function togglePanel() {
  const existing = document.getElementById("supr-helper-panel");

  if (existing) {
    existing.remove();
    chrome.storage.local.set({ suprPanelOpen: false });
    return;
  }

  const panel = document.createElement("div");
  panel.id = "supr-helper-panel";

  panel.style.cssText = `
    position: fixed;
    top: 0;
    right: 0;
    width: 520px;
    height: 100vh;
    background: white;
    border-left: 1px solid #ddd;
    box-shadow: -3px 0 10px rgba(0,0,0,0.15);
    z-index: 2147483647;
    display: flex;
    flex-direction: column;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  `;

  panel.innerHTML = `
    <div style="padding:10px;border-bottom:1px solid #eee;font-weight:bold;display:flex;justify-content:space-between;align-items:center;">
      <span>SUPR Review Helper</span>
      <button id="supr-close">✕</button>
    </div>

    <div style="padding:10px;display:flex;gap:8px;flex-wrap:wrap;">
      <button id="supr-scrape">Scrape Proposal</button>
      <button id="supr-copy">Copy Prompt</button>
      <button id="supr-generate">Generate Answers</button>
      <button id="supr-clear">Clear</button>
    </div>

    <textarea id="supr-output"
      style="flex:1;margin:10px;border:1px solid #ccc;padding:8px;resize:none;font-family:monospace;"></textarea>
  `;

  document.body.appendChild(panel);
  chrome.storage.local.set({ suprPanelOpen: true });

  const output = document.getElementById("supr-output");
  chrome.storage.local.get(["suprLastPrompt"], (res) => {
   if (res.suprLastPrompt) {
    output.value = res.suprLastPrompt;
   }
  });

  document.getElementById("supr-close").onclick = () => {
    panel.remove();
    chrome.storage.local.set({ suprPanelOpen: false });
  };

  document.getElementById("supr-scrape").onclick = () => {
    const data = scrapeProposal();
    output.value = data.promptText;
    chrome.storage.local.set({ suprLastPrompt: data.promptText });
  };

  document.getElementById("supr-copy").onclick = async () => {
    const txt = output.value || "";
    if (!txt) return;
    await navigator.clipboard.writeText(txt);
  };

  document.getElementById("supr-clear").onclick = () => {
    output.value = "";
    chrome.storage.local.remove("suprLastPrompt");
  };

  document.getElementById("supr-generate").onclick = async () => {
    const prompt = output.value;
    if (!prompt) return;

    output.value += "\n\nGenerating answer with local Llama3...\n";

    const resp = await chrome.runtime.sendMessage({
      type: "GENERATE_REVIEW",
      prompt: prompt
    });

    if (resp && resp.ok) {
      output.value += "\n" + resp.text;
    } else {
      output.value += "\n[Generation failed]";
    }
  };
}

function textOf(el) {
  return (el?.innerText || "").trim();
}

function normalize(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function isBerzeliusDnr(text) {
  return /^Berzelius-\d{4}-\d+$/i.test(normalize(text));
}

// --- Generic "showlabel/showvalue" helpers -------------------------------------

function extractShowField(labelPrefix) {
  const labels = Array.from(document.querySelectorAll(".showlabel"));
  const labelEl = labels.find((el) => normalize(el.innerText).startsWith(labelPrefix));
  if (!labelEl) return "";

  const row = labelEl.closest(".row") || labelEl.parentElement;
  const valueEl = row?.querySelector(".showvalue") || labelEl.nextElementSibling;

  return normalize(valueEl?.innerText || "");
}

// Prefer the full ("long") value if SUPR provides it, without requiring clicking Expand/All.
function extractLongFromShowValue(labelPrefix) {
  const labels = Array.from(document.querySelectorAll(".showlabel"));
  const labelEl = labels.find((el) => normalize(el.innerText).startsWith(labelPrefix));
  if (!labelEl) return "";

  const row = labelEl.closest(".row") || labelEl.parentElement;
  const valueEl = row?.querySelector(".showvalue") || labelEl.nextElementSibling;
  if (!valueEl) return "";

  const longEl = valueEl.querySelector(".long_supr_value");
  if (longEl && normalize(longEl.innerText)) return normalize(longEl.innerText);

  return normalize(valueEl.innerText || "");
}

function extractTitle() {
  const h1 = document.querySelector("h1");
  if (h1 && normalize(h1.innerText)) return normalize(h1.innerText);

  if (document.title && normalize(document.title)) return normalize(document.title);

  const h2 = document.querySelector("h2");
  if (h2 && normalize(h2.innerText)) return normalize(h2.innerText);

  return "";
}

// --- Resources table on proposal page ------------------------------------------

function findResourcesTable() {
  const byId = document.querySelector("#resourceproposals_table");
  if (byId) return byId;

  const header = document.querySelector("#resourceproposals");
  if (header) {
    const nextTable = header.parentElement?.querySelector("table");
    if (nextTable) return nextTable;

    let el = header.nextElementSibling;
    while (el) {
      if (el.tagName?.toLowerCase() === "table") return el;
      el = el.nextElementSibling;
    }
  }

  return null;
}

// Column headers are often stored in aria-label on role=columnheader cells.
// e.g. aria-label="Requested: No sort applied" -> "Requested"
function extractHeaderNames(tableEl) {
  if (!tableEl) return [];

  // 1) tablesorter: role=columnheader + aria-label
  const ariaCells = Array.from(tableEl.querySelectorAll("thead [role='columnheader']"));
  const ariaHeaders = ariaCells
    .map((cell) => {
      const label = cell.getAttribute("aria-label") || "";
      return label ? label.split(":")[0].trim() : "";
    })
    .filter(Boolean);

  if (ariaHeaders.length) return ariaHeaders;

  // 2) standard thead th text
  const ths = Array.from(tableEl.querySelectorAll("thead th"));
  const thHeaders = ths.map((th) => normalize(th.innerText)).filter(Boolean);
  if (thHeaders.length) return thHeaders;

  // 3) sometimes headers are td in thead
  const tds = Array.from(tableEl.querySelectorAll("thead td"));
  const tdHeaders = tds.map((td) => normalize(td.innerText)).filter(Boolean);
  if (tdHeaders.length) return tdHeaders;

  return [];
}

// Keep columns up to the 2nd "Percentage" if present (Storage has 2), otherwise up to 1st (Compute has 1).
function computeKeepCols(headers) {
  if (!headers || headers.length === 0) return 9999;

  let keepCols = headers.length;
  let percentageCount = 0;

  for (let i = 0; i < headers.length; i++) {
    if (headers[i].toLowerCase() === "percentage") {
      percentageCount++;
      if (percentageCount === 2) {
        keepCols = i + 1;
        return keepCols;
      }
    }
  }

  if (percentageCount === 1) {
    const idx = headers.findIndex((h) => h.toLowerCase() === "percentage");
    return idx === -1 ? headers.length : idx + 1;
  }

  return keepCols;
}

function tableToTSV(tableEl, maxRows = 30) {
  if (!tableEl) return "";

  const headers = extractHeaderNames(tableEl);

  // Decide how many columns to keep:
  // - If 2 "Percentage" columns exist => keep through 2nd Percentage
  // - Else if 1 exists => keep through 1st Percentage
  // - Else keep all (but later we still strip Graph/script column)
  let keepCols = headers.length || 9999;

  if (headers.length) {
    let pctCount = 0;
    for (let i = 0; i < headers.length; i++) {
      if (headers[i].toLowerCase() === "percentage") {
        pctCount++;
        if (pctCount === 2) {
          keepCols = i + 1;
          break;
        }
      }
    }
    if (pctCount === 1) {
      const idx = headers.findIndex((h) => h.toLowerCase() === "percentage");
      keepCols = idx === -1 ? headers.length : idx + 1;
    }

    // If there is a "Graph" header, drop it and anything after it
    const graphIdx = headers.findIndex((h) => h.toLowerCase() === "graph");
    if (graphIdx !== -1) {
      keepCols = Math.min(keepCols, graphIdx);
    }
  }

  const lines = [];

  if (headers.length) {
    lines.push(headers.slice(0, keepCols).join("\t"));
  }

  const rows = Array.from(tableEl.querySelectorAll("tbody tr")).slice(0, maxRows);

  for (const tr of rows) {
    let cells = Array.from(tr.querySelectorAll("td")).map((td) => normalize(td.innerText));

    // If we couldn't determine headers, still try to remove the last Graph/script column
    // based on content heuristics
    if (!headers.length && cells.length) {
      const last = (cells[cells.length - 1] || "").toLowerCase();
      if (last.includes("$().ready") || last.includes("show graph") || last.includes("hide graph")) {
        cells = cells.slice(0, -1);
      }
    }

    cells = cells.slice(0, keepCols);

    // Final safety: if the last kept cell still looks like JS, drop it
    if (cells.length) {
      const last = (cells[cells.length - 1] || "").toLowerCase();
      if (last.includes("$().ready") || last.includes("show graph") || last.includes("hide graph")) {
        cells = cells.slice(0, -1);
      }
    }

    if (cells.length === 0) continue;
    lines.push(cells.join("\t"));
  }

  return lines.join("\n").trim();
}

function scrapeResourcesTableText() {
  const table = findResourcesTable();
  if (!table) return "";
  return tableToTSV(table, 50);
}

// --- Past Resource Usage (PI only, Berzelius-* projects) ------------------------

function findPastResourceUsageRoot() {
  const h2 = document.querySelector("#pastresourceusage");
  if (!h2) return null;
  return h2.parentElement || document.body;
}

function findPIUsageBlock(root) {
  const headings = Array.from(root.querySelectorAll("h3"));
  const piH3 = headings.find((h) => /^Principal Investigator\b/i.test(normalize(h.innerText)));
  if (!piH3) return null;

  // Collect nodes after PI h3 until next h2/h3
  const nodes = [];
  let el = piH3.nextElementSibling;
  while (el) {
    if (el.tagName && /^H[23]$/i.test(el.tagName) && el !== piH3) break;
    nodes.push(el);
    el = el.nextElementSibling;
  }

  return { piHeading: piH3, nodes };
}

function getPINameFromHeading(piH3) {
  const t = normalize(piH3?.innerText || "");
  return t.replace(/^Principal Investigator\s*/i, "").trim();
}

// Extract projects as <h4><a>Berzelius-YYYY-NNN</a></h4> within the PI section container
function extractPIProjectH4s(piSectionRoot) {
  const h4s = Array.from(piSectionRoot.querySelectorAll("h4"));
  const projects = [];

  for (const h4 of h4s) {
    const a = h4.querySelector("a");
    if (!a) continue;

    const dnr = normalize(a.innerText);
    if (!isBerzeliusDnr(dnr)) continue;

    projects.push({ dnr, url: a.href, h4 });
  }

  const seen = new Set();
  return projects.filter((p) => (seen.has(p.dnr) ? false : (seen.add(p.dnr), true)));
}

// Extract Berzelius projects from a bounded list of DOM nodes (used to scope PI vs each Co-Investigator)
function extractBerzeliusProjectH4sFromNodes(nodes) {
  const projects = [];
  const seen = new Set();

  for (const n of nodes || []) {
    // include the node itself if it's an H4
    const h4s = [];
    if ((n.tagName || "").toUpperCase() === "H4") h4s.push(n);
    h4s.push(...Array.from(n.querySelectorAll?.("h4") || []));

    for (const h4 of h4s) {
      const a = h4.querySelector("a");
      if (!a) continue;

      const dnr = normalize(a.innerText);
      if (!isBerzeliusDnr(dnr)) continue;
      if (seen.has(dnr)) continue;
      seen.add(dnr);

      projects.push({ dnr, url: a.href, h4 });
    }
  }

  return projects;
}


// Find the next TABLE after startEl, but stop if we hit the next project header (H4)
function findNextTableUntilNextH4(startEl) {
  let cur = startEl?.nextElementSibling || null;

  while (cur) {
    const tag = (cur.tagName || "").toUpperCase();
    if (tag === "TABLE") return cur;
    if (tag === "H4") return null; // next project begins
    cur = cur.nextElementSibling;
  }

  return null;
}

// Starting at the project H4, walk forward siblings until next H4;
// when seeing H5 "Compute Resources"/"Storage Resources", take the next TABLE (before next H4).
function extractComputeAndStorageTablesAfterH4(projectH4) {
  let computeTable = null;
  let storageTable = null;

  let cur = projectH4?.nextElementSibling || null;

  while (cur) {
    const tag = (cur.tagName || "").toUpperCase();

    if (tag === "H4") break; // next project starts

    if (tag === "H5") {
      const label = normalize(cur.innerText);

      if (!computeTable && /^Compute Resources$/i.test(label)) {
        const t = findNextTableUntilNextH4(cur);
        if (t) computeTable = tableToTSV(t, 50);
      }

      if (!storageTable && /^Storage Resources$/i.test(label)) {
        const t = findNextTableUntilNextH4(cur);
        if (t) storageTable = tableToTSV(t, 50);
      }

      if (computeTable && storageTable) break;
    }

    cur = cur.nextElementSibling;
  }

  return { computeTable, storageTable };
}

function scrapePastUsagePIText() {
  const root = findPastResourceUsageRoot();
  if (!root) return "";

  const piBlock = findPIUsageBlock(root);
  if (!piBlock) return "";

  const piName = getPINameFromHeading(piBlock.piHeading) || "(unknown)";

  // Scope to the PI section container (so we don't accidentally include other investigators later)
  const projects = extractBerzeliusProjectH4sFromNodes(piBlock.nodes);
  if (projects.length === 0) {
    return `Principal Investigator: ${piName}\n(no Berzelius-* past projects found)`;
  }

  const lines = [];
  lines.push(`Principal Investigator: ${piName}`);

  for (const p of projects) {
    lines.push(`- ${p.dnr}`);

    const { computeTable, storageTable } = extractComputeAndStorageTablesAfterH4(p.h4);

    if (computeTable) {
      lines.push("  Compute Resources:");
      lines.push(...computeTable.split("\n").map((l) => `    ${l}`));
    } else {
      lines.push("  Compute Resources: (not found)");
    }

    if (storageTable) {
      lines.push("  Storage Resources:");
      lines.push(...storageTable.split("\n").map((l) => `    ${l}`));
    } else {
      lines.push("  Storage Resources: (not found)");
    }
  }

  return lines.join("\n");
}

// --- Past Resource Usage (Co-Investigators, Berzelius-* projects) ------------

function findCoIUsageBlocks(root) {
  const headings = Array.from(root.querySelectorAll("h3"));
  const blocks = [];

  for (const h of headings) {
    const t = normalize(h.innerText);
    // Matches: "Co-Investigator X", "Co-Investigator: X", "Co-investigator ..."
    if (/^Co-?Investigator\b/i.test(t)) {
      // Collect nodes after this h3 until next h2/h3
      const nodes = [];
      let el = h.nextElementSibling;
      while (el) {
        if (el.tagName && /^H[23]$/i.test(el.tagName) && el !== h) break;
        nodes.push(el);
        el = el.nextElementSibling;
      }
      blocks.push({ heading: h, nodes });
    }
  }

  return blocks;
}

function getCoINameFromHeading(h3) {
  const t = normalize(h3?.innerText || "");
  return t.replace(/^Co-?Investigator\s*:?\s*/i, "").trim();
}

function scrapePastUsageCoIsText() {
  const root = findPastResourceUsageRoot();
  if (!root) return "";

  const blocks = findCoIUsageBlocks(root);
  if (!blocks.length) return "";

  const lines = [];

  for (const b of blocks) {
    const name = getCoINameFromHeading(b.heading) || "(unknown)";
    // Scope strictly to this Co-Investigator block only
        const projects = extractBerzeliusProjectH4sFromNodes(b.nodes);

    lines.push(`Co-Investigator: ${name}`);

    if (!projects.length) {
      lines.push("(no Berzelius-* past projects found)");
      lines.push(""); // spacer
      continue;
    }

    for (const p of projects) {
      lines.push(`- ${p.dnr}`);

      const { computeTable, storageTable } = extractComputeAndStorageTablesAfterH4(p.h4);

      if (computeTable) {
        lines.push("  Compute Resources:");
        lines.push(...computeTable.split("\n").map((l) => `    ${l}`));
      } else {
        lines.push("  Compute Resources: (not found)");
      }

      if (storageTable) {
        lines.push("  Storage Resources:");
        lines.push(...storageTable.split("\n").map((l) => `    ${l}`));
      } else {
        lines.push("  Storage Resources: (not found)");
      }
    }

    lines.push(""); // spacer between co-investigators
  }

  return lines.join("\n").trim();
}

// --- main scrape ----------------------------------------------------------------

function scrapeProposal() {
  const title = extractTitle();
  const projectTitle = extractShowField("Project Title");
  const pi = extractShowField("PI");

  const abstract = extractLongFromShowValue("Abstract");
  const resourceUsage = extractLongFromShowValue("Resource Usage");
  const resourcesTableText = scrapeResourcesTableText();

  const pastUsagePIText = scrapePastUsagePIText();

  const pastUsageCoIsText = scrapePastUsageCoIsText();

  const url = location.href;

  const promptParts = [
    "### Proposal",
    `Title: ${title}`,
    `URL: ${url}`,
    "",
    `PI: ${pi || "(not found)"}`,
    "",
    "### Project Title",
    projectTitle || "(not found)",
    "",
    "### Abstract / description",
    abstract || "(not found)",
    "",
    "### Resource Usage",
    resourceUsage || "(not found)",
    "",
    "### Resources table",
    resourcesTableText || "(not found)",
    "",
    "### Past Resource Usage (PI)",
    pastUsagePIText || "(not found)",
    "",
    "### Past Resource Usage (Co-Investigators)",
    pastUsageCoIsText || "(not found)",
  ];

  const promptText = promptParts.join("\n");

  return {
    title,
    projectTitle,
    pi,
    abstract,
    resourceUsage,
    resourcesTableText,
    pastUsagePIText,
    pastUsageCoIsText,
    url,
    promptText,
    scrapedAt: new Date().toISOString(),
  };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  try {
    if (msg.type === "SCRAPE_PROPOSAL") {
      const data = scrapeProposal();
      sendResponse({ ok: true, data });
      return true;
    }

    if (msg.type === "TOGGLE_PANEL") {
      togglePanel();
      sendResponse({ ok: true });
      return true;
    }

    sendResponse({ ok: false, error: "Unknown message type." });
    return true;
  } catch (e) {
    sendResponse({ ok: false, error: e.message });
    return true;
  }
});

// Auto-restore the panel after navigation if it was left open
chrome.storage.local.get(["suprPanelOpen"], (res) => {
  if (res && res.suprPanelOpen) {
    // small delay so the page finishes rendering
    setTimeout(() => {
      if (!document.getElementById("supr-helper-panel")) {
        try { togglePanel(); } catch (e) { /* ignore */ }
      }
    }, 200);
  }
});
