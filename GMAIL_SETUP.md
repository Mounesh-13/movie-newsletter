# Free sending from a personal Gmail account

Gmail mode sends from your personal Gmail using Google's OAuth API. No purchased
sending domain or App Password is needed. Resend remains the subscriber database,
not the email sender. This is intended for a small friends-only list, not bulk
marketing. Gmail account quotas, anti-abuse policies, and inbox filtering still
apply. The code caps each run at 100 recipients; that is our safety cap, not a
promise about Google's daily quota. No billing account is required for this setup.

## 1. Authorize Google once (account owner action)

Do not paste passwords, client secrets, or tokens into chat or commit them to Git.

1. Open <https://console.cloud.google.com/> with the personal Gmail account you
   want to send from. Create a project, then enable **Gmail API** in the API library.
2. Open **Google Auth Platform** (formerly OAuth consent screen). Configure the
   app's name and your contact email. Choose **External** audience. While testing,
   add your own Gmail address as a test user. Request only the scope
   `https://www.googleapis.com/auth/gmail.send` (send mail, not read your inbox).
3. Under **Clients**, create an OAuth client of type **Web application**. Add
   `https://developers.google.com/oauthplayground` as an authorized redirect URI.
4. Open <https://developers.google.com/oauthplayground>. In its settings (gear),
   enable **Use your own OAuth credentials** and enter that client's ID and secret.
   Use **Offline** access and consent prompting. Enter the exact `gmail.send`
   scope above, authorize, and sign in as the sender. Only authorize your own
   project; review Google's displayed permissions.
5. Exchange the authorization code for tokens. Save the **refresh token**, not
   the short-lived access token, in GitHub as described below. Do not use the
   Playground's shared OAuth client for the scheduled job.

**Important:** Google's External apps in **Testing** typically issue refresh
 tokens that expire after seven days for this scope. For ongoing personal use,
 change the app's publishing status to **In production**, then authorize again.
 Publishing status is not the same as Google verification; personal-use apps
 may still show an unverified-app warning and be subject to user limits. Follow
 any verification requirements Google actually displays. Do not weaken account
 security or bypass a Google policy block. If Google blocks authorization, stop
 and share only the non-sensitive error text.

## 2. Configure GitHub (no credentials in source files)

In this repository: **Settings → Secrets and variables → Actions**.

Add these **repository secrets**:

| Secret | Value |
|---|---|
| `GMAIL_USER` | The personal Gmail address you authorized |
| `GOOGLE_CLIENT_ID` | Your OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Your OAuth client secret |
| `GOOGLE_REFRESH_TOKEN` | The refresh token from your authorization |
| `RESEND_API_KEY` | Existing key with permission to read contacts |

Keep the existing `TMDB_API_KEY` and `GEMINI_API_KEY` secrets.
`GMAIL_APP_PASSWORD` and `RESEND_FROM` are **not used** in Gmail mode.

Under the **Variables** tab, set `EMAIL_PROVIDER` to `gmail`.

If this Resend account contains **only people who subscribed to this newsletter**,
set `NEWSLETTER_CONTACT_SOURCE` to `all`. This deliberately uses every active
contact, including earlier signups saved without a Segment ID. It does not
resubscribe anyone and filters contacts marked unsubscribed. No Audience ID is
needed in this mode.

If the account contains other mailing lists, **do not choose `all`**. Instead keep
`RESEND_AUDIENCE_ID` set to the newsletter's Segment ID and add only consenting
newsletter subscribers to that segment.

For local runs, put the same values in the gitignored `.env` file.

## 3. Keep new signups in the same list

For an all-contacts newsletter, set `NEWSLETTER_CONTACT_SOURCE=all` in the signup
site's Vercel environment and redeploy the site. Keep its `RESEND_API_KEY` pointing
to the same account. No Google credentials belong in Vercel or browser code.
If using a segment instead, keep the same Segment ID on Vercel and GitHub.

## 4. Test, then send to friends

After deploying the code and setting local environment variables, a local test:

```sh
npm run send -- --test=YOUR_ADDRESS@gmail.com
```

This sends only to that address. It does not email your friends.

For an audience send, prepare and review the draft, then approve:

```sh
npm run run-all
npm run run-all:approve
```

Alternatively run `daily-newsletter` in GitHub Actions with `approve_send=true`.
The daily schedule still prepares only; it does not bypass the approval gate.
Gmail API acceptance is not proof of inbox delivery: check Gmail Sent and a
friend's inbox. This sandbox cannot reach Google's/Resend's APIs, so the code
has mock tests but needs this live check after authorization.

## Unsubscribe and retry behavior

Gmail messages include an unsubscribe **email request** link and a mailto
List-Unsubscribe header, not Resend's broadcast placeholder. This is a manual
opt-out flow for the small friends-only list: monitor replies and mark a person
**unsubscribed in Resend before the next send**. Gmail mode does not automate
one-click unsubscribe or monitor your inbox (its permission is send-only).
Do not use this mode for public/bulk signups requiring automated opt-out handling.

Accepted messages are recorded as opaque keyed IDs in `data/gmail-delivery.json`.
No recipient addresses or tokens are stored there. The workflow saves the file
alongside its other state, even on a failed run. Keep it intact: a retry of the
same draft skips confirmed recipients. Partial failures keep the pending draft.
The key uses your refresh token: changing that token invalidates old deduplication
IDs. A crash between acceptance and saving state, a network timeout, or a failed
state commit can still cause a duplicate on retry. Check Sent before retrying
these cases. Do not run concurrent local and Actions sends.
