# Chelsea On-Sale Date Bot

A Cloudflare Worker bot that monitors Chelsea FC men's home game ticket release dates and ballot application windows on the official Chelsea website, diffs table state with Cloudflare KV, and sends instant notifications to Discord via Webhooks.

---

## 📌 Features

- **Ballot & On-Sale Monitoring**: Tracks ticket application windows (Ticket Application Open/Close, Access Window Open/Close) as well as traditional sale dates (Season Ticket Holders, Members, General Sale).
- **Home Match Scraper**: Filters for Men's Home matches to ensure relevant alerts.
- **Robust Dual-Strategy Parsing**: Parses directly from live HTML DOM structure with fallback to JSON component data.
- **Granular Change Detection**: Computes SHA-256 table hashes and tracks individual row state in Cloudflare KV to eliminate duplicate notifications.
- **Discord Integration**: Pings specified users (`<@DISCORD_USER_ID>`) with clean Markdown notifications containing updated ticket dates and direct links.

---

## 🚀 Quick Setup Guide

### 1. Create a Discord Webhook

1. Open Discord and go to your server settings.  
2. Navigate to **Server Settings → Integrations → Webhooks → Create Webhook**.  
3. Name your webhook (e.g., `Chelsea Ticket Bot`) and select the notification channel.  
4. Click **Copy Webhook URL** and save it for step 4.

---

### 2. Configure Cloudflare KV Namespace

1. Log in to your [Cloudflare Dashboard](https://dash.cloudflare.com).  
2. Navigate to **Workers & Pages → KV → Create namespace**.  
3. Name the namespace (e.g., `ON_SALE_DATES`).  
4. Copy the **Namespace ID**.  
5. Update the `id` field in [`wrangler.jsonc`](file:///C:/Users/Peter/projects/chelsea-on-sale-date-bot/chelsea-on-sale-date-bot/wrangler.jsonc) with your KV Namespace ID:
   ```jsonc
   "kv_namespaces": [
     {
       "binding": "MY_KV",
       "id": "YOUR_KV_NAMESPACE_ID"
     }
   ]
   ```

---

### 3. Add Secrets (Environment Variables)

Add the following environment secrets in your Cloudflare Worker (**Settings → Variables → Secrets**) or via Wrangler CLI:

| Secret Name | Value Description |
| :--- | :--- |
| `DISCORD_WEBHOOK_URL` | Your Discord channel webhook URL |
| `DISCORD_USER_ID` | Your Discord User ID (for `@mention` pings) |

Using Wrangler CLI:
```bash
npx wrangler secret put DISCORD_WEBHOOK_URL
npx wrangler secret put DISCORD_USER_ID
```

---

### 4. Deploy the Worker

You can deploy using the **Wrangler CLI** (recommended) or via the Cloudflare Dashboard:

#### Via Wrangler CLI:
```bash
npx wrangler deploy
```

#### Via Cloudflare Dashboard:
1. Navigate to **Workers & Pages → Create a Worker**.
2. Name your worker (e.g., `chelsea-on-sale-bot`).
3. Click **Edit code**, paste the contents of [`worker.js`](file:///C:/Users/Peter/projects/chelsea-on-sale-date-bot/chelsea-on-sale-date-bot/worker.js), bind your `MY_KV` namespace under **Settings → Variables**, and click **Save and Deploy**.

---

### 5. Set up a Cron Trigger

To automatically check for ticket updates on a schedule:
1. In your Cloudflare Worker dashboard, go to **Triggers → Add Cron Trigger**.  
2. Set your schedule (e.g., `0 19 * * mon,tue,wed,thu,fri` to run every weekday at 7:00 PM UK time).

---

## ⚙️ How It Works

1. **Trigger**: A scheduled Cron trigger or HTTP request invokes [`worker.js`](file:///C:/Users/Peter/projects/chelsea-on-sale-date-bot/chelsea-on-sale-date-bot/worker.js).  
2. **Fetch**: Scrapes `https://www.chelseafc.com/en/all-on-sale-dates-men`.  
3. **Parse**: Extracts home match ticket tables and ballot application windows.  
4. **Diff Check**: Computes SHA-256 hashes for each table and checks Cloudflare KV (`MY_KV`) for existing state.  
5. **Notify**: If new dates or ballot application windows are published, formats a Discord message and pings `<@DISCORD_USER_ID>`.  
6. **Persist**: Stores updated hashes and row state back to KV.

---

## 📖 Developer Architecture & Entry Point

For technical architecture details, function maps, and DOM parsing specs, see [`ENTRYPOINT.md`](file:///C:/Users/Peter/projects/chelsea-on-sale-date-bot/chelsea-on-sale-date-bot/ENTRYPOINT.md).
