# Chelsea On-Sale Date Bot

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare%20Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Discord](https://img.shields.io/badge/Discord-notifications-5865F2?logo=discord&logoColor=white)](https://discord.com)

Cloudflare Worker that monitors Chelsea FC's **men's home** ticket on-sale dates and ballot application windows, and posts a Discord notification whenever a date changes.

## Features

- **On-sale + ballot tracking** — application window open/close, priority ticket exchange, and general on-sale dates
- **Home matches only** — away fixtures are filtered out
- **Granular change detection** — SHA-256 hashes per table, plus per-row state in Cloudflare KV, so you only get notified about the exact rows that changed
- **Robust parsing** — reads the live table HTML with a fallback to the embedded JSON data
- **Discord alerts** — formatted Markdown message with the updated dates and a link to the full page

## Prerequisites

- Node.js 18+
- A Cloudflare account with Workers and KV enabled
- A Discord server where you can create webhooks

## Quick start

```bash
git clone https://github.com/gaultpeter/chelsea-on-sale-date-bot.git
cd chelsea-on-sale-date-bot
npx wrangler dev    # local dev server
```

## How it works

1. Fetch the [men's on-sale dates page](https://www.chelseafc.com/en/all-on-sale-dates-men)
2. Extract each home match table with its fixture heading
3. Hash each table and diff rows against Cloudflare KV
4. Send a Discord notification for changed rows
5. Persist the new table + row state

## Setup

### 1. Discord webhook

1. Discord → Server Settings → Integrations → Webhooks → **Create Webhook**
2. Name it (e.g. `Chelsea On-Sale Dates`) and pick a channel
3. Copy the webhook URL

### 2. Cloudflare KV

Create a KV namespace (Workers & Pages → KV) and set its `id` in [`wrangler.jsonc`](./wrangler.jsonc) under `kv_namespaces`.

### 3. Secrets

| Secret / Variable | Required | Description |
| :--- | :---: | :--- |
| `DISCORD_WEBHOOK_URL` | Yes | Discord webhook URL |
| `DISCORD_USER_ID` | Optional | Your Discord user ID (enables `@mention`) |

```bash
npx wrangler secret put DISCORD_WEBHOOK_URL
```

## Deploy

Pushing to `main` auto-deploys via Cloudflare's Git integration. To deploy manually:

```bash
npx wrangler deploy
```

## Schedule

Configured in [`wrangler.jsonc`](./wrangler.jsonc) (cron, UTC):

- `*/15 8-20 * * mon-fri` — every 15 minutes on weekdays
- `0 9,12,15,18 * * sat-sun` — 4× daily on weekends

## Endpoints

- `GET /` — run a check manually

## License

[MIT](./LICENSE)

## Architecture

See [`AGENTS.md`](./AGENTS.md) for the parsing, diffing, and notification pipeline reference.