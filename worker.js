var worker_default = {
  async scheduled(event, env, ctx) {
    await runMonitor(env);
  },
  async fetch(request, env) {
    await runMonitor(env);
    return new Response("Chelsea page monitor run manually!");
  }
};
async function runMonitor(env) {
  const url = "https://www.chelseafc.com/en/all-on-sale-dates-men";
  const discordWebHookUrl = env.DISCORD_WEBHOOK_URL;
  console.log("runMonitor started", { url, hasWebhook: Boolean(discordWebHookUrl) });
  const html = await fetchPage(url);
  const tables = extractAllTablesFromDataProps(html);
  if (!tables) {
    console.log("Could not find tables in page HTML");
    return;
  }
  const homeTables = tables.filter((table) => !table.header.toLowerCase().includes("away"));
  console.log(`Found ${tables.length} total tables:`, tables.map((t) => t.header));
  console.log(`Monitoring ${homeTables.length} home game tables:`, homeTables.map((t) => t.header));
  if (homeTables.length === 0) {
    console.log("No home tables found. Exiting without notifications.");
  }
  for (const tableData of homeTables) {
    const { header, table } = tableData;
    const tableHash = await computeHash(table);
    const oldHashKey = `lastHash_${header.replace(/\s+/g, "_")}`;
    const oldHash = await env.MY_KV.get(oldHashKey);
    console.log(`Table: ${header}`);
    console.log("oldHash", oldHash);
    console.log("newHash", tableHash);
    if (!oldHash) {
      console.log(`No previous hash for '${header}'. Storing current hash and skipping notifications this run.`);
    } else if (oldHash === tableHash) {
      console.log(`No change detected for '${header}'.`);
    } else if (oldHash !== tableHash) {
      console.log(`Change detected for '${header}'. Extracting changed rows...`);
      const changedRows = await extractChangedRows(table, header, env);
      if (!changedRows || changedRows.length === 0) {
        console.log(`Table hash changed but no changed rows extracted for '${header}'.`);
      } else {
        console.log(`Found ${changedRows.length} changed rows for '${header}'. Sending notifications...`);
        for (const row of changedRows) {
          try {
            await sendDiscordNotification(discordWebHookUrl, url, row, env);
          } catch (err) {
            console.log("Error sending Discord notification:", err);
          }
        }
      }
    }
    await env.MY_KV.put(oldHashKey, tableHash);
  }
}
async function fetchPage(url) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  return await res.text();
}
function extractAllTablesFromDataProps(html) {
  const divMatch = html.match(/<div\s+data-component="GenericContentBlock"\s+data-props="([^"]+)">/i);
  if (!divMatch) return null;
  const jsonStr = divMatch[1].replace(/&quot;/g, '"').replace(/\\u0027/g, "'");
  try {
    const data = JSON.parse(jsonStr);
    const bodyHtml = data.body;
    const tables = [];
    const tableMatches = bodyHtml.match(/<h2[^>]*>(.*?)<\/h2>[\s\S]*?<table[\s\S]*?<\/table>/gi);
    if (tableMatches) {
      tableMatches.forEach((tableSection) => {
        const headerMatch = tableSection.match(/<h2[^>]*>(.*?)<\/h2>/i);
        const tableMatch = tableSection.match(/<table[\s\S]*?<\/table>/i);
        if (headerMatch && tableMatch) {
          const header = headerMatch[1].trim();
          const table = tableMatch[0];
          tables.push({ header, table });
        }
      });
    }
    return tables.length > 0 ? tables : null;
  } catch (err) {
    console.log("Error parsing JSON:", err);
    return null;
  }
}
async function extractChangedRows(tableHtml, tableHeader, env) {
  const { headers, rows } = parseTableRows(tableHtml);
  if (!headers || !rows) {
    return [];
  }
  console.log("Table headers detected:", headers);
  const changedRows = [];
  for (let i = 0; i < rows.length; i++) {
    const data = rows[i];
    const opponentName = getOpponentName(headers, data);
    const rowKey = buildRowKey(tableHeader, headers, data, opponentName, i);
    const storageKey = `row_${rowKey}`;
    const previousJson = await env.MY_KV.get(storageKey);
    const currentObj = buildRowObject(headers, data, opponentName);
    const currentJson = JSON.stringify(currentObj);
    if (previousJson !== currentJson) {
      const diffText = previousJson ? formatDiff(JSON.parse(previousJson), currentObj) : formatFullRow(currentObj);
      const formattedMessage = `**Chelsea Ticket Update - ${tableHeader}:**

${diffText}`;
      changedRows.push(formattedMessage);
      console.log(`Row ${i} changed for key '${storageKey}':`, formattedMessage);
      await env.MY_KV.put(storageKey, currentJson);
    } else {
      console.log(`Row ${i} unchanged for key '${storageKey}'.`);
    }
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
  const headerMatches = headerRow.match(/<th[^>]*><p[^>]*>(.*?)<\/p><\/th>/gi);
  if (!headerMatches) {
    console.log("No headers found in table.");
    return { headers: null, rows: null };
  }
  const headers = headerMatches.map((header) => {
    const match = header.match(/<p[^>]*>(.*?)<\/p>/);
    return match ? match[1].trim() : "";
  });
  const rows = [];
  for (let i = 1; i < trMatches.length; i++) {
    const row = trMatches[i];
    const dataMatches = row.match(/<td[^>]*><p[^>]*>(.*?)<\/p><\/td>/gi);
    const data = dataMatches
      ? dataMatches.map((cell) => {
          const match = cell.match(/<p[^>]*>(.*?)<\/p>/);
          return match ? match[1].trim() : "";
        })
      : [];
    rows.push(data);
  }
  return { headers, rows };
}

function getOpponentName(headers, data) {
  const opponentHeaderIndex = headers.findIndex((h) => /opponent|opposition|fixture|match/i.test(h));
  if (opponentHeaderIndex !== -1 && data[opponentHeaderIndex]) {
    return data[opponentHeaderIndex];
  }
  const candidate = [data[0], data[1]].filter(Boolean).join(" ");
  const vMatch = candidate.match(/v\s+(.*)/i) || candidate.match(/vs\.?\s+(.*)/i);
  return vMatch ? vMatch[1].trim() : candidate.trim();
}

function buildRowKey(tableHeader, headers, data, opponentName, index) {
  const dateIndex = headers.findIndex((h) => /date/i.test(h));
  const competitionIndex = headers.findIndex((h) => /competition|tournament/i.test(h));
  const date = dateIndex !== -1 ? normalizeWhitespace(data[dateIndex] || "") : "";
  const competition = competitionIndex !== -1 ? normalizeWhitespace(data[competitionIndex] || "") : "";
  const opponent = normalizeWhitespace(opponentName || "");
  const parts = [tableHeader, date, opponent, competition]
    .map((p) => p.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""))
    .filter(Boolean);
  const base = parts.join("_");
  return base || `${tableHeader.replace(/\s+/g, "_")}_row_${index}`;
}

function buildRowObject(headers, data, opponentName) {
  const obj = {};
  for (let j = 0; j < Math.min(headers.length, data.length); j++) {
    const key = normalizeHeader(headers[j]);
    obj[key] = normalizeWhitespace(data[j]);
  }
  if (opponentName) {
    obj["opponent"] = normalizeWhitespace(opponentName);
  }
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

function formatDiff(prevObj, currObj) {
  const keys = Array.from(new Set([...Object.keys(prevObj), ...Object.keys(currObj)]));
  const lines = [];
  for (const key of keys) {
    const before = prevObj[key] || "";
    const after = currObj[key] || "";
    if (before !== after) {
      const title = formatFieldTitle(key);
      lines.push(`**${title}:** ${before ? `${before} → ` : ""}${after}`);
    }
  }
  return lines.length > 0 ? lines.join("\n") : formatFullRow(currObj);
}

function formatFullRow(obj) {
  return Object.entries(obj)
    .filter(([_, v]) => Boolean(v))
    .map(([k, v]) => `**${formatFieldTitle(k)}:** ${v}`)
    .join("\n");
}
async function computeHash(text) {
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function sendDiscordNotification(webhookUrl, pageUrl, formattedMessage, env) {
  if (!webhookUrl) throw new Error("Discord webhook URL not set!");
  console.log("Formatted message:", formattedMessage);
  const userId = env.DISCORD_USER_ID;
  const content = formattedMessage ? `\u26A1 Chelsea ticket information updated! <@${userId}>

${formattedMessage}

View full details: ${pageUrl}` : `\u26A1 Chelsea ticket information updated! <@${userId}>

View full details: ${pageUrl}`;
  console.log("Sending discord notification!", {
    contentLength: content.length,
    hasUserId: Boolean(userId)
  });
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content })
    });
    const responseText = await res.text();
    console.log("Discord webhook response:", { status: res.status, ok: res.ok, body: responseText?.slice(0, 500) });
    if (!res.ok) {
      throw new Error(`Discord webhook responded with status ${res.status}`);
    }
  } catch (err) {
    console.log("Failed to send Discord notification:", err);
    throw err;
  }
}
export {
  worker_default as default
};