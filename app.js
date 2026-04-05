/* ─────────────────────────────────────────────
   QueueIO — app.js (Supabase edition)

   SETUP: Replace the two constants below with
   your Supabase project URL and anon key.
   Find them in: Supabase Dashboard → Project
   Settings → API → Project URL & anon/public key
   ───────────────────────────────────────────── */

require('dotenv').config();

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_ANON = process.env.SUPABASE_ANON;

/* ─── Init ─── */

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON);

// Stable session identity (persists across refreshes, not across devices — intentional)
let sessionId = sessionStorage.getItem('qio_session');
if (!sessionId) {
  sessionId = Math.random().toString(36).slice(2, 10);
  sessionStorage.setItem('qio_session', sessionId);
}

let currentRoom   = null;   // room code string
let isOwner       = false;
let localVotes    = {};     // { questionId: 'up'|'down' }
let realtimeSub   = null;   // Supabase realtime channel
let questions     = [];     // local cache of questions for this room

/* ─── Utilities ─── */

function randomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setLobbyError(msg) {
  document.getElementById('lobby-error').textContent = msg;
}

function setLobbyBusy(busy) {
  document.getElementById('generate-btn').disabled = busy;
  document.getElementById('join-btn').disabled = busy;
}

/* ─── Generate Room ─── */

async function generateRoom() {
  setLobbyBusy(true);
  setLobbyError('');

  let code;
  let attempts = 0;

  // Find a code that doesn't already exist
  while (attempts < 10) {
    code = randomCode();
    const { data } = await db.from('rooms').select('code').eq('code', code).maybeSingle();
    if (!data) break;
    attempts++;
  }

  const { error } = await db.from('rooms').insert({ code, owner_id: sessionId });

  if (error) {
    setLobbyError('Failed to create room. Try again.');
    setLobbyBusy(false);
    return;
  }

  setLobbyBusy(false);
  enterRoom(code, true);
}

/* ─── Join Room ─── */

async function joinRoom() {
  const input = document.getElementById('join-input');
  const code  = input.value.trim().toUpperCase();
  setLobbyError('');

  if (code.length !== 4) {
    setLobbyError('Code must be 4 characters.');
    return;
  }

  setLobbyBusy(true);

  const { data, error } = await db
    .from('rooms')
    .select('code, owner_id')
    .eq('code', code)
    .maybeSingle();

  if (error || !data) {
    setLobbyError('Room not found. Check the code and try again.');
    setLobbyBusy(false);
    return;
  }

  setLobbyBusy(false);
  const owner = data.owner_id === sessionId;
  enterRoom(code, owner);
}

/* ─── Enter Room ─── */

async function enterRoom(code, owner) {
  currentRoom = code;
  isOwner     = owner;
  localVotes  = {};
  questions   = [];

  document.getElementById('lobby').classList.add('hidden');
  document.getElementById('room').classList.remove('hidden');
  document.getElementById('room-code-display').textContent = code;

  const badge = document.getElementById('owner-badge');
  if (isOwner) badge.classList.remove('hidden');
  else         badge.classList.add('hidden');

  // Load existing questions
  await fetchQuestions();
  render();

  // Subscribe to live changes
  subscribeToRoom(code);
}

/* ─── Leave Room ─── */

function leaveRoom() {
  unsubscribe();
  currentRoom = null;
  isOwner     = false;
  localVotes  = {};
  questions   = [];

  document.getElementById('room').classList.add('hidden');
  document.getElementById('lobby').classList.remove('hidden');
  document.getElementById('join-input').value = '';
  document.getElementById('lobby-error').textContent = '';
  document.getElementById('input-area').classList.remove('open');
}

/* ─── Supabase: Fetch Questions ─── */

async function fetchQuestions() {
  const { data, error } = await db
    .from('questions')
    .select('*')
    .eq('room_code', currentRoom)
    .order('created_at', { ascending: true });

  if (!error && data) questions = data;
}

/* ─── Supabase: Realtime Subscription ─── */

function subscribeToRoom(code) {
  unsubscribe();

  realtimeSub = db
    .channel(`room-${code}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'questions', filter: `room_code=eq.${code}` },
      (payload) => {
        if (payload.eventType === 'INSERT') {
          // Add new question if not already present
          if (!questions.find(q => q.id === payload.new.id)) {
            questions.push(payload.new);
          }
        } else if (payload.eventType === 'UPDATE') {
          const idx = questions.findIndex(q => q.id === payload.new.id);
          if (idx !== -1) questions[idx] = payload.new;
        } else if (payload.eventType === 'DELETE') {
          questions = questions.filter(q => q.id !== payload.old.id);
        }
        render();
      }
    )
    .subscribe();
}

function unsubscribe() {
  if (realtimeSub) {
    db.removeChannel(realtimeSub);
    realtimeSub = null;
  }
}

/* ─── Ask / Submit ─── */

function toggleInput() {
  const area = document.getElementById('input-area');
  area.classList.toggle('open');
  if (area.classList.contains('open')) document.getElementById('q-input').focus();
}

async function submitQuestion() {
  const input = document.getElementById('q-input');
  const text  = input.value.trim();
  if (!text || !currentRoom) return;

  const submitBtn = document.getElementById('submit-btn');
  submitBtn.disabled = true;

  const { error } = await db.from('questions').insert({
    room_code: currentRoom,
    text,
    up: 0,
    down: 0
  });

  submitBtn.disabled = false;

  if (error) {
    alert('Failed to submit question. Please try again.');
    return;
  }

  input.value = '';
  document.getElementById('input-area').classList.remove('open');
  // Realtime will handle the render update
}

/* ─── Voting ─── */

async function vote(id, dir) {
  if (!currentRoom) return;

  const q    = questions.find(q => q.id === id);
  if (!q) return;

  const prev = localVotes[id] || null;
  let upDelta = 0, downDelta = 0;

  if (prev === dir) {
    // Toggle off
    if (dir === 'up')   upDelta   = -1;
    if (dir === 'down') downDelta = -1;
    localVotes[id] = null;
  } else {
    if (prev === 'up')   upDelta   = -1;
    if (prev === 'down') downDelta = -1;
    if (dir === 'up')   upDelta   += 1;
    if (dir === 'down') downDelta += 1;
    localVotes[id] = dir;
  }

  // Optimistic local update
  q.up   = Math.max(0, q.up   + upDelta);
  q.down = Math.max(0, q.down + downDelta);
  render();

  // Persist to Supabase
  const { error } = await db
    .from('questions')
    .update({ up: q.up, down: q.down })
    .eq('id', id);

  if (error) {
    // Rollback optimistic update on failure
    q.up   -= upDelta;
    q.down -= downDelta;
    localVotes[id] = prev;
    render();
  }
}

/* ─── Mark Answered (owner only) ─── */

async function markAnswered(id) {
  if (!isOwner || !currentRoom) return;

  // Optimistic removal
  const removed = questions.find(q => q.id === id);
  questions = questions.filter(q => q.id !== id);
  render();

  const { error } = await db.from('questions').delete().eq('id', id);

  if (error) {
    // Rollback
    if (removed) questions.push(removed);
    render();
    alert('Failed to remove question. Please try again.');
  }
}

/* ─── Render ─── */

function render() {
  if (!currentRoom) return;

  const sorted = [...questions].sort(
    (a, b) => (b.up - b.down) - (a.up - a.down)
  );

  const queueEl  = document.getElementById('queue');
  const emptyMsg = document.getElementById('empty-msg');

  if (sorted.length === 0) {
    queueEl.innerHTML = '';
    emptyMsg.classList.remove('hidden');
    return;
  }

  emptyMsg.classList.add('hidden');

  queueEl.innerHTML = sorted.map(q => {
    const net      = q.up - q.down;
    const voted    = localVotes[q.id] || null;
    const netLabel = net > 0 ? `+${net}` : `${net}`;

    const answeredBtn = isOwner
      ? `<button class="answered-btn" onclick="markAnswered(${q.id})">&#10003; answered</button>`
      : '';

    return `
      <div class="q-card">
        <div class="q-text">${escHtml(q.text)}</div>
        <div class="q-footer">
          <button class="vote-btn ${voted === 'up' ? 'active-up' : ''}" onclick="vote(${q.id}, 'up')">&#9650; ${q.up}</button>
          <button class="vote-btn ${voted === 'down' ? 'active-down' : ''}" onclick="vote(${q.id}, 'down')">&#9660; ${q.down}</button>
          <span class="net-score">${netLabel}</span>
          ${answeredBtn}
        </div>
      </div>
    `;
  }).join('');
}

/* ─── Keyboard Shortcuts ─── */

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('q-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitQuestion();
  });

  document.getElementById('join-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') joinRoom();
  });

  document.getElementById('join-input').addEventListener('input', e => {
    e.target.value = e.target.value.toUpperCase();
  });
});
