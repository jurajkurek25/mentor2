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

function authHeaders() {
  return { 'X-Admin-Password': adminPassword };
}

async function tryEnterPanel() {
  const res = await fetch('/api/admin/documents', { headers: authHeaders() });
  if (res.ok) {
    loginBox.style.display = 'none';
    adminPanel.style.display = 'block';
    sessionStorage.setItem('sprievodca_admin_pw', adminPassword);
    loadDocuments();
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

// Auto-login ak už máme heslo uložené v tejto session
if (adminPassword) tryEnterPanel();
