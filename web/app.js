document.getElementById('signup').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('email');
  const btn = document.getElementById('submitBtn');
  const msg = document.getElementById('formMsg');
  const email = input.value.trim();

  msg.className = 'msg';
  msg.textContent = '';

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    msg.classList.add('error');
    msg.textContent = 'Please enter a valid email address.';
    input.focus();
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Subscribing…';

  try {
    const res = await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Something went wrong.');
    }
    msg.classList.add('ok');
    msg.textContent = "You're in! Check your inbox tomorrow at 6 PM.";
    input.value = '';
  } catch (err) {
    msg.classList.add('error');
    msg.textContent = err.message || 'Could not subscribe. Please try again.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Subscribe';
  }
});
