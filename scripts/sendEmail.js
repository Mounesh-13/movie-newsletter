import dotenv from 'dotenv';
import { pathToFileURL } from 'node:url';

dotenv.config();

// Design: Minimal Swiss (single family, text-forward) adapted to email
// constraints — table layout, inline CSS only, system font stack, 16px body.

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildEmailHtml(movie, facts, { unsubscribeUrl = '{{{UNSUBSCRIBE_URL}}}' } = {}) {
  const title = escapeHtml(movie.title);
  const year = escapeHtml((movie.release_date || '').slice(0, 4));
  const items = facts.map((f) => `              <li style="margin:0 0 12px 0;font-size:16px;line-height:1.6;color:#1a1a1a;">${escapeHtml(f)}</li>`).join('\n');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Today's Pick: ${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#ffffff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
<tr><td style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;">
<p style="margin:0 0 8px 0;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#666666;">Today's Pick</p>
<h1 style="margin:0 0 4px 0;font-size:28px;line-height:1.2;color:#111111;">${title}</h1>
<p style="margin:0 0 24px 0;font-size:15px;color:#666666;">${year} &middot; released on this day in history</p>
<hr style="border:none;border-top:1px solid #e5e5e5;margin:0 0 24px 0;">
<p style="margin:0 0 12px 0;font-size:16px;font-weight:bold;color:#111111;">3 lesser-known facts:</p>
<ol style="margin:0 0 24px 0;padding-left:22px;">
${items}
</ol>
<hr style="border:none;border-top:1px solid #e5e5e5;margin:0 0 16px 0;">
<p style="margin:0 0 8px 0;font-size:13px;color:#888888;">Movie data via TMDB and Wikipedia.</p>
<p style="margin:0;font-size:13px;color:#888888;"><a href="${unsubscribeUrl}" style="color:#888888;text-decoration:underline;">Unsubscribe</a></p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export function parseTestEmail(argv = process.argv) {
  const flag = argv.find((a) => a.startsWith('--test='));
  return flag ? flag.slice('--test='.length) : null;
}

function authHeaders(apiKey) {
  return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
}

function extractEmails(data) {
  const list = Array.isArray(data) ? data : data?.data ?? [];
  return list.filter((c) => !c.unsubscribed && c.email).map((c) => c.email);
}

// Audiences API is deprecated in favor of Segments (Nov 2025), so try the
// legacy path first, then segments, then the global contacts list.
export async function getSubscribers({ fetchFn = fetch, apiKey = process.env.RESEND_API_KEY, audienceId = process.env.RESEND_AUDIENCE_ID } = {}) {
  if (!apiKey) throw new Error('RESEND_API_KEY is missing. Add it to your local .env file (see .env.example).');
  if (!audienceId) throw new Error('RESEND_AUDIENCE_ID is missing. Add it to your local .env file (see .env.example).');

  const urls = [
    `https://api.resend.com/audiences/${audienceId}/contacts`,
    `https://api.resend.com/segments/${audienceId}/contacts`,
    'https://api.resend.com/contacts',
  ];
  let lastError = '';
  for (const url of urls) {
    let res;
    try {
      res = await fetchFn(url, { headers: authHeaders(apiKey) });
    } catch (err) {
      lastError = err.message;
      continue;
    }
    if (!res.ok) {
      lastError = `HTTP ${res.status} for ${url}`;
      continue;
    }
    return extractEmails(await res.json());
  }
  throw new Error(`Failed to fetch contacts from Resend: ${lastError}`);
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function sendBatch({ fetchFn, apiKey, from, subject, html, emails }) {
  const url = 'https://api.resend.com/emails/batch';
  const res = await fetchFn(url, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify(emails.map((email) => ({ from, to: [email], subject, html }))),
  });
  if (!res.ok) throw new Error(`Batch send failed: HTTP ${res.status}`);
  return true;
}

async function sendOne({ fetchFn, apiKey, from, subject, html, email }) {
  const res = await fetchFn('https://api.resend.com/emails', {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ from, to: [email], subject, html }),
  });
  if (!res.ok) throw new Error(`Send to ${email} failed: HTTP ${res.status}`);
}

export async function sendDailyEmail(movie, facts, { fetchFn = fetch, delayMs = 200, testEmail = null, from = process.env.RESEND_FROM || 'Movie Newsletter <onboarding@resend.dev>' } = {}) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is missing. Add it to your local .env file (see .env.example).');
  if (!movie || !facts || facts.length !== 3) throw new Error('sendDailyEmail requires a movie and exactly 3 facts.');

  const year = (movie.release_date || '').slice(0, 4);
  const subject = `Today's Pick: ${movie.title} (${year})`;
  const html = buildEmailHtml(movie, facts);

  if (testEmail) {
    await sendOne({ fetchFn, apiKey, from, subject, html, email: testEmail });
    console.log(`Test email sent successfully to ${testEmail}.`);
    return { sent: 1, failed: 0 };
  }

  const subscribers = await getSubscribers({ fetchFn, apiKey });
  if (subscribers.length === 0) {
    console.log('No active subscribers found. Nothing to send.');
    return { sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;
  const chunks = [];
  for (let i = 0; i < subscribers.length; i += 100) chunks.push(subscribers.slice(i, i + 100));

  for (const chunk of chunks) {
    try {
      await sendBatch({ fetchFn, apiKey, from, subject, html, emails: chunk });
      sent += chunk.length;
    } catch {
      // Batch unsupported/failed -> loop individually with a small delay
      for (const email of chunk) {
        try {
          await sendOne({ fetchFn, apiKey, from, subject, html, email });
          sent++;
        } catch (err) {
          failed++;
          console.error(`Error: ${err.message}`);
        }
        if (delayMs > 0) await delay(delayMs);
      }
    }
  }

  console.log(`Sent ${sent} email(s) successfully${failed ? `, ${failed} failed` : ''}.`);
  return { sent, failed };
}

const isDirectRun = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  const testEmail = parseTestEmail();
  const sampleMovie = { title: 'Jurassic Park', release_date: '1993-06-11' };
  const sampleFacts = [
    'The iconic T. rex roar was stitched together from tiger, alligator, and baby elephant sounds.',
    'The film used pioneering CGI alongside life-size animatronics built by Stan Winston’s crew.',
    'It became the highest-grossing film ever at release, holding the record for four years.',
  ];
  sendDailyEmail(sampleMovie, sampleFacts, { testEmail })
    .catch((err) => {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    });
}
