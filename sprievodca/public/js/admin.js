let adminPassword = sessionStorage.getItem('sprievodca_admin_pw') || '';

const loginBox = document.getElementById('loginBox');
const adminPanel = document.getElementById('adminPanel');
const passwordInput = document.getElementById('passwordInput');
const loginBtn = document.getElementById('loginBtn');
const loginStatus = document.getElementById('loginStatus');

const titleInput = document.getElementById('titleInput');
const fileInput = document.getElementById('fileInput');
const uploadBtn = document.getElementById('uploadBtn');
const uploadStatus = document.getElementById('uploadStatus');
const docList = document.getElementById('docList');

const codeInput = document.getElementById('codeInput');
const codePlanInput = document.getElementById('codePlanInput');
const codeDurationInput = document.getElementById('codeDurationInput');
const codeDurationUnitInput = document.getElementById('codeDurationUnitInput');
const codeMaxUsesInput = document.getElementById('codeMaxUsesInput');
const codeExpiresInput = document.getElementById('codeExpiresInput');
const codeNoteInput = document.getElementById('codeNoteInput');
const createCodeBtn = document.getElementById('createCodeBtn');
const codeStatus = document.getElementById('codeStatus');
const codeList = document.getElementById('codeList');

function authHeaders() {
  return { 'X-Admin-Password': adminPassword };
}

async function loadTiersIntoSelect() {
  const res = await fetch('/api/billing/tiers');
  const tiers = await res.json();
  codePlanInput.innerHTML = tiers.map((t) => `<option value="${t.id}">${t.label}</option>`).join('');
}

async function tryEnterPanel() {
  const res = await fetch('/api/admin/documents', { headers: authHeaders() });
  if (res.ok) {
    loginBox.style.display = 'none';
    adminPanel.style.display = 'block';
    sessionStorage.setItem('sprievodca_admin_pw', adminPassword);
    loadDocuments();
    loadTiersIntoSelect();
    loadCodes();
    return true;
  }
  return false;
}

loginBtn.addEventListener('click', async () => {
  adminPassword = passwordInput.value;
  const ok = await tryEnterPanel();
  if (!ok) loginStatus.textContent = 'Nesprávne heslo.';
});
passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') loginBtn.click(); });

async function loadDocuments() {
  const res = await fetch('/api/admin/documents', { headers: authHeaders() });
  const docs = await res.json();

  docList.innerHTML = '';
  if (!docs.length) {
    docList.innerHTML = '<li class="doc-meta">Zatiaľ žiadne dokumenty.</li>';
    return;
  }

  for (const doc of docs) {
    const li = document.createElement('li');
    const chunkCount = doc.chunks?.[0]?.count ?? 0;
    li.innerHTML = `
      <div>
        <div class="doc-title">${doc.title}</div>
        <div class="doc-meta">${chunkCount} úryvkov · ${new Date(doc.created_at).toLocaleDateString('sk-SK')}</div>
      </div>
      <button class="del-btn" data-id="${doc.id}">Odstrániť</button>
    `;
    docList.appendChild(li);
  }

  docList.querySelectorAll('.del-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Naozaj odstrániť tento dokument aj so všetkými jeho úryvkami?')) return;
      await fetch(`/api/admin/documents/${btn.dataset.id}`, { method: 'DELETE', headers: authHeaders() });
      loadDocuments();
    });
  });
}

uploadBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) {
    uploadStatus.textContent = 'Vyber súbor.';
    uploadStatus.className = 'status error';
    return;
  }

  const formData = new FormData();
  formData.append('file', file);
  if (titleInput.value.trim()) formData.append('title', titleInput.value.trim());

  uploadBtn.disabled = true;
  uploadStatus.textContent = 'Spracúvam a vytváram embeddings, môže to chvíľu trvať…';
  uploadStatus.className = 'status';

  try {
    const res = await fetch('/api/admin/documents', {
      method: 'POST',
      headers: authHeaders(),
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Neznáma chyba');

    uploadStatus.textContent = `Hotovo — nahraných ${data.chunks} úryvkov.`;
    uploadStatus.className = 'status success';
    titleInput.value = '';
    fileInput.value = '';
    loadDocuments();
  } catch (err) {
    uploadStatus.textContent = `Chyba: ${err.message}`;
    uploadStatus.className = 'status error';
  } finally {
    uploadBtn.disabled = false;
  }
});

async function loadCodes() {
  const res = await fetch('/api/admin/codes', { headers: authHeaders() });
  const codes = await res.json();

  codeList.innerHTML = '';
  if (!codes.length) {
    codeList.innerHTML = '<li class="doc-meta">Zatiaľ žiadne kódy.</li>';
    return;
  }

  for (const c of codes) {
    const li = document.createElement('li');
    const expires = c.expires_at ? `, platí do ${new Date(c.expires_at).toLocaleDateString('sk-SK')}` : '';
    const note = c.note ? ` · ${c.note}` : '';
    li.innerHTML = `
      <div>
        <div class="code-value">${c.code}</div>
        <div class="doc-meta">${c.plan} · ${c.duration_days} dní · použité ${c.redemption_count}/${c.max_redemptions}${expires}${note}</div>
      </div>
      <button class="del-btn" data-id="${c.id}">Zrušiť</button>
    `;
    codeList.appendChild(li);
  }

  codeList.querySelectorAll('.del-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Zrušiť tento kód? Už priradené členstvá zostanú platné, len sa kód nebude dať ďalej uplatniť.')) return;
      await fetch(`/api/admin/codes/${btn.dataset.id}`, { method: 'DELETE', headers: authHeaders() });
      loadCodes();
    });
  });
}

createCodeBtn.addEventListener('click', async () => {
  const durationValue = Number(codeDurationInput.value);
  if (!durationValue || durationValue <= 0) {
    codeStatus.textContent = 'Zadaj kladné trvanie.';
    codeStatus.className = 'status error';
    return;
  }
  const durationDays = codeDurationUnitInput.value === 'months' ? durationValue * 30 : durationValue;

  createCodeBtn.disabled = true;
  codeStatus.textContent = '';
  codeStatus.className = 'status';

  try {
    const res = await fetch('/api/admin/codes', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: codeInput.value.trim(),
        plan: codePlanInput.value,
        durationDays,
        maxRedemptions: Number(codeMaxUsesInput.value) || 1,
        note: codeNoteInput.value.trim(),
        expiresAt: codeExpiresInput.value || null
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Neznáma chyba');

    codeStatus.textContent = `Hotovo — kód ${data.code} je pripravený na uplatnenie.`;
    codeStatus.className = 'status success';
    codeInput.value = '';
    codeNoteInput.value = '';
    codeExpiresInput.value = '';
    loadCodes();
  } catch (err) {
    codeStatus.textContent = `Chyba: ${err.message}`;
    codeStatus.className = 'status error';
  } finally {
    createCodeBtn.disabled = false;
  }
});

// Auto-login ak už máme heslo uložené v tejto session
if (adminPassword) tryEnterPanel();
