function getSessionId() {
  let id = localStorage.getItem('sprievodca_session');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('sprievodca_session', id);
  }
  return id;
}

const sessionId = getSessionId();
const chatWindow = document.getElementById('chatWindow');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');

function clearEmptyState() {
  const empty = chatWindow.querySelector('.empty-state');
  if (empty) empty.remove();
}

function addMessage(role, text) {
  clearEmptyState();
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.textContent = text;
  chatWindow.appendChild(div);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  return div;
}

// Claude odpovedá s jednoduchým markdownom (**tučné**, # nadpisy, - odrážky, 1. zoznamy) —
// escapneme HTML (nech sa nič nedá vsunúť cez injekciu) a markdown premeníme na skutočné
// HTML značky, nech sa nezobrazujú doslovné **, # a - znaky bez formátovania.
function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Tučné zvýraznenie funguje aj naprieč riadkami v rámci toho istého odseku (viacriadkové **...**).
function inlineFormat(str) {
  return str.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
}

const BULLET_RE = /^[-*]\s+(.*)/;
const NUMBERED_RE = /^\d+[.)]\s+(.*)/;
const HEADING_RE = /^#{1,6}\s+(.*)/;

// Prechádza text riadok po riadku (nie po odsekoch) — vďaka tomu rozpozná zoznam aj vtedy, keď
// mu AI nepredradí prázdny riadok (bežné: "Skús toto:\n- bod 1\n- bod 2").
function formatAssistantText(raw) {
  const lines = escapeHtml(raw).replace(/\r\n/g, '\n').split('\n');

  const parts = [];
  let paragraphLines = [];
  let currentList = null; // { type: 'ul' | 'ol', items: [...] }

  const flushParagraph = () => {
    if (paragraphLines.length) {
      parts.push(`<p>${inlineFormat(paragraphLines.join('\n')).replace(/\n/g, '<br>')}</p>`);
      paragraphLines = [];
    }
  };
  const flushList = () => {
    if (currentList) {
      const items = currentList.items.map((i) => `<li>${inlineFormat(i)}</li>`).join('');
      parts.push(`<${currentList.type}>${items}</${currentList.type}>`);
      currentList = null;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const bullet = line.match(BULLET_RE);
    const numbered = line.match(NUMBERED_RE);
    if (bullet || numbered) {
      flushParagraph();
      const type = bullet ? 'ul' : 'ol';
      if (!currentList || currentList.type !== type) {
        flushList();
        currentList = { type, items: [] };
      }
      currentList.items.push(bullet ? bullet[1] : numbered[1]);
      continue;
    }

    flushList();
    const heading = line.match(HEADING_RE);
    if (heading) {
      flushParagraph();
      parts.push(`<p><strong>${inlineFormat(heading[1])}</strong></p>`);
      continue;
    }

    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();

  return parts.join('') || inlineFormat(escapeHtml(raw));
}

async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text) return;

  messageInput.value = '';
  sendBtn.disabled = true;
  addMessage('user', text);
  const pending = addMessage('assistant pending', 'Sprievodca premýšľa…');

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message: text })
    });
    const data = await res.json();

    if (res.status === 402) {
      pending.remove();
      if (typeof showPaywall === 'function') showPaywall(data);
      return;
    }
    if (!res.ok) throw new Error(data.error || 'Neznáma chyba');

    pending.innerHTML = formatAssistantText(data.answer);
    pending.classList.remove('pending');
    if (typeof loadAccount === 'function') loadAccount();
  } catch (err) {
    pending.textContent = 'Prepáč, nastala chyba. Skús to prosím znova.';
    pending.classList.remove('pending');
    console.error(err);
  } finally {
    sendBtn.disabled = false;
    messageInput.focus();
  }
}

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
