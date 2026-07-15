async function apiFetch(url, options) {
  const res = await fetch(url, options);
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
