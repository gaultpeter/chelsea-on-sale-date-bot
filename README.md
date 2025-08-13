Chelsea On-Sale Date Bot

This is a Cloudflare Worker designed to monitor the official Chelsea FC website for updates to ticket on-sale dates. When a new on-sale date is detected, it sends an automated notification to a specified Discord channel, mentioning you directly to ensure you don't miss any updates.
Features

    Website Monitoring: Automatically checks the Chelsea FC on-sale dates page for new information.

    Discord Integration: Sends a formatted message to a Discord channel via a webhook.

    Personalized Mentions: Pings a specific user in Discord to notify them of an update.

Prerequisites

To set up and run this bot, you will need:

    A Discord server where you have permission to create webhooks.

    A Cloudflare account to run the worker script.

Setup Instructions
Step 1: Set up the Discord Webhook

    In your Discord server, go to Server Settings > Integrations.

    Click Create Webhook.

    Give the webhook a name (e.g., "Chelsea Bot") and select the channel where you want the notifications to be sent.

    Click Copy Webhook URL and save this URL somewhere safe. You will need it in the next step.

Step 2: Set up the Cloudflare Worker

    Log in to your Cloudflare account and navigate to the Workers & Pages dashboard.

    Click Create Application and then Create Worker.

    Give your worker a name (e.g., chelsea-on-sale-bot) and click Deploy.

    Go to the worker's page and click Edit code.

    Paste the following code into the editor, replacing the placeholder values with your own.

// This is the URL of the Chelsea FC on-sale dates page.
const PAGE_URL = "https://www.chelseafc.com/en/all-on-sale-dates-men";

// This is the Discord webhook URL from Step 1.
const WEBHOOK_URL = "YOUR_DISCORD_WEBHOOK_URL_HERE";

// This is your Discord User ID, used to mention you.
// To get your User ID:
// 1. Go to Discord Settings > Advanced.
// 2. Enable Developer Mode.
// 3. Right-click your name and select "Copy User ID".
// 4. Paste the long number here.
const USER_ID = "YOUR_DISCORD_USER_ID_HERE";

// The main function that runs when the worker is triggered.
async function handleRequest() {
  try {
    const pageResponse = await fetch(PAGE_URL);
    if (!pageResponse.ok) {
      throw new Error(`Failed to fetch page: ${pageResponse.statusText}`);
    }

    const pageText = await pageResponse.text();
    
    // Simple scraping logic to find the first 'on-sale' row.
    const regex = /<tr class="ticket-on-sale__row">(.*?)<\/tr>/s;
    const match = pageText.match(regex);
    
    let latestRow = null;
    if (match && match[1]) {
      // Clean up the HTML to be more readable for Discord.
      latestRow = match[1]
        .replace(/<td class="ticket-on-sale__cell">(.*?)<\/td>/g, (match, p1) => `⚽️ ${p1.trim()}\n`)
        .replace(/<span.*?>(.*?)<\/span>/g, '$1')
        .replace(/<br>/g, '')
        .replace(/<a.*?>(.*?)<\/a>/g, '$1')
        .replace(/<p class="ticket-on-sale__title">(.*?)<\/p>/g, '⚽️ Match Date: $1')
        .replace(/<p class="ticket-on-sale__subtitle">(.*?)<\/p>/g, 'Team: $1')
        .replace(/<p class="ticket-on-sale__copy">(.*?)<\/p>/g, 'Kick-off Time: $1')
        .replace(/<div class="ticket-on-sale__tag">(.*?)<\/div>/g, 'On Sale Date: $1');
    }

    // A simple, persistent storage key to track the last sent notification.
    const LAST_SENT_KEY = 'last_sent_date_checksum';
    
    // Get the previous state from Cloudflare's durable object or KV.
    // For this simple example, we will simulate persistent storage.
    const lastSentChecksum = await Deno.env.get(LAST_SENT_KEY);

    const currentChecksum = latestRow ? btoa(latestRow) : null;
    
    if (currentChecksum && currentChecksum !== lastSentChecksum) {
      // New information found, send the Discord notification.
      let discordMessageContent = `⚡ Chelsea on sale dates updated! <@!${USER_ID}> \n\n${latestRow}\n\n${PAGE_URL}`;
      
      const discordResponse = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: discordMessageContent })
      });

      if (!discordResponse.ok) {
        throw new Error(`Failed to send Discord notification: ${discordResponse.statusText}`);
      }

      // Update the stored checksum to prevent repeated notifications.
      await Deno.env.set(LAST_SENT_KEY, currentChecksum);
    }
    
    return new Response("Worker ran successfully.", { status: 200 });
    
  } catch (error) {
    console.error(error);
    return new Response(`Error: ${error.message}`, { status: 500 });
  }
}

// Attach the main function to the Worker's fetch event listener.
self.addEventListener('fetch', event => {
  event.respondWith(handleRequest());
});


Step 3: Configure the Code

Inside the code you just pasted, find these lines and replace the placeholder values:

// This is the Discord webhook URL from Step 1.
const WEBHOOK_URL = "YOUR_DISCORD_WEBHOOK_URL_HERE";

// This is your Discord User ID, used to mention you.
const USER_ID = "YOUR_DISCORD_USER_ID_HERE";

Step 4: Add the Storage Variable

To prevent the worker from sending a notification every time it runs, it needs a way to remember the last state. Cloudflare Workers can use a variety of storage methods, but a simple way is using an Environment Variable.

    In your worker's dashboard, go to the Settings tab.

    Find the Variables section.

    Add a new variable:

        Variable Name: last_sent_date_checksum

        Value: Leave this field empty.

The worker will use this variable to store a "checksum" of the last on-sale date information it found. It will only send a new notification if the checksum changes.
Step 5: Set up a Cron Trigger

For the worker to run automatically, you need to set up a Cron trigger.

    In your worker's dashboard, go to the Triggers tab.

    Click Add Cron Trigger.

    Set the schedule to something like */15 * * * * to have it run every 15 minutes. This is a good balance between responsiveness and not hitting the API too frequently.

How it Works

    The Cloudflare Worker is triggered by the Cron schedule.

    It makes a request to the Chelsea FC on-sale dates page.

    It scrapes the HTML to find the most recent ticket information.

    It compares this new information to a "checksum" stored from the last run.

    If the information has changed (i.e., new dates are posted), it constructs a message and sends it to the Discord webhook.

    The Discord webhook receives the message and sends a notification to the channel, mentioning your user ID.
