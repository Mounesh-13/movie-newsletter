export function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length === 0 || trimmed.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export default async function handler(req, res, { fetchFn = fetch } = {}) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: 'Invalid request body.' });
    }
  }
  const email = body?.email?.trim?.() ?? '';

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  // RESEND_AUDIENCE_ID is optional: when set, the contact joins that
  // segment; when blank, a plain global contact is created (Resend's
  // Audiences page no longer shows it — create a Segment to get an ID).
  const audienceId = (process.env.RESEND_AUDIENCE_ID || '').trim();
  if (!apiKey) {
    return res.status(500).json({ error: 'Subscription service is not configured. Please try again later.' });
  }

  const contactBody = { email, unsubscribed: false };
  if (audienceId) contactBody.segments = [{ id: audienceId }];

  let apiRes;
  try {
    apiRes = await fetchFn('https://api.resend.com/contacts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(contactBody),
    });
  } catch {
    return res.status(502).json({ error: 'Could not subscribe. Please try again later.' });
  }

  if (!apiRes.ok) {
    return res.status(502).json({ error: 'Could not subscribe. Please try again later.' });
  }
  return res.status(200).json({ ok: true });
}
