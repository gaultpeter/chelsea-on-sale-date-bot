# Chelsea On-Sale Date Bot

This guide covers creating a Discord webhook, a Cloudflare Worker, KV storage, secret binding, and deployment.

---

## 1. Create a Discord Webhook

1. Open Discord and go to your server.  
2. Navigate to **Server Settings → Integrations → Webhooks → Create Webhook**.  
3. Give it a name (e.g., `Chelsea Bot`) and select the channel for notifications.  
4. Click **Copy Webhook URL** and save it; you’ll need it later.  

---

## 2. Create a Cloudflare Worker

1. Log in to your [Cloudflare dashboard](https://dash.cloudflare.com).  
2. Navigate to **Workers & Pages → Create a Worker**.  
3. Name your worker (e.g., `chelsea-on-sale-bot`).  
4. Click **Edit code** to open the code editor.  

---

## 3. Create KV Namespace

1. Go to **Workers → KV → Create namespace**.  
2. Name the namespace (e.g., `ON_SALE_DATES`).  
3. Copy the **Namespace ID**; you’ll need it when binding.  

---

## 4. Add Secrets (Environment Variables)

1. In your worker, go to **Settings → Variables → Add variable**.  
2. Add the following secrets:  

| Variable Name | Value |
|---------------|-------|
| `DISCORD_WEBHOOK_URL` | Your Discord webhook URL |
| `DISCORD_USER_ID`     | Your Discord user ID |

> Note: KV will be used to store the last sent date checksum.  

---

## 5. Bind KV Namespace and Secrets

1. In **Settings → Variables → KV Namespaces**, click **Add binding**:  
   - **Variable name:** `MY_KV`  
   - **Namespace:** select the KV namespace you created (`MY_KV`)  

2. Confirm your secret variables are bound under **Secrets**.  

---

## 6. Deploy Worker

1. In the worker editor, paste your bot code.  
2. Save changes.  
3. Click **Deploy**.  

---

## 7. Optional: Set up a Cron Trigger

1. Go to **Triggers → Add Cron Trigger**.  
2. Set the schedule, e.g., `0 19 * * mon,tue,wed,thu,fri` to run every weekday at 7pm.  

---

## 8. How it Works

1. Cron trigger calls your worker.  
2. Worker scrapes Chelsea FC ticket on-sale dates.  
3. Checks KV (`MY_KV`) for previous date checksum.  
4. If new date found, sends Discord webhook message with `<@USER_ID>` mention.  
5. Updates KV with new checksum.
