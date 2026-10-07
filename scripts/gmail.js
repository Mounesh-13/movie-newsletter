import { createHmac } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const JOURNAL = new URL('../data/gmail-delivery.json', import.meta.url);

export function gmailConfig(env = process.env) {
  const keys = ['GMAIL_USER', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'];
  const missing = keys.filter(k => !env[k]?.trim());
  if (missing.length) throw new Error(`Missing Gmail OAuth configuration: ${missing.join(', ')}. See GMAIL_SETUP.md.`);
  if (!/^[^\s<>@]+@gmail\.com$/i.test(env.GMAIL_USER.trim())) throw new Error('GMAIL_USER must be your authorized personal @gmail.com address.');
  return Object.fromEntries(keys.map(k => [k, env[k].trim()]));
}

export function gmailRaw({ from, to, subject, html }) {
  if (![from, to].every(v => typeof v === 'string' && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(v))) {
    throw new Error('Invalid Gmail sender or recipient.');
  }
  const unsubscribe = `mailto:${from}?subject=Unsubscribe%20movie%20newsletter`;
  const encoded = Buffer.from(html).toString('base64').match(/.{1,76}/g)?.join('\r\n') || '';
  return Buffer.from([
    `From: Movie Newsletter <${from}>`, `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'MIME-Version: 1.0', 'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64', `List-Unsubscribe: <${unsubscribe}>`,
    '', encoded,
  ].join('\r\n')).toString('base64url');
}

async function loadJournal() {
  try {
    const data = JSON.parse(await readFile(JOURNAL, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid Gmail delivery journal');
    return data;
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}
async function persistJournal(journal) {
  await mkdir(new URL('../data/', import.meta.url), { recursive: true });
  await writeFile(JOURNAL, JSON.stringify(journal, null, 2));
}

// One message per person; never expose other subscribers in To or CC.
// Remember API-accepted messages so retrying a partial draft skips those people.
export async function sendGmail({ recipients, subject, html, deliveryKey, test = false,
  env = process.env, fetchFn = fetch, loadJournalFn = loadJournal, saveJournalFn = persistJournal,
} = {}) {
  const cfg = gmailConfig(env);
  const unique = [...new Set(recipients.map(email => email.trim().toLowerCase()))];
  if (!unique.length) return { sent: 0, failed: 0 };
  if (unique.length > 100) throw new Error('Gmail mode is limited to 100 newsletter recipients per run. Use a newsletter provider for larger lists.');
  // Validate every address before sending anything.
  const messages = unique.map(to => gmailRaw({ from: cfg.GMAIL_USER, to, subject, html }));
  if (!test && !deliveryKey) throw new Error('Gmail audience sends require a stable delivery key.');
  const journal = test ? {} : await loadJournalFn();
  const tokenRes = await fetchFn('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.GOOGLE_CLIENT_ID, client_secret: cfg.GOOGLE_CLIENT_SECRET,
      refresh_token: cfg.GOOGLE_REFRESH_TOKEN, grant_type: 'refresh_token' }).toString(),
  });
  if (!tokenRes.ok) throw new Error(`Google authorization failed (HTTP ${tokenRes.status}). Reauthorize using GMAIL_SETUP.md; no messages sent.`);
  const { access_token: accessToken } = await tokenRes.json();
  if (!accessToken) throw new Error('Google authorization returned no access token.');
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < unique.length; i++) {
    // Opaque keyed IDs only: don't commit recipients or credentials to Git.
    const key = createHmac('sha256', cfg.GOOGLE_REFRESH_TOKEN).update(JSON.stringify([deliveryKey, unique[i]])).digest('hex');
    if (!test && journal[key]) { sent++; continue; }
    let res;
    try {
      res = await fetchFn('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: messages[i] }),
      });
    } catch {
      // Stop: a network error is ambiguous (Google may have accepted the mail).
      throw new Error('Gmail connection interrupted. Check Sent mail before retrying; the last message may have been accepted.');
    }
    if (!res.ok) {
      failed = unique.length - i;
      console.error(`Gmail send stopped: HTTP ${res.status}. ${sent} accepted/already accepted; ${failed} not confirmed. Check authorization or sending limits.`);
      break;
    }
    const result = await res.json();
    if (!result.id) throw new Error('Gmail returned no message ID; check Sent mail before retrying.');
    sent++;
    if (!test) {
      journal[key] = true;
      await saveJournalFn(journal);
    }
  }
  return { sent, failed };
}
