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
  const tableHtml = extractTableFromDataProps(html);
  if (!tableHtml) {
    console.log("Could not find table in page HTML");
    return;
  }

  console.log("Extracted Table HTML:\n", tableHtml);

  const newHash = await computeHash(tableHtml);
  const oldHash = await env.MY_KV.get("lastHash");
  console.log("oldHash", oldHash);
  console.log("newHash", newHash);

  if (oldHash && oldHash != newHash) {
    // Extract newest row (<tr>) for Discord
    const newestRow = extractTicketInformation(tableHtml);
    await sendDiscordNotification(discordWebHookUrl, url, newestRow, env);
  }

  await env.MY_KV.put("lastHash", newHash);
}

// Fetch the HTML of the page
async function fetchPage(url) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  return await res.text();
}

// Extract first <table> inside the first GenericContentBlock's data-props
function extractTableFromDataProps(html) {
  const divMatch = html.match(/<div\s+data-component="GenericContentBlock"\s+data-props="([^"]+)">/i);
  if (!divMatch) return null;

  const jsonStr = divMatch[1].replace(/&quot;/g, '"').replace(/\\u0027/g, "'");
  try {
    const data = JSON.parse(jsonStr);
    const bodyHtml = data.body;

    const tableMatch = bodyHtml.match(/<table[\s\S]*?<\/table>/i);
    if (!tableMatch) return null;

    return tableMatch[0];
  } catch (err) {
    console.log("Error parsing JSON:", err);
    return null;
  }
}

function extractTicketInformation(tableHtml) {
  const trMatches = tableHtml.match(/<tr[\s\S]*?<\/tr>/gi);
  
  if (!trMatches || trMatches.length < 2) {
    console.log("No valid table rows found.");
    return null; // Handle cases where there's no data or only a header row
  }
  
  const lastRow = trMatches[trMatches.length - 1];
  console.log(lastRow);

  const regex = /<p>(.*?)<\/p><\/td><td><p>(.*?)<\/p><\/td><td><p>(.*?)<\/p><\/td><td><p>.*?<\/p><\/td><td><p>(.*?)<\/p>/;
  const match = lastRow.match(regex);

  if (match) {
    const matchDate = match[1].trim();
    const teamName = match[2].trim();
    const kickOffTime = match[3].trim();
    const onSaleDate = match[4].trim();

    const message = `⚽️ Match Date: ${matchDate}\n\n🆚 Team: ${teamName}\n\n⏰ Kick-off Time: ${kickOffTime}\n\n🎟️ On Sale Date: ${onSaleDate}`;

    return message;
  } else {
    console.log("Could not extract ticket information from the last row.");
    return null; // Return null if the regex doesn't match
  }
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
async function sendDiscordNotification(webhookUrl, pageUrl, newestRow, env) {
  if (!webhookUrl) throw new Error("Discord webhook URL not set!");


  console.log(newestRow);

  const userId = env.DISCORD_USER_ID;

  const content = newestRow
  ? `⚡ Chelsea on sale dates updated!! <@${userId}> \n\n${newestRow}\n\n ${pageUrl}`
  : ` ⚡ Chelsea on sale dates updated! <@${userId}> \n\n${pageUrl}`;


  console.log("Sending discord notification!")
  
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content })
  });
}
