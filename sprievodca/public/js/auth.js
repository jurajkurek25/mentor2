const tabLogin = document.getElementById('tabLogin');
const tabRegister = document.getElementById('tabRegister');
const authForm = document.getElementById('authForm');
const submitBtn = document.getElementById('submitBtn');
const formStatus = document.getElementById('formStatus');

let mode = 'login';

function setMode(next) {
  mode = next;
  tabLogin.classList.toggle('active', mode === 'login');
  tabRegister.classList.toggle('active', mode === 'register');
  submitBtn.textContent = mode === 'login' ? 'Prihlásiť sa' : 'Vytvoriť účet';
  formStatus.textContent = '';
  formStatus.className = 'status';
}

tabLogin.addEventListener('click', () => setMode('login'));
tabRegister.addEventListener('click', () => setMode('register'));

const params = new URLSearchParams(location.search);
if (params.get('error')) {
  formStatus.textContent = 'Prihlásenie cez Google zlyhalo, skús to prosím znova.';
  formStatus.className = 'status error';
}

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  submitBtn.disabled = true;
  formStatus.textContent = '';
  formStatus.className = 'status';

  try {
    const res = await fetch(`/api/auth/${mode === 'login' ? 'login' : 'register'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Neznáma chyba');

    location.href = '/';
  } catch (err) {
    formStatus.textContent = err.message;
    formStatus.className = 'status error';
  } finally {
    submitBtn.disabled = false;
  }
});
