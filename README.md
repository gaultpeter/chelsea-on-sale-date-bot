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

Step 3: Configure the Code

Inside the code, find the lines for WEBHOOK_URL and USER_ID and replace the placeholder values.
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
