# movie-newsletter

A daily email newsletter that picks **one notable movie released on today's date in history** and sends **3 lesser-known facts** about it.

## How it works

1. `npm run pick` — pick a notable movie released on this day/month in past years (via TMDB).
2. `npm run facts` — generate 3 lesser-known facts about the picked movie (via Gemini).
3. `npm run send` — send the newsletter email to subscribers (via Resend).
4. `npm run run-all` — run pick → facts → send end-to-end.

## Setup

```bash
npm install
cp .env.example .env
# fill in keys in .env
```

Required env vars (see `.env.example`):

- `TMDB_API_KEY` — The Movie Database API key
- `GEMINI_API_KEY` — Google Gemini API key for fact generation
- `RESEND_API_KEY` — Resend API key for sending email
- `RESEND_AUDIENCE_ID` — Resend audience ID for subscribers

## Project structure

```text
movie-newsletter/
├── .github/workflows/  # scheduled daily run (later phase)
├── scripts/            # pick.js, facts.js, send.js, run-all.js (later phases)
├── web/                # landing page / archive (later phase)
├── data/               # local cache / picks history (gitignored if needed)
├── .env.example
├── package.json
└── README.md
```
