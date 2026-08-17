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
  const tables = extractAllTables(html);
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
      console.log(`No previous hash for '${header}'. Treating as first run and sending notifications...`);

      const changedRows = await extractChangedRows(table, header, env);

      if (!changedRows || changedRows.length === 0) {
        console.log(`No rows found for '${header}'.`);
      } else {
        console.log(`Found ${changedRows.length} rows for '${header}'. Sending notifications...`);

        for (const row of changedRows) {
          try {
            await sendDiscordNotification(discordWebHookUrl, url, row, env);
          } catch (err) {
            console.error("Error sending Discord notification:", {
              message: err?.message,
              stack: err?.stack
            });
          }
        }
      }
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
            console.error("Error sending Discord notification:", {
              message: err?.message,
              stack: err?.stack
            });
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

function cleanHtmlText(text) {
  if (!text) return '';
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\\u0027/g, "'")
    .replace(/&ndash;/gi, '-')
    .replace(/&mdash;/gi, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractAllTables(htmlContent) {
  const tables = [];

  const parseSectionHeaders = (htmlBeforeTable) => {
    const h2Matches = [...htmlBeforeTable.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)];
    const lastH2Match = h2Matches.length > 0 ? h2Matches[h2Matches.length - 1] : null;

    let title = '';
    if (lastH2Match) {
      title = cleanHtmlText(lastH2Match[1]);
    }

    let category = '';
    if (lastH2Match) {
      const h2IndexInPrev = lastH2Match.index;
      const subPrevHtml = htmlBeforeTable.substring(Math.max(0, h2IndexInPrev - 500), h2IndexInPrev);
      const h5Matches = [...subPrevHtml.matchAll(/<h5[^>]*>([\s\S]*?)<\/h5>/gi)];
      if (h5Matches.length > 0) {
        category = cleanHtmlText(h5Matches[h5Matches.length - 1][1]);
      }
    }

    if (title.toLowerCase().includes("on-sale dates")) {
      title = '';
    }

    const header = category && title ? `${category} - ${title}` : (title || category || 'Ticket On-Sale Dates');
    return { category, title, header };
  };

  // Strategy 1: Direct HTML parsing for rendered table elements with h2 and optional h5 headers
  const tableMatches = [...htmlContent.matchAll(/<table[\s\S]*?<\/table>/gi)];

  if (tableMatches.length > 0) {
    tableMatches.forEach((tableMatch) => {
      const tableIdx = tableMatch.index;
      const prevHtml = htmlContent.substring(Math.max(0, tableIdx - 2000), tableIdx);
      const { category, title, header } = parseSectionHeaders(prevHtml);
      tables.push({ category, title, header, table: tableMatch[0] });
    });
  }

  // Strategy 2: Fallback to JSON payload inside data-props attribute if no direct tables found
  if (tables.length === 0) {
    const divMatch = htmlContent.match(/<div\s+data-component="GenericContentBlock"\s+data-props="([^"]+)">/i);
    if (divMatch) {
      const jsonStr = divMatch[1].replace(/&quot;/g, '"').replace(/\\u0027/g, "'");
      try {
        const data = JSON.parse(jsonStr);
        const bodyHtml = data.body || '';
        const subTableMatches = [...bodyHtml.matchAll(/<table[\s\S]*?<\/table>/gi)];
        subTableMatches.forEach((tableMatch) => {
          const tableIdx = tableMatch.index;
          const prevHtml = bodyHtml.substring(Math.max(0, tableIdx - 2000), tableIdx);
          const { category, title, header } = parseSectionHeaders(prevHtml);
          tables.push({ category, title, header, table: tableMatch[0] });
        });
      } catch (err) {
        console.log("Error parsing JSON data-props:", err);
      }
    }
  }

  return tables.length > 0 ? tables : null;
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
    const opponentName = getOpponentName(headers, data, tableHeader);
    const rowKey = buildRowKey(tableHeader, headers, data, opponentName, i);
    const storageKey = `row_${rowKey}`;
    const previousJson = await env.MY_KV.get(storageKey);
    const currentObj = buildRowObject(headers, data, opponentName);
    const currentJson = JSON.stringify(currentObj);

    if (previousJson !== currentJson) {
      const formattedMessage = `**Chelsea Ticket Update - ${tableHeader}:**\n\n${formatFullRow(currentObj)}`;
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
  const thMatches = [...headerRow.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)];

  let headers = [];
  if (thMatches.length > 0) {
    headers = thMatches.map((m, idx) => {
      const text = cleanHtmlText(m[1]);
      if (!text && idx === 0) {
        return 'Member Type';
      }
      return text || `Column ${idx + 1}`;
    });
  } else {
    const tdMatches = [...headerRow.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
    headers = tdMatches.map((m, idx) => {
      const text = cleanHtmlText(m[1]);
      if (!text && idx === 0) {
        return 'Member Type';
      }
      return text || `Column ${idx + 1}`;
    });
  }

  const rows = [];
  for (let i = 1; i < trMatches.length; i++) {
    const rowHtml = trMatches[i];
    const cellMatches = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
    if (cellMatches.length > 0) {
      const data = cellMatches.map((m) => cleanHtmlText(m[1]));
      if (data.some(Boolean)) {
        // Filter out accessibility ticket rows as user is True Blue normal release member
        const firstCell = data[0] || '';
        if (/access/i.test(firstCell)) {
          console.log(`Skipping accessibility row: "${firstCell}"`);
          continue;
        }
        rows.push(data);
      }
    }
  }
  return { headers, rows };
}

function getOpponentName(headers, data, tableHeader) {
  const opponentHeaderIndex = headers.findIndex((h) => /opponent|opposition|fixture|match/i.test(h));
  if (opponentHeaderIndex !== -1 && data[opponentHeaderIndex]) {
    return data[opponentHeaderIndex];
  }
  if (tableHeader) {
    const vMatch = tableHeader.match(/Chelsea\s+vs?\s+([^-\n]+)/i) || tableHeader.match(/([^-\n]+)\s+vs?\s+Chelsea/i);
    if (vMatch) {
      return vMatch[1].trim();
    }
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
  const rowType = data[0] || "";
  const parts = [tableHeader, rowType, date, opponent, competition, `row_${index}`]
    .map((p) => p.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""))
    .filter(Boolean);
  const base = parts.join("_");
  return base || `${tableHeader.replace(/\s+/g, "_")}_row_${index}`;
}

function buildRowObject(headers, data, opponentName) {
  const obj = {};
  for (let j = 0; j < Math.min(headers.length, data.length); j++) {
    if (/access/i.test(headers[j])) continue;
    const key = normalizeHeader(headers[j]);
    if (key) {
      obj[key] = normalizeWhitespace(data[j]);
    }
  }
  if (opponentName && !obj["opponent"]) {
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
  const keys = Array.from(new Set([...Object.keys(prevObj), ...Object.keys(currObj)]))
    .filter(key => !/access/i.test(key));
  const lines = [];
  for (const key of keys) {
    const before = prevObj[key] || "";
    const after = currObj[key] || "";
    if (before !== after) {
      const title = formatFieldTitle(key);
      if (before && after) {
        lines.push(`**${title}:** ${before} → ${after}`);
      } else if (after) {
        lines.push(`**${title}:** ${after}`);
      }
    }
  }
  return lines.length > 0 ? lines.join("\n") : formatFullRow(currObj);
}

function formatFullRow(obj) {
  return Object.entries(obj)
    .filter(([k, v]) => Boolean(v) && !/access/i.test(k))
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
  if (!webhookUrl) {
    throw new Error("DISCORD_WEBHOOK_URL is not configured.");
  }

  const userId = env.DISCORD_USER_ID;

  let content = formattedMessage
    ? `⚡ Chelsea ticket information updated! ${userId ? `<@${userId}>` : ""}

${formattedMessage}

View full details: ${pageUrl}`
    : `⚡ Chelsea ticket information updated! ${userId ? `<@${userId}>` : ""}

View full details: ${pageUrl}`;

  // Discord message limit
  const MAX_LENGTH = 2000;

  if (content.length > MAX_LENGTH) {
    console.warn(
      `Discord message too long (${content.length} chars). Truncating to ${MAX_LENGTH}.`
    );

    content =
      content.substring(0, MAX_LENGTH - 20) +
      "\n\n...(truncated)";
  }

  console.log("Sending Discord notification...", {
    contentLength: content.length,
    hasWebhook: Boolean(webhookUrl),
    hasUserId: Boolean(userId)
  });

  const payload = {
    content
  };

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const body = await res.text();

      console.log("Discord response:", {
        status: res.status,
        ok: res.ok,
        body
      });

      if (res.ok) {
        console.log("Discord notification sent successfully.");
        return;
      }

      // Retry once if Discord rate limits
      if (res.status === 429 && attempt === 1) {
        let retryAfter = 2000;

        try {
          const json = JSON.parse(body);
          if (json.retry_after) {
            retryAfter = Math.ceil(json.retry_after);
          }
        } catch (_) {}

        console.warn(`Rate limited by Discord. Retrying in ${retryAfter}ms...`);

        await new Promise(resolve => setTimeout(resolve, retryAfter));
        continue;
      }

      throw new Error(
        `Discord webhook failed.\n` +
        `Status: ${res.status}\n` +
        `Response: ${body}`
      );

    } catch (err) {
      console.error("Failed to send Discord notification:", {
        message: err?.message,
        stack: err?.stack
      });

      throw err;
    }
  }
}

export {
  worker_default as default
};