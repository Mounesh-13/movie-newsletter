# movie-newsletter

A daily email newsletter that picks **one notable movie released on today's date in history** and sends **3 lesser-known facts** about it.

## How it works

1. `npm run pick` — pick a notable movie released on this day/month in past years (via TMDB).
2. `npm run facts` — generate 3 lesser-known facts about the picked movie (via Gemini).
3. `npm run send -- --test=you@example.com` — send a sample only to you (via Resend).
4. `npm run run-all` — prepare a draft; review `data/pending.json`.
5. `npm run run-all:approve` — send the reviewed draft to the newsletter segment.

## Free sending without a domain

Use **Gmail OAuth** for a small friends-only list: see [GMAIL_SETUP.md](GMAIL_SETUP.md).
No App Password is required. This keeps Resend as the contacts database and can
explicitly use all newsletter contacts without a Segment ID. Google authorization
is still required; the Arena Gmail connection cannot authorize the scheduled job.

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
- `RESEND_AUDIENCE_ID` — Resend **Segment ID** for newsletter subscribers (required for both signups and broadcasts)
- `RESEND_FROM` — sender on a domain verified in Resend, e.g. `Movie Newsletter <news@yourdomain.com>`

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

## Fixing “only I receive the email”

1. **Verify a sending domain in Resend** (including its required DNS records),
   then set `RESEND_FROM` to an address on that domain in GitHub repository
   Actions secrets and your local `.env`. `onboarding@resend.dev` only delivers
   to the Resend account owner; it is not a spam-folder issue and cannot send
   the newsletter to friends. Code cannot bypass this provider restriction.
2. **Use the same Resend account and newsletter Segment ID everywhere.** Set
   `RESEND_API_KEY` and `RESEND_AUDIENCE_ID` in both the signup deployment's
   environment (Vercel) and GitHub repository Actions secrets. Redeploy the
   signup site after changing its environment. The API key needs access to
   contacts and broadcasts, not only transactional email sending.
3. **Repair existing signups:** in Resend Contacts, add the friends who opted
   into this newsletter to that newsletter segment. Older signups made without
   `RESEND_AUDIENCE_ID` may exist only in the global contacts database and are
   excluded from broadcasts. Preserve unsubscribe preferences; do not import
   every account contact or resubscribe people who opted out. New signups now
   fail clearly if the segment is missing instead of silently creating orphans.
4. **Send a broadcast, not a test:** prepare and review the draft, then run
   `npm run run-all:approve`. In GitHub Actions, manually run `daily-newsletter`
   with `approve_send=true`. `--test=...` intentionally sends to one address
   only. The scheduled workflow currently prepares drafts without sending;
   the explicit approval gate is retained.
5. **Check Resend's broadcast delivery events** for each intended recipient.
   API acceptance is not proof of inbox delivery; check bounces and spam as
   well. No live emails are sent by `npm test`.
