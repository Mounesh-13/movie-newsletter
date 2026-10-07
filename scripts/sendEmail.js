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

export function buildEmailHtml(movie, facts, { unsubscribeUrl = '{{{RESEND_UNSUBSCRIBE_URL}}}' } = {}) {
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

export function parseDryRun(argv = process.argv) {
  return argv.includes('--dry-run');
}

// Exact JSON body sent to POST /emails for a single recipient.
// Pure (no network) — also powers --dry-run inspection.
export function buildTestPayload({ from, subject, html, email }) {
  return { from, to: [email], subject, html };
}

// Blocker 1+3: fail closed — every required var must be present and non-empty
// before anything touches the network. Names exactly which one is missing.
const REQUIRED_SEND_VARS = ['RESEND_API_KEY', 'RESEND_AUDIENCE_ID', 'RESEND_FROM'];

export function requireSendConfig(env = process.env, keys = REQUIRED_SEND_VARS) {
  const missing = keys.filter((k) => !env[k] || !String(env[k]).trim());
  if (missing.length > 0) {
    throw new Error(
      `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing. Add ${missing.length === 1 ? 'it' : 'them'} to your local .env file (see .env.example).`,
    );
  }
  return { apiKey: env.RESEND_API_KEY, audienceId: env.RESEND_AUDIENCE_ID, from: env.RESEND_FROM };
}

// Blocker 1: a direct/manual run without --test must refuse, never fall
// through to the real-audience path.
export function requireTestEmail(testEmail) {
  if (!testEmail) {
    throw new Error('Refusing to send to the real audience. Re-run with --test=you@example.com');
  }
  return testEmail;
}

function authHeaders(apiKey) {
  return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
}

function extractEmails(data) {
  const list = Array.isArray(data) ? data : data?.data ?? [];
  return list.filter((c) => !c.unsubscribed && c.email).map((c) => c.email);
}

// Audiences API is deprecated in favor of Segments (Nov 2025), so try the
// legacy path first, then segments. Blocker 2: there is deliberately NO
// fallback to the unscoped global /contacts list — emailing every contact
// in the account because one audience fetch failed would be a privacy
// incident. A scoped fetch failure throws loudly instead.
export async function getSubscribers({ fetchFn = fetch, apiKey = process.env.RESEND_API_KEY, audienceId = process.env.RESEND_AUDIENCE_ID } = {}) {
  if (!apiKey) throw new Error('RESEND_API_KEY is missing. Add it to your local .env file (see .env.example).');
  if (!audienceId) throw new Error('RESEND_AUDIENCE_ID is missing. Add it to your local .env file (see .env.example).');

  const urls = [
    `https://api.resend.com/audiences/${audienceId}/contacts`,
    `https://api.resend.com/segments/${audienceId}/contacts`,
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

// Exact JSON body for POST /broadcasts (create + send immediately).
// Pure (no network). Broadcasts is the only path that yields working
// per-recipient List-Unsubscribe URLs — raw /emails has no equivalent.
export function buildBroadcastPayload({ segmentId, from, subject, html, name }) {
  return { segment_id: segmentId, from, subject, html, name, send: true };
}

// Audience sends go ONLY here, explicitly scoped to the segment ID.
// There is no global/default recipient list — a bad ID fails loudly.
export async function sendBroadcast({ fetchFn = fetch, apiKey, audienceId, from, subject, html, name }) {
  if (!audienceId) {
    throw new Error('RESEND_AUDIENCE_ID is missing. Add it to your local .env file (see .env.example).');
  }
  const res = await fetchFn('https://api.resend.com/broadcasts', {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify(buildBroadcastPayload({ segmentId: audienceId, from, subject, html, name })),
  });
  if (!res.ok) throw new Error(`Broadcast send failed: HTTP ${res.status}`);
  const data = await res.json();
  if (!data?.id) throw new Error('Broadcast send failed: no broadcast id in response');
  return { broadcastId: data.id };
}

async function sendOne({ fetchFn, apiKey, from, subject, html, email }) {
  const res = await fetchFn('https://api.resend.com/emails', {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify(buildTestPayload({ from, subject, html, email })),
  });
  if (!res.ok) throw new Error(`Send to ${email} failed: HTTP ${res.status}`);
}

export async function sendDailyEmail(movie, facts, { fetchFn = fetch, testEmail = null, from = process.env.RESEND_FROM } = {}) {
  // --test path: Broadcasts has NO ad-hoc single recipient (segment sends
  // only), so test sends stay on raw /emails — unsubscribe compliance
  // doesn't apply to a test mail to yourself. Hence the two paths differ.
  const cfg = requireSendConfig(process.env, ['RESEND_API_KEY', 'RESEND_FROM']);
  const apiKey = cfg.apiKey;
  if (!from) from = cfg.from;
  if (!movie || !facts || facts.length !== 3) throw new Error('sendDailyEmail requires a movie and exactly 3 facts.');

  const year = (movie.release_date || '').slice(0, 4);
  const subject = `Today's Pick: ${movie.title} (${year})`;
  const html = buildEmailHtml(movie, facts);

  if (testEmail) {
    await sendOne({ fetchFn, apiKey, from, subject, html, email: testEmail });
    console.log(`Test email sent successfully to ${testEmail}.`);
    return { sent: 1, failed: 0 };
  }

  // Audience path: full config required — sending without a scoped
  // audience ID is never allowed.
  const full = requireSendConfig();
  const subscribers = await getSubscribers({ fetchFn, apiKey: full.apiKey, audienceId: full.audienceId });
  if (subscribers.length === 0) {
    console.log('No active subscribers found. Nothing to send.');
    return { sent: 0, failed: 0 };
  }

  const name = `Daily Pick ${new Date().toISOString().slice(0, 10)}: ${movie.title}`;
  const { broadcastId } = await sendBroadcast({
    fetchFn, apiKey: full.apiKey, audienceId: full.audienceId, from, subject, html, name,
  });
  console.log(`Broadcast ${broadcastId} sent to segment (${subscribers.length} subscriber(s)). Unsubscribe handling by Resend.`);
  return { sent: subscribers.length, failed: 0, broadcastId };
}

const isDirectRun = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  try {
    const testEmail = requireTestEmail(parseTestEmail());
    const sampleMovie = { title: 'Jurassic Park', release_date: '1993-06-11' };
    const sampleFacts = [
      'The iconic T. rex roar was stitched together from tiger, alligator, and baby elephant sounds.',
      'The film used pioneering CGI alongside life-size animatronics built by Stan Winston’s crew.',
      'It became the highest-grossing film ever at release, holding the record for four years.',
    ];
    if (parseDryRun()) {
      // Inspection only: zero network calls, works without env keys
      // (unset values shown as placeholders). Secret is never printed.
      const year = sampleMovie.release_date.slice(0, 4);
      const subject = `Today's Pick: ${sampleMovie.title} (${year})`;
      const html = buildEmailHtml(sampleMovie, sampleFacts);
      const report = {
        dryRun: true,
        note: 'Payloads that WOULD be sent. Tag substitution and List-Unsubscribe headers are applied server-side by Resend on broadcast send, so the tag below is literal by necessity — this cannot prove substitution or header presence; only a real send + inbox check can.',
        testRequest: {
          url: 'https://api.resend.com/emails',
          method: 'POST',
          headers: { Authorization: 'Bearer [REDACTED]', 'Content-Type': 'application/json' },
          body: buildTestPayload({
            from: process.env.RESEND_FROM || '[RESEND_FROM not set]',
            subject,
            html,
            email: testEmail,
          }),
        },
        audienceBroadcastRequest: {
          url: 'https://api.resend.com/broadcasts',
          method: 'POST',
          headers: { Authorization: 'Bearer [REDACTED]', 'Content-Type': 'application/json' },
          body: buildBroadcastPayload({
            segmentId: process.env.RESEND_AUDIENCE_ID || '[RESEND_AUDIENCE_ID not set]',
            from: process.env.RESEND_FROM || '[RESEND_FROM not set]',
            subject,
            html,
            name: `Daily Pick ${new Date().toISOString().slice(0, 10)}: ${sampleMovie.title}`,
          }),
        },
      };
      console.log(JSON.stringify(report, null, 2));
    } else {
      // Fail closed: validate the vars the --test path needs AND require
      // --test up front — a bare run must never reach the real audience.
      // RESEND_AUDIENCE_ID is not needed here (test sends bypass it).
      requireSendConfig(process.env, ['RESEND_API_KEY', 'RESEND_FROM']);
      await sendDailyEmail(sampleMovie, sampleFacts, { testEmail });
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}
