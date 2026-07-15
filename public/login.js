const loginForm = document.getElementById('loginForm');
const loginBtn = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');

const params = new URLSearchParams(location.search);
const redirectTo = params.get('redirect') || 'index.html';

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.classList.add('hidden');
  loginBtn.disabled = true;
  loginBtn.textContent = 'Logging in...';

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: document.getElementById('password').value })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Login failed');
    }
    location.href = redirectTo;
  } catch (err) {
    loginError.textContent = err.message;
    loginError.classList.remove('hidden');
    loginBtn.disabled = false;
    loginBtn.textContent = 'Log in';
  }
});
