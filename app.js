let questions = [];
let nextId = 1;

function toggleInput() {
  const area = document.getElementById('input-area');
  area.classList.toggle('open');
  if (area.classList.contains('open')) {
    document.getElementById('q-input').focus();
  }
}

function submitQuestion() {
  const input = document.getElementById('q-input');
  const text = input.value.trim();
  if (!text) return;
  questions.push({ id: nextId++, text, up: 0, down: 0, voted: null });
  input.value = '';
  document.getElementById('input-area').classList.remove('open');
  render();
}

function vote(id, dir) {
  const q = questions.find(q => q.id === id);
  if (!q) return;
  if (q.voted === dir) {
    q[dir === 'up' ? 'up' : 'down']--;
    q.voted = null;
  } else {
    if (q.voted) q[q.voted === 'up' ? 'up' : 'down']--;
    q[dir === 'up' ? 'up' : 'down']++;
    q.voted = dir;
  }
  render();
}

function markAnswered(id) {
  questions = questions.filter(q => q.id !== id);
  render();
}

function escHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function render() {
  const sorted = [...questions].sort((a, b) => (b.up - b.down) - (a.up - a.down));
  const queueEl = document.getElementById('queue');
  queueEl.innerHTML = sorted.map(q => {
    const net = q.up - q.down;
    return `
      <div class="q-card">
        <div class="q-text">${escHtml(q.text)}</div>
        <div class="q-footer">
          <button class="vote-btn ${q.voted === 'up' ? 'active-up' : ''}" onclick="vote(${q.id}, 'up')">&#9650; ${q.up}</button>
          <button class="vote-btn ${q.voted === 'down' ? 'active-down' : ''}" onclick="vote(${q.id}, 'down')">&#9660; ${q.down}</button>
          <span class="net-score">${net > 0 ? '+' : ''}${net}</span>
          <button class="answered-btn" onclick="markAnswered(${q.id})">&#10003; answered</button>
        </div>
      </div>
    `;
  }).join('');
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('q-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitQuestion();
  });
});
