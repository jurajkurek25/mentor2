const accountBar = document.getElementById('accountBar');
const paywall = document.getElementById('paywall');
const paywallMessage = document.getElementById('paywallMessage');
const plansEl = document.getElementById('plans');
const redeemCodeInput = document.getElementById('redeemCodeInput');
const redeemCodeBtn = document.getElementById('redeemCodeBtn');
const redeemStatus = document.getElementById('redeemStatus');

let currentUser = null;

async function loadAccount() {
  const meRes = await fetch('/api/auth/me');
  const me = await meRes.json();
  currentUser = me.user;

  if (!currentUser) {
    accountBar.innerHTML = `<span></span><a href="/login.html">Prihlásiť sa / Registrovať sa</a>`;
    return;
  }

  const statusRes = await fetch('/api/billing/status');
  const { subscription } = await statusRes.json();

  let quotaText = 'bez aktívneho predplatného';
  if (subscription && ['active', 'trialing'].includes(subscription.status)) {
    const remaining = Math.max(subscription.tokens_included - subscription.tokens_used, 0);
    quotaText = `${remaining.toLocaleString('sk-SK')} / ${subscription.tokens_included.toLocaleString('sk-SK')} tokenov`;
  }

  accountBar.innerHTML = `
    <span>${currentUser.email} · ${quotaText}</span>
    <span>
      <button class="link-btn" id="redeemLinkBtn">Mám kód</button> ·
      <button class="link-btn" id="manageBtn">Spravovať predplatné</button> ·
      <button class="link-btn" id="logoutBtn">Odhlásiť sa</button>
    </span>
  `;

  document.getElementById('redeemLinkBtn').addEventListener('click', () => {
    showPaywall({ error: 'Zadaj svoj zľavový alebo darčekový kód nižšie.', needsSubscription: true });
  });

  document.getElementById('manageBtn').addEventListener('click', async () => {
    const res = await fetch('/api/billing/portal', { method: 'POST' });
    const data = await res.json();
    if (res.ok) location.href = data.url;
    else showPaywall({ error: data.error, needsSubscription: true });
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.reload();
  });
}

async function showPaywall({ error, needsSubscription }) {
  if (!needsSubscription) return;
  paywall.style.display = 'block';
  paywallMessage.textContent = error || 'Na pokračovanie potrebuješ predplatné.';

  const res = await fetch('/api/billing/tiers');
  const tiers = await res.json();

  plansEl.innerHTML = tiers
    .map(
      (t) => `
      <div class="plan-card">
        <h3>${t.label}</h3>
        <div class="price">${t.priceEurMonthly.toFixed(2)} €/mesiac</div>
        <div class="tokens">${t.tokensIncluded.toLocaleString('sk-SK')} odpovedových tokenov</div>
        <button class="cta-btn subscribe-btn" data-tier="${t.id}" style="width:100%;">Predplatiť</button>
      </div>`
    )
    .join('');

  plansEl.querySelectorAll('.subscribe-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!currentUser) {
        location.href = '/login.html';
        return;
      }
      btn.disabled = true;
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tierId: btn.dataset.tier })
      });
      const data = await res.json();
      if (res.ok) location.href = data.url;
      else {
        btn.disabled = false;
        paywallMessage.textContent = data.error || 'Platbu sa nepodarilo spustiť.';
      }
    });
  });
}

redeemCodeBtn.addEventListener('click', async () => {
  const code = redeemCodeInput.value.trim();
  if (!code) {
    redeemStatus.textContent = 'Zadaj kód.';
    redeemStatus.className = 'redeem-note error';
    return;
  }
  if (!currentUser) {
    location.href = '/login.html';
    return;
  }

  redeemCodeBtn.disabled = true;
  redeemStatus.textContent = '';
  redeemStatus.className = 'redeem-note';

  try {
    const res = await fetch('/api/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Kód sa nepodarilo uplatniť.');

    redeemStatus.textContent = `Hotovo — členstvo (${data.plan}) je aktívne.`;
    redeemStatus.className = 'redeem-note success';
    redeemCodeInput.value = '';
    loadAccount();
    setTimeout(() => {
      paywall.style.display = 'none';
    }, 2000);
  } catch (err) {
    redeemStatus.textContent = err.message;
    redeemStatus.className = 'redeem-note error';
  } finally {
    redeemCodeBtn.disabled = false;
  }
});

redeemCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') redeemCodeBtn.click();
});

loadAccount();
