# TESTING.md — pre-launch verification checklist

Do these in order. Do not enable the live cron until all boxes are checked.
Requires a local `.env` with real keys (never commit it — it is gitignored).

## 0. Env setup (local)

```bash
cp .env.example .env
# fill in: TMDB_API_KEY, GEMINI_API_KEY, RESEND_API_KEY, RESEND_AUDIENCE_ID,
# RESEND_FROM (verified sender — onboarding@resend.dev only delivers to the
# account owner, so real sends need e.g. Movie Newsletter <news@yourdomain.com>)
```

## 1. Pick — `npm run pick`

- [ ] Returns one movie object (id, title, release_date, vote_average, vote_count, score).
- [ ] `release_date` matches today's month/day; `vote_count >= 500`.
- [ ] Takes ~1–2 min (one TMDB call per year since 1950) — expected.

## 2. Facts — `npm run facts` (+ variety check)

Direct run uses a hardcoded Jurassic Park sample. To check other eras, temporarily
edit the `sample` object at the bottom of `scripts/getFacts.js`, run, then revert
(do not commit the edit).

- [ ] Returns exactly 3 strings, casual tone, 1–2 sentences each.
- [ ] Each fact is verifiable in the Wikipedia article / TMDB overview (no invented details).
- [ ] Spot-check 6 dates across eras/genres (run pick or the sample tweak, read against Wikipedia):
  1. `05-25` — Star Wars (1977, sci-fi)
  2. `12-15` — Gone with the Wind (1939, classic drama)
  3. `03-31` — The Matrix (1999, sci-fi)
  4. `06-11` — Jurassic Park (1993, adventure)
  5. `12-19` — Titanic (1997, romance)
  6. `07-18` — The Dark Knight (2008, superhero)

## 3. Test email — safe send only

> Never run `node scripts/sendEmail.js` or `npm run send` without `--test`.
> Without the flag it sends to the **entire audience**.

- [ ] `node scripts/sendEmail.js --test=myemail@example.com` → success log, exit 0.
- [ ] Pre-send inspection (no inbox needed): `node scripts/sendEmail.js --test=myemail@example.com --dry-run`
      logs the exact JSON body with zero network calls. Confirm the `{{{RESEND_UNSUBSCRIBE_URL}}}`
      tag is spelled correctly — it will be literal here by necessity (substitution, if any,
      happens on Resend's servers at send time, so dry-run cannot prove substitution).
- [ ] Email arrives; renders well on desktop AND a mobile client.
- [ ] Unsubscribe check (template now uses the docs-verified `{{{RESEND_UNSUBSCRIBE_URL}}}`):
  - [ ] Gmail → Show original → confirm what `List-Unsubscribe` headers (if any) are present.
        Note: the merge tag is a Broadcasts/Automations feature; on raw `/emails` API sends
        it may render literally. If the link is dead or the tag is literal, switch the send
        path to the Broadcasts API (or add a hosted preferences URL + `List-Unsubscribe`
        headers) before launch — do not ship a dead unsubscribe link.
  - [ ] Click the unsubscribe link in the test email → landing page confirms opt-out.
  - [ ] Resend dashboard → audience → test contact shows unsubscribed/removed.

## 4. GitHub Action — manual trigger (approval-gate flow)

Prereqs: repo pushed; 4 secrets set (Settings → Secrets and Variables → Actions):
`TMDB_API_KEY`, `GEMINI_API_KEY`, `RESEND_API_KEY`, `RESEND_AUDIENCE_ID`
(+ `RESEND_FROM` once wired). Workflow permissions → **Read and write**.

Default runs only PREPARE (pick + facts → `data/pending.json`, no send):

- [ ] Actions → daily-newsletter → Run workflow (`approve_send: false`) → green.
- [ ] Read the prepare log: movie + 3 facts look right.
- [ ] A state commit (`data/pending.json`) lands on main.
- [ ] To actually send: re-run with `approve_send: true` → audience email goes out
      once, id recorded in `data/sent.json`, `pending.json` cleared.

## 5. Signup — live Vercel page

Prereqs: Vercel project with Root Directory `web`; env vars `RESEND_API_KEY`,
`RESEND_AUDIENCE_ID`, `RESEND_FROM` set in the Vercel dashboard (all environments).

- [ ] Submit your own email on the live page → success message, no reload.
- [ ] It appears in Resend dashboard → Contacts/Audience within a minute.
- [ ] Submit a bad email → clean inline error, no contact created.

## 6. Full live cron — one real day

- [ ] Let one scheduled 6 PM IST run fire (prepare only). Review the draft.
- [ ] Manually dispatch with `approve_send: true`. Confirm: audience delivery,
      `sent.json` committed, `pending.json` cleared, summary in the Action log.

## 7. Launch blockers — RESOLVED

1. ~~Direct run without `--test` sends to everyone~~ → FIXED: direct run now calls
   `requireTestEmail()` and refuses (`Refusing to send to the real audience…`, exit 1).
2. ~~Global `/contacts` fallback~~ → FIXED: fallback URL removed; a wrong audience ID
   fails loudly after the two scoped attempts, never substituting another list.
3. ~~`RESEND_FROM` unwired~~ → FIXED: required at startup via `requireSendConfig()`,
   passed into every send call, added to `.env.example`, `daily.yml`, and Vercel env list (§5 needs `RESEND_FROM` too).
4. ~~Zero-delivery records id~~ → FIXED (was already guarded in `sendApproved`, now proven):
   `sent: 0` keeps `pending.json`, records nothing, returns `skipped-send-failed` (exit 1).

## 8. Hardening pass — RESOLVED (blockers above untouched)

5. ~~Wrong unsubscribe tag (`{{{UNSUBSCRIBE_URL}}}`)~~ → FIXED: template now uses the
   docs-verified `{{{RESEND_UNSUBSCRIBE_URL}}}`. Raw-API substitution + header presence
   still require the manual §3 checks above before launch.
6. ~~NaN scores from malformed TMDB records~~ → FIXED: `pickWinner` excludes unscorable
   candidates (non-finite ratings / unparseable date); formula untouched; covered by test.
7. TMDB serial per-year fetches → DEFERRED: known future optimization (`Promise.all`
   batching), noted in-code; fine for a once-daily run, not a launch blocker.
