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

  const newHash = await computeHash(html);
  const oldHash = await env.MY_KV.get("lastHash");

  console.log("oldHash", oldHash);
  console.log("newHash", newHash);

  if (oldHash && oldHash !== newHash) {
    await sendDiscordNotification(discordWebHookUrl, url, env);
  }

  await env.MY_KV.put("lastHash", newHash);
}

// Fetch the HTML of the page
async function fetchPage(url) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  return await res.text();
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
async function sendDiscordNotification(webhookUrl, pageUrl, env) {
  if (!webhookUrl) throw new Error("Discord webhook URL not set!");

  const userId = env.DISCORD_USER_ID;

  const content = `⚡ Chelsea on sale dates has changed! <@${userId}> \n\n${pageUrl}`;

  console.log("Sending Discord notification!");

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content })
  });
}
