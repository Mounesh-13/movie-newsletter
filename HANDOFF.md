# movie-newsletter — AI handoff context

Daily email newsletter: one notable movie released on today's date in history + 3 lesser-known facts, sent 6 PM IST. ESM Node (`"type": "module"`), tests via `node --test scripts/*.test.js` (56 tests).

## Layout
- `scripts/pickMovie.js` — TMDB discover per year 1950→now for today's MM-DD, score = vote_average*10 + log10(vote_count)*2 + anniversary bonus; excludes `vote_count<500`, unscorable records, `data/sent.json` IDs. Default Gemini model lives in getFacts, TMDB key via `TMDB_API_KEY`.
- `scripts/getFacts.js` — Wikipedia summary (+TMDB overview fallback) → Gemini grounded 3-fact JSON, one retry on bad JSON + one on 429/5xx. Model default `gemini-2.5-flash` (`GEMINI_MODEL` overrides). Returns null on total failure.
- `scripts/sendEmail.js` — `--test` path: raw `POST /emails` (Broadcasts has no ad-hoc recipient). Audience path: `POST /broadcasts {segment_id, from, subject, html, send:true}` (only path with working `{{{RESEND_UNSUBSCRIBE_URL}}}` + auto List-Unsubscribe headers). Fail-closed `requireSendConfig`; no global-contacts fallback; `--dry-run` logs payloads with redacted secret, zero network.
- `scripts/runAll.js` — approval gate: default prepares draft → `data/pending.json` (no send); `--approve` sends pending, records id in `data/sent.json`, clears pending. Zero-delivery never records.
- `web/` — static landing (index.html/styles.css/app.js) + `api/subscribe.js` (validates, creates Resend contact; `segments` only if audience ID set). Deployed with Vercel Root Directory=`web`; `web/package.json` (`type:module`) is required or functions crash. No vercel.json by design.
- `.github/workflows/daily.yml` — cron `30 12 * * *` UTC (=6 PM IST) + `workflow_dispatch(approve_send)`; `npm ci`; commits `data/` state back as github-actions[bot]; concurrency-guarded.

## Env vars
- Local `.env` (gitignored, never commit): TMDB_API_KEY, GEMINI_API_KEY (+optional GEMINI_MODEL), RESEND_API_KEY, RESEND_AUDIENCE_ID (optional until Segment exists), RESEND_FROM.
- GitHub Secrets: same five. Vercel env: only the three RESEND_*.
- `RESEND_AUDIENCE_ID` must be a **Segment ID** for broadcast sends (legacy audience IDs fail loudly).

## Accepted limitations (see KNOWN_LIMITATIONS.md)
Sandbox sender (spam expected, closed testers only); TMDB serial calls (fine daily); unsubscribe click-through still needs a real broadcast-send inbox check.

## Status / open items
- Done: pipeline, gate, 56 tests green, live site + subscribe API verified (400/405 live probes), real --test send delivered.
- Open: GitHub Secrets placement (all five arrived empty in CI — must be Repository Secrets) → re-run prepare; inbox unsubscribe verification on a broadcast send; create Resend Segment; real domain for deliverability.
