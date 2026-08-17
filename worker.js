const TARGET_URL = "https://www.chelseafc.com/en/all-on-sale-dates-men";
const USER_AGENT = "Mozilla/5.0";
const DISCORD_MAX_LENGTH = 2000;

export default {
  async scheduled(event, env, ctx) {
    await runMonitor(env);
  },
  async fetch(request, env) {
    await runMonitor(env);
    return new Response("Chelsea page monitor run manually!");
  }
};

/**
 * Main monitor: scrape the men's on-sale dates page, diff each home table
 * against KV, and notify Discord about changed rows.
 */
async function runMonitor(env) {
  const discordWebhookUrl = env.DISCORD_WEBHOOK_URL;
  console.log("runMonitor started", { url: TARGET_URL, hasWebhook: Boolean(discordWebhookUrl) });

  const html = await fetchPage(TARGET_URL);
  const tables = extractAllTables(html);
  if (!tables) {
    console.log("Could not find tables in page HTML");
    return;
  }

  const homeTables = tables.filter(table => !table.header.toLowerCase().includes("away"));
  console.log(`Found ${tables.length} total tables:`, tables.map(t => t.header));
  console.log(`Monitoring ${homeTables.length} home game tables:`, homeTables.map(t => t.header));

  for (const { header, table } of homeTables) {
    const tableHash = await computeHash(table);
    const hashKey = `lastHash_${header.replace(/\s+/g, "_")}`;
    const oldHash = await env.MY_KV.get(hashKey);

    if (oldHash === tableHash) {
      console.log(`No change detected for '${header}'.`);
      continue;
    }

    const changedRows = await extractChangedRows(table, header, env);
    if (changedRows.length === 0) {
      console.log(`No changed rows extracted for '${header}'.`);
    } else {
      console.log(`Found ${changedRows.length} changed rows for '${header}'. Sending notifications...`);
      for (const row of changedRows) {
        try {
          await sendDiscordNotification(discordWebhookUrl, row, env.DISCORD_USER_ID);
        } catch (err) {
          console.error("Error sending Discord notification:", err?.message);
        }
      }
    }

    await env.MY_KV.put(hashKey, tableHash);
  }
}

async function fetchPage(url) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return await res.text();
}

function cleanHtmlText(text) {
  if (!text) return "";
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\\u0027/g, "'")
    .replace(/&ndash;/gi, "-")
    .replace(/&mdash;/gi, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract all tables from the page, paired with their section heading
 * (competition + fixture title). Falls back to the JSON payload embedded in
 * the GenericContentBlock data-props attribute if no rendered tables exist.
 */
function extractAllTables(htmlContent) {
  const tables = [];

  const parseSectionHeaders = htmlBeforeTable => {
    const h2Matches = [...htmlBeforeTable.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)];
    const lastH2 = h2Matches.length > 0 ? h2Matches[h2Matches.length - 1] : null;

    let title = lastH2 ? cleanHtmlText(lastH2[1]) : "";
    let category = "";
    if (lastH2) {
      const subPrev = htmlBeforeTable.substring(Math.max(0, lastH2.index - 500), lastH2.index);
      const h5Matches = [...subPrev.matchAll(/<h5[^>]*>([\s\S]*?)<\/h5>/gi)];
      if (h5Matches.length > 0) category = cleanHtmlText(h5Matches[h5Matches.length - 1][1]);
    }

    if (title.toLowerCase().includes("on-sale dates")) title = "";
    return { category, title, header: category && title ? `${category} - ${title}` : (title || category || "Ticket On-Sale Dates") };
  };

  const addTables = html => {
    for (const tableMatch of html.matchAll(/<table[\s\S]*?<\/table>/gi)) {
      const prevHtml = html.substring(Math.max(0, tableMatch.index - 2000), tableMatch.index);
      const { category, title, header } = parseSectionHeaders(prevHtml);
      tables.push({ category, title, header, table: tableMatch[0] });
    }
  };

  addTables(htmlContent);

  if (tables.length === 0) {
    const divMatch = htmlContent.match(/<div\s+data-component="GenericContentBlock"\s+data-props="([^"]+)">/i);
    if (divMatch) {
      try {
        const data = JSON.parse(divMatch[1].replace(/&quot;/g, '"').replace(/\\u0027/g, "'"));
        addTables(data.body || "");
      } catch (err) {
        console.log("Error parsing JSON data-props:", err);
      }
    }
  }

  return tables.length > 0 ? tables : null;
}

/**
 * Diff each table row against its stored KV state and return formatted
 * messages for rows that changed or are new.
 */
async function extractChangedRows(tableHtml, tableHeader, env) {
  const { headers, rows } = parseTableRows(tableHtml);
  if (!headers || !rows) return [];

  const prepared = rows.map((data, i) => {
    const opponentName = getOpponentName(headers, data, tableHeader);
    const storageKey = `row_${buildRowKey(tableHeader, headers, data, opponentName, i)}`;
    return { data, opponentName, storageKey, currentObj: buildRowObject(headers, data, opponentName) };
  });

  const previous = await Promise.all(prepared.map(p => env.MY_KV.get(p.storageKey)));

  const changedRows = [];
  for (let i = 0; i < prepared.length; i++) {
    const { storageKey, currentObj } = prepared[i];
    const currentJson = JSON.stringify(currentObj);
    if (previous[i] === currentJson) {
      console.log(`Row ${i} unchanged for key '${storageKey}'.`);
      continue;
    }
    const formattedMessage = `**Chelsea Ticket Update - ${tableHeader}:**\n\n${formatFullRow(currentObj)}`;
    changedRows.push(formattedMessage);
    console.log(`Row ${i} changed for key '${storageKey}':`, formattedMessage);
    await env.MY_KV.put(storageKey, currentJson);
  }
  return changedRows;
}

function parseTableRows(tableHtml) {
  const trMatches = tableHtml.match(/<tr[\s\S]*?<\/tr>/gi);
  if (!trMatches || trMatches.length < 2) {
    console.log("No valid table rows found.");
    return { headers: null, rows: null };
  }

  const headerRow = trMatches[0];
  const thMatches = [...headerRow.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)];
  const cellSources = thMatches.length > 0 ? thMatches.map(m => m[1]) : [...headerRow.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1]);
  const headers = cellSources.map((text, idx) => {
    const clean = cleanHtmlText(text);
    return clean || (idx === 0 ? "Member Type" : `Column ${idx + 1}`);
  });

  const rows = [];
  for (let i = 1; i < trMatches.length; i++) {
    const data = [...trMatches[i].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => cleanHtmlText(m[1]));
    if (!data.some(Boolean)) continue;
    if (/access/i.test(data[0] || "")) continue; // accessibility rows are not relevant
    rows.push(data);
  }

  return { headers, rows };
}

function getOpponentName(headers, data, tableHeader) {
  const opponentHeaderIndex = headers.findIndex(h => /opponent|opposition|fixture|match/i.test(h));
  if (opponentHeaderIndex !== -1 && data[opponentHeaderIndex]) {
    return data[opponentHeaderIndex];
  }
  if (tableHeader) {
    const vMatch = tableHeader.match(/Chelsea\s+vs?\s+([^-\n]+)/i) || tableHeader.match(/([^-\n]+)\s+vs?\s+Chelsea/i);
    if (vMatch) return vMatch[1].trim();
  }
  const candidate = [data[0], data[1]].filter(Boolean).join(" ");
  const vMatch = candidate.match(/v\s+(.*)/i) || candidate.match(/vs\.?\s+(.*)/i);
  return vMatch ? vMatch[1].trim() : candidate.trim();
}

function buildRowKey(tableHeader, headers, data, opponentName, index) {
  const dateIndex = headers.findIndex(h => /date/i.test(h));
  const competitionIndex = headers.findIndex(h => /competition|tournament/i.test(h));
  const date = dateIndex !== -1 ? normalizeWhitespace(data[dateIndex] || "") : "";
  const competition = competitionIndex !== -1 ? normalizeWhitespace(data[competitionIndex] || "") : "";
  const opponent = normalizeWhitespace(opponentName || "");
  const parts = [tableHeader, data[0] || "", date, opponent, competition, `row_${index}`]
    .map(p => p.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""))
    .filter(Boolean);
  return parts.join("_") || `${tableHeader.replace(/\s+/g, "_")}_row_${index}`;
}

function buildRowObject(headers, data, opponentName) {
  const obj = {};
  for (let j = 0; j < Math.min(headers.length, data.length); j++) {
    if (/access/i.test(headers[j])) continue;
    const key = normalizeHeader(headers[j]);
    if (key) obj[key] = normalizeWhitespace(data[j]);
  }
  if (opponentName && !obj.opponent) obj.opponent = normalizeWhitespace(opponentName);
  return obj;
}

function normalizeHeader(text) {
  return (text || "")
    .toLowerCase()
    .replace(/&[^;]+;/g, " ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function formatFieldTitle(key) {
  return key
    .replace(/_/g, " ")
    .split(" ")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function normalizeWhitespace(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function formatFullRow(obj) {
  return Object.entries(obj)
    .filter(([k, v]) => Boolean(v) && !/access/i.test(k))
    .map(([k, v]) => `**${formatFieldTitle(k)}:** ${v}`)
    .join("\n");
}

async function computeHash(text) {
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function sendDiscordNotification(webhookUrl, formattedMessage, userId) {
  if (!webhookUrl) throw new Error("DISCORD_WEBHOOK_URL is not configured.");

  const mention = userId ? `<@${userId}>` : "";
  const header = "⚡ Chelsea ticket information updated!";
  let content = formattedMessage
    ? `${header} ${mention}\n\n${formattedMessage}\n\nView full details: ${TARGET_URL}`
    : `${header} ${mention}\n\nView full details: ${TARGET_URL}`;

  if (content.length > DISCORD_MAX_LENGTH) {
    content = content.substring(0, DISCORD_MAX_LENGTH - 20) + "\n\n...(truncated)";
  }

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content })
      });
      const body = await res.text();

      if (res.ok) {
        console.log("Discord notification sent successfully.");
        return;
      }

      if (res.status === 429 && attempt === 1) {
        let retryAfter = 2000;
        try {
          const json = JSON.parse(body);
          if (json.retry_after) retryAfter = Math.ceil(json.retry_after * 1000);
        } catch (_) {}
        console.warn(`Rate limited by Discord. Retrying in ${retryAfter}ms...`);
        await new Promise(resolve => setTimeout(resolve, retryAfter));
        continue;
      }

      throw new Error(`Discord webhook failed. Status: ${res.status}. Response: ${body}`);
    } catch (err) {
      console.error("Failed to send Discord notification:", err?.message);
      throw err;
    }
  }
}