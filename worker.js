export default {
  async scheduled(event, env, ctx) {
    await runMonitor(env);
  },

  async fetch(request, env) {
    await runMonitor(env);
    return new Response("Chelsea page monitor run manually!");
  }
};

// Main monitor function
async function runMonitor(env) {
  const url = "https://www.chelseafc.com/en/all-on-sale-dates-men";
  const discordWebHookUrl = env.DISCORD_WEBHOOK_URL;

  const html = await fetchPage(url);
  const tables = extractAllTablesFromDataProps(html);
  if (!tables) {
    console.log("Could not find tables in page HTML");
    return;
  }

  // Filter to only include home games (exclude away games)
  const homeTables = tables.filter(table => !table.header.toLowerCase().includes('away'));
  
  console.log(`Found ${tables.length} total tables:`, tables.map(t => t.header));
  console.log(`Monitoring ${homeTables.length} home game tables:`, homeTables.map(t => t.header));

  // Check each home game table for changes
  for (const tableData of homeTables) {
    const { header, table } = tableData;
    const tableHash = await computeHash(table);
    const oldHashKey = `lastHash_${header.replace(/\s+/g, '_')}`;
    const oldHash = await env.MY_KV.get(oldHashKey);
    
    console.log(`Table: ${header}`);
    console.log("oldHash", oldHash);
    console.log("newHash", tableHash);

    if (oldHash && oldHash == tableHash) {
      // Extract newest row for this table
      const newestRow = extractTicketInformation(table, header);
      if (newestRow) {
        await sendDiscordNotification(discordWebHookUrl, url, newestRow, env);
      }
    }

    // Store the new hash for this table
    await env.MY_KV.put(oldHashKey, tableHash);
  }
}

// Fetch the HTML of the page
async function fetchPage(url) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  return await res.text();
}

// Extract all <table> elements inside the first GenericContentBlock's data-props
function extractAllTablesFromDataProps(html) {
  const divMatch = html.match(/<div\s+data-component="GenericContentBlock"\s+data-props="([^"]+)">/i);
  if (!divMatch) return null;

  const jsonStr = divMatch[1].replace(/&quot;/g, '"').replace(/\\u0027/g, "'");
  try {
    const data = JSON.parse(jsonStr);
    const bodyHtml = data.body;

    // Extract all tables with their preceding headers
    const tables = [];
    const tableMatches = bodyHtml.match(/<h2[^>]*>(.*?)<\/h2>[\s\S]*?<table[\s\S]*?<\/table>/gi);
    
    if (tableMatches) {
      tableMatches.forEach(tableSection => {
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

function extractTicketInformation(tableHtml, tableHeader) {
  const trMatches = tableHtml.match(/<tr[\s\S]*?<\/tr>/gi);
  
  if (!trMatches || trMatches.length < 2) {
    console.log("No valid table rows found.");
    return null; // Handle cases where there's no data or only a header row
  }
  
  // Extract headers from the first row
  const headerRow = trMatches[0];
  const headerMatches = headerRow.match(/<th[^>]*><p[^>]*>(.*?)<\/p><\/th>/gi);
  
  if (!headerMatches) {
    console.log("No headers found in table.");
    return null;
  }
  
  // Extract headers text
  const headers = headerMatches.map(header => {
    const match = header.match(/<p[^>]*>(.*?)<\/p>/);
    return match ? match[1].trim() : '';
  });
  
  // Extract data from the last row
  const lastRow = trMatches[trMatches.length - 1];
  const dataMatches = lastRow.match(/<td[^>]*><p[^>]*>(.*?)<\/p><\/td>/gi);
  
  if (!dataMatches) {
    console.log("No data found in last row.");
    return null;
  }
  
  // Extract data text
  const data = dataMatches.map(cell => {
    const match = cell.match(/<p[^>]*>(.*?)<\/p>/);
    return match ? match[1].trim() : '';
  });
  
  // Create human-readable formatted message with table type
  let formattedMessage = `**Latest Chelsea Ticket Update - ${tableHeader}:**\n\n`;
  
  for (let i = 0; i < Math.min(headers.length, data.length); i++) {
    if (headers[i] && data[i]) {
      formattedMessage += `**${headers[i]}:** ${data[i]}\n`;
    }
  }
  
  console.log("Formatted message:", formattedMessage);
  return formattedMessage;
}

// Compute SHA-256 hash of a string
async function computeHash(text) {
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

// Send a notification to Discord
async function sendDiscordNotification(webhookUrl, pageUrl, formattedMessage, env) {
  if (!webhookUrl) throw new Error("Discord webhook URL not set!");

  console.log("Formatted message:", formattedMessage);

  const userId = env.DISCORD_USER_ID;

  // Create a human-readable message for any Chelsea game update
  const content = formattedMessage
  ? `⚡ Chelsea ticket information updated! <@${userId}>\n\n${formattedMessage}\n\nView full details: ${pageUrl}`
  : `⚡ Chelsea ticket information updated! <@${userId}>\n\nView full details: ${pageUrl}`;

  console.log("Sending discord notification!")
  
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content })
  });
}
