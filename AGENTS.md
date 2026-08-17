# Chelsea On-Sale Date Bot — Developer & Agent Reference

Cloudflare Worker that monitors Chelsea FC men's home ticket on-sale dates and ballot windows, diffs table/row state in Cloudflare KV, and posts Discord notifications via webhook.

---

## Architecture & Data Flow

1. **Trigger** — cron schedule or manual HTTP request invokes `runMonitor`.
2. **Scrape** — fetches `https://www.chelseafc.com/en/all-on-sale-dates-men`.
3. **Parse** — extracts each home match table (with its fixture heading) via direct HTML parsing, falling back to the JSON payload in the `GenericContentBlock` `data-props`.
4. **Diff** — computes a SHA-256 hash per table and compares rows against KV state.
5. **Notify** — sends a Discord message for changed rows.
6. **Persist** — stores the new table hash and row state.

## Repository Structure

| Path | Description |
| :--- | :--- |
| [`worker.js`](./worker.js) | Worker entry point: handlers, scraping, KV diffing, Discord integration |
| [`wrangler.jsonc`](./wrangler.jsonc) | Wrangler config: worker name, compatibility date, KV binding |
| [`README.md`](./README.md) | Setup and deployment guide |
| [`AGENTS.md`](./AGENTS.md) | This reference |

## Function Map (`worker.js`)

### Handlers
- [`scheduled`](./worker.js#L6) — runs on cron; calls `runMonitor`
- [`fetch`](./worker.js#L9) — manual trigger; calls `runMonitor` and returns confirmation

### Pipeline
- [`runMonitor`](./worker.js#L19) — orchestrates the full check (scrape → diff → notify)
- [`fetchPage`](./worker.js#L62) — fetches the target page, throws on non-OK status
- [`extractAllTables`](./worker.js#L88) — parses tables + section headings, with JSON fallback
- [`extractChangedRows`](./worker.js#L136) — diffs each row against KV and returns formatted changes
- [`parseTableRows`](./worker.js#L164) — converts `<th>`/`<td>` HTML into clean header/row arrays

### Diffing & Normalization
- [`getOpponentName`](./worker.js#L190) — extracts opponent from headers or fixture title
- [`buildRowKey`](./worker.js#L204) — deterministic slug key per row
- [`buildRowObject`](./worker.js#L216) — maps a row to a normalized object
- [`normalizeHeader`](./worker.js#L227), [`normalizeWhitespace`](./worker.js#L243), [`formatFieldTitle`](./worker.js#L235) — text helpers
- [`formatFullRow`](./worker.js#L247) — formats a row object for Discord
- [`computeHash`](./worker.js#L254) — SHA-256 digest via Web Crypto

### Notifications
- [`sendDiscordNotification`](./worker.js#L259) — posts the formatted message, with rate-limit retry

## Configuration & Bindings

| Secret / Variable | Type | Description |
| :--- | :--- | :--- |
| `MY_KV` | KV binding | Stores `lastHash_*` table hashes and `row_*` row state |
| `DISCORD_WEBHOOK_URL` | Secret | Discord webhook URL for alerts |
| `DISCORD_USER_ID` | Secret | Discord user ID for `@mention` pings |

## Operations

- **Local dev:** `npx wrangler dev` then `curl http://localhost:8787`
- **Deploy:** `npx wrangler deploy` (or push to `main` — Cloudflare Git integration auto-deploys)

See [`README.md`](./README.md) for full setup instructions.