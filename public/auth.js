// The free hosting plan puts the app to sleep when it is idle. The first request
// after that can die while the server boots, which the browser reports as a bare
// "Failed to fetch". So on a network error we wait for the server to come up and
// retry once, telling the caller so it can explain the delay.
let onWaking = null;

function setWakingHandler(fn) {
  onWaking = fn;
}

async function wakeServer(maxWaitMs = 90000) {
  if (onWaking) onWaking(true);
  const deadline = Date.now() + maxWaitMs;
  try {
    while (Date.now() < deadline) {
      try {
        const res = await fetch('/api/session', { cache: 'no-store' });
        if (res.ok) return true;
      } catch (_) {
        // still booting
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    return false;
  } finally {
    if (onWaking) onWaking(false);
  }
}

async function apiFetch(url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (networkError) {
    const awake = await wakeServer();
    if (!awake) {
      throw new Error('Could not reach the server. Check your signal and try again.');
    }
    res = await fetch(url, options);
  }

  if (res.status === 401) {
    const redirect = encodeURIComponent(location.pathname.split('/').pop() + location.search);
    location.href = `login.html?redirect=${redirect}`;
    throw new Error('Not authenticated');
  }
  return res;
}

function wireLogoutButton() {
  const btn = document.getElementById('logoutBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    location.href = 'login.html';
  });
}

document.addEventListener('DOMContentLoaded', wireLogoutButton);
