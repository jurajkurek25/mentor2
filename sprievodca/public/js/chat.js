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

    if (!res.ok) throw new Error(data.error || 'Neznáma chyba');

    pending.textContent = data.answer;
    pending.classList.remove('pending');
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
