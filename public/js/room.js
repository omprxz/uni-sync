/* DropRoom — room.js  |  Client-side room logic */

// ─── State ───────────────────────────────────────────────────────────────────
const S = {
  items: [],
  filter: 'all',
  search: '',
  sort: 'newest',
  viewMode: 'comfortable',
  ownerToken: null,
  isOwner: false,
  isReadOnly: false,
  editingId: null,
  typingTimeout: null,
  countdown: null,
  activityOpen: false,
  stars: new Set(JSON.parse(localStorage.getItem('droproom-stars') || '[]')),
};

const CODE = window.ROOM_CODE;
const ROOM = window.ROOM_DATA;
let socket;

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Resolve owner token
  const urlToken = new URLSearchParams(location.search).get('ownerToken');
  if (urlToken) {
    localStorage.setItem(`droproom-owner-${CODE}`, urlToken);
    S.ownerToken = urlToken;
    history.replaceState({}, '', `/rooms/${CODE}`);
  } else {
    const saved = localStorage.getItem(`droproom-owner-${CODE}`);
    if (saved === ROOM.ownerToken) S.ownerToken = saved;
  }
  S.isOwner = !!S.ownerToken;
  S.isReadOnly = ROOM.readOnly;

  // Load initial items
  S.items = window.INITIAL_ITEMS;
  hideSkeleton();
  renderItems();

  // Connect socket
  socket = io();
  socket.emit('join-room', { roomCode: CODE });
  setupSocketListeners();

  // UI
  updateOwnerUI();
  updateReadOnlyUI();
  setupCountdown();
  setupKeyboardShortcuts();
  setupGlobalPaste();
  setupTypingDetector();
});

// ─── Socket ───────────────────────────────────────────────────────────────────
function setupSocketListeners() {
  socket.on('user-count', n => { document.getElementById('user-count').textContent = n; });

  socket.on('item-added', item => {
    if (S.items.find(i => i._id === item._id)) return;
    S.items.unshift(item);
    renderItems();
    // Animate newest card
    setTimeout(() => {
      const el = document.querySelector(`[data-id="${item._id}"]`);
      if (el) el.classList.add('card-enter');
    }, 10);
  });

  socket.on('item-edited', updated => {
    const idx = S.items.findIndex(i => i._id === updated._id);
    if (idx !== -1) { S.items[idx] = updated; renderItems(); }
  });

  socket.on('item-deleted', ({ id }) => {
    S.items = S.items.filter(i => i._id !== id);
    renderItems();
  });

  socket.on('item-restored', item => {
    if (!S.items.find(i => i._id === item._id)) {
      S.items.unshift(item);
      renderItems();
    }
  });

  socket.on('item-pinned', ({ id, pinned }) => {
    const item = S.items.find(i => i._id === id);
    if (item) { item.pinned = pinned; renderItems(); }
  });

  socket.on('room-readonly', ({ readOnly }) => {
    S.isReadOnly = readOnly;
    ROOM.readOnly = readOnly;
    updateReadOnlyUI();
    showToast(readOnly ? 'Room locked — read-only mode' : 'Room unlocked', readOnly ? 'warning' : 'success');
  });

  socket.on('user-typing', ({ socketId, isTyping }) => {
    const el = document.getElementById('typing-indicator');
    if (isTyping) { el.classList.remove('hidden'); }
    else { el.classList.add('hidden'); }
  });

  socket.on('activity', act => addActivityEntry(act));

  socket.on('activity-history', acts => {
    acts.forEach(a => addActivityEntry(a, true));
  });
}

// ─── Render ───────────────────────────────────────────────────────────────────
function getFilteredItems() {
  let items = [...S.items];

  // Sort
  if (S.sort === 'oldest') items.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  else items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // Pinned always first
  items.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

  // Filter
  if (S.filter !== 'all') items = items.filter(i => i.type === S.filter);

  // Search
  if (S.search.trim()) {
    const q = S.search.toLowerCase();
    items = items.filter(i =>
      i.content.toLowerCase().includes(q) ||
      (i.label && i.label.toLowerCase().includes(q)) ||
      (i.ogData?.title && i.ogData.title.toLowerCase().includes(q))
    );
  }

  return items;
}

function renderItems() {
  const container = document.getElementById('items-container');
  const empty = document.getElementById('empty-state');
  const countEl = document.getElementById('item-count');

  const filtered = getFilteredItems();
  countEl.textContent = S.items.length;

  if (filtered.length === 0) {
    container.innerHTML = '';
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
    container.innerHTML = filtered.map(item => itemCardHTML(item)).join('');
    // Syntax highlighting
    container.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));
    // Markdown rendering
    container.querySelectorAll('[data-markdown]').forEach(el => {
      el.innerHTML = DOMPurify.sanitize(marked.parse(el.dataset.markdown));
    });
  }
}

function itemCardHTML(item) {
  const isStarred = S.stars.has(item._id);
  const compact = S.viewMode === 'compact';

  const typeConfig = {
    text: { color: 'violet', label: '✦ Text', border: 'type-text' },
    link: { color: 'blue', label: '↗ Link', border: 'type-link' },
    code: { color: 'emerald', label: '</> Code', border: 'type-code' },
    markdown: { color: 'amber', label: '# Markdown', border: 'type-markdown' },
  };
  const tc = typeConfig[item.type] || typeConfig.text;

  const timeAgo = formatTimeAgo(item.createdAt);
  const content = escHtml(item.content);

  let contentHTML = '';
  if (item.type === 'link') {
    contentHTML = linkContentHTML(item, compact);
  } else if (item.type === 'code') {
    contentHTML = `
      <div class="relative group/code">
        <pre class="overflow-x-auto max-h-48 text-xs rounded-xl"><code class="${item.language ? 'language-' + item.language : ''}">${content}</code></pre>
        ${item.language ? `<span class="absolute top-2 right-2 text-xs bg-black/50 text-emerald-400 px-2 py-0.5 rounded font-mono opacity-0 group-hover/code:opacity-100 transition-opacity">${item.language}</span>` : ''}
      </div>`;
  } else if (item.type === 'markdown') {
    if (compact) {
      contentHTML = `<p class="text-slate-400 text-xs line-clamp-2">${content}</p>`;
    } else {
      contentHTML = `<div class="markdown-body text-sm max-h-48 overflow-hidden" data-markdown="${escAttr(item.content)}"></div>`;
    }
  } else {
    const preview = compact ? item.content.slice(0, 120) : item.content.slice(0, 600);
    const truncated = preview.length < item.content.length;
    contentHTML = `<p class="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap break-words">${escHtml(preview)}${truncated ? '...' : ''}</p>`;
  }

  const pinIcon = item.pinned
    ? `<span class="text-amber-400 text-xs" title="Pinned">📌</span>`
    : '';
  const starBtn = `<button onclick="toggleStar('${item._id}')" title="${isStarred ? 'Unstar' : 'Star'}"
    class="icon-btn ${isStarred ? 'text-amber-400' : 'text-slate-600 hover:text-amber-400'}">★</button>`;

  const pinBtn = S.isOwner ? `<button onclick="togglePin('${item._id}')" title="${item.pinned ? 'Unpin' : 'Pin'}"
    class="icon-btn ${item.pinned ? 'text-amber-400' : 'text-slate-600 hover:text-amber-400'}">📌</button>` : '';

  const openBtn = item.type === 'link'
    ? `<button onclick="window.open('${escHtml(item.content)}','_blank')" title="Open link" class="icon-btn text-slate-600 hover:text-blue-400">↗</button>` : '';

  return `
  <div class="item-card bg-surface border border-border rounded-2xl overflow-hidden transition-all hover:border-border-light hover:shadow-lg hover:shadow-black/20 ${tc.border} ${compact ? 'p-3' : 'p-5'} card-enter" data-id="${item._id}">
    <!-- Header row -->
    <div class="flex items-center gap-2 mb-${compact ? '2' : '3'}">
      <span class="text-xs font-bold px-2.5 py-1 rounded-full border bg-${tc.color}-500/10 text-${tc.color}-400 border-${tc.color}-500/20">${tc.label}</span>
      ${pinIcon}
      ${isStarred ? '<span class="text-amber-400 text-xs">★</span>' : ''}
      ${item.label ? `<span class="text-white font-medium text-sm truncate flex-1">${escHtml(item.label)}</span>` : '<span class="flex-1"></span>'}
      <span class="text-xs text-slate-600 shrink-0">${timeAgo}</span>
    </div>

    <!-- Content -->
    <div class="mb-${compact ? '2' : '4'}">
      ${contentHTML}
    </div>

    <!-- Action bar -->
    <div class="flex items-center gap-1 pt-${compact ? '1' : '2'} border-t border-border/50 flex-wrap">
      <button onclick="copyItem('${item._id}')" title="Copy" class="icon-btn text-slate-500 hover:text-white">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
      </button>
      ${openBtn}
      ${!S.isReadOnly ? `<button onclick="openEdit('${item._id}')" title="Edit" class="icon-btn text-slate-500 hover:text-white">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
      </button>
      <button onclick="deleteItem('${item._id}')" title="Delete" class="icon-btn text-slate-500 hover:text-red-400">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
      </button>` : ''}
      ${pinBtn}
      ${starBtn}
      <button onclick="shareItem('${item._id}')" title="Share" class="icon-btn text-slate-500 hover:text-violet-400">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/></svg>
      </button>
      <button onclick="showQR(location.origin+'/rooms/${CODE}/item/${escHtml(item._id)}')" title="QR Code" class="icon-btn text-slate-500 hover:text-violet-400 text-xs">📱</button>
    </div>
  </div>`;
}

function linkContentHTML(item, compact) {
  const og = item.ogData;
  if (!og || (!og.title && !og.description)) {
    return `<a href="${escHtml(item.content)}" target="_blank" rel="noopener noreferrer"
      class="text-blue-400 hover:text-blue-300 underline break-all text-sm">${escHtml(item.content)}</a>`;
  }
  return `
    <a href="${escHtml(item.content)}" target="_blank" rel="noopener noreferrer"
      class="block border border-border rounded-xl overflow-hidden hover:border-blue-500/40 transition-all group/link">
      ${og.image && !compact ? `<img src="${escHtml(og.image)}" alt="" class="w-full h-28 object-cover" onerror="this.style.display='none'" />` : ''}
      <div class="p-3">
        <div class="flex items-center gap-2 mb-1">
          <img src="${escHtml(og.favicon || '')}" class="w-4 h-4 rounded shrink-0" onerror="this.style.display='none'" />
          <span class="text-xs text-slate-500 truncate">${escHtml(og.siteName || '')}</span>
        </div>
        ${og.title ? `<p class="text-white text-sm font-medium line-clamp-1 group-hover/link:text-blue-400 transition-colors">${escHtml(og.title)}</p>` : ''}
        ${og.description && !compact ? `<p class="text-slate-400 text-xs line-clamp-2 mt-0.5">${escHtml(og.description)}</p>` : ''}
      </div>
    </a>`;
}

// ─── Input ────────────────────────────────────────────────────────────────────
let inputDebounce;
function onContentInput(val) {
  // Char count
  document.getElementById('char-count').textContent = `${val.length.toLocaleString()} / 10,000`;
  const charEl = document.getElementById('char-count');
  charEl.classList.toggle('text-red-400', val.length > 9000);
  charEl.classList.toggle('text-slate-600', val.length <= 9000);

  // Auto-detect type
  clearTimeout(inputDebounce);
  inputDebounce = setTimeout(() => updateTypeBadge(val), 300);

  // Typing indicator
  if (socket) {
    socket.emit('typing', { roomCode: CODE, isTyping: val.length > 0 });
    clearTimeout(S.typingTimeout);
    S.typingTimeout = setTimeout(() => socket.emit('typing', { roomCode: CODE, isTyping: false }), 2000);
  }
}

function onContentKeydown(e) {
  // Ctrl+Enter to submit
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); submitItem(); }
}

function updateTypeBadge(content) {
  const badge = document.getElementById('detected-type-badge');
  const type = detectType(content.trim());
  const cfg = {
    text: { label: '✦ Text', cls: 'bg-violet-500/15 text-violet-400 border-violet-500/20' },
    link: { label: '↗ Link', cls: 'bg-blue-500/15 text-blue-400 border-blue-500/20' },
    code: { label: '</> Code', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' },
    markdown: { label: '# Markdown', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/20' },
  };
  const c = cfg[type] || cfg.text;
  badge.textContent = c.label;
  badge.className = `text-xs font-bold px-2.5 py-1 rounded-full border transition-all ${c.cls}`;
}

function detectType(content) {
  if (!content) return 'text';
  if (/^https?:\/\/[^\s]+$/.test(content)) return 'link';
  if (isCode(content)) return 'code';
  if (isMarkdown(content)) return 'markdown';
  return 'text';
}

function isCode(s) {
  const patterns = [
    /^(function |const |let |var |class |import |export |if\s*\(|for\s*\(|return )/m,
    /^(def |from |import |print\()/m,
    /^(public |private |static |void |int |string )/m,
    /^\s*\{[\s\S]*\}/, /```/
  ];
  return patterns.filter(p => p.test(s)).length >= 2;
}

function isMarkdown(s) {
  const patterns = [/^#{1,6} /m, /\*\*.+\*\*/, /^\- /m, /^\d+\. /m, /\[.+\]\(.+\)/, /^> /m, /```/];
  return patterns.filter(p => p.test(s)).length >= 2;
}

async function submitItem() {
  if (S.isReadOnly) { showToast('Room is read-only', 'warning'); return; }
  const content = document.getElementById('new-content').value.trim();
  if (!content) { showToast('Enter some content first', 'warning'); return; }
  if (content.length > 10000) { showToast('Content exceeds 10,000 characters', 'error'); return; }

  const label = document.getElementById('new-label').value.trim();
  const btn = document.getElementById('submit-btn');
  btn.disabled = true; btn.textContent = 'Adding...';

  try {
    const res = await fetch(`/api/rooms/${CODE}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, label })
    });
    const item = await res.json();
    if (!res.ok) throw new Error(item.error || 'Failed');

    document.getElementById('new-content').value = '';
    document.getElementById('new-label').value = '';
    document.getElementById('char-count').textContent = '0 / 10,000';
    updateTypeBadge('');
    socket.emit('typing', { roomCode: CODE, isTyping: false });
    showToast('Item added!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = '+ Add';
  }
}

// ─── Filter / Search / Sort / View ───────────────────────────────────────────
function setFilter(f) {
  S.filter = f;
  document.querySelectorAll('.filter-pill').forEach(btn => {
    const active = btn.dataset.filter === f;
    btn.className = btn.className.replace(/pill-active|pill-inactive/g, '').trim() + ' ' + (active ? 'pill-active' : 'pill-inactive');
  });
  renderItems();
}

function setSearch(q) { S.search = q; renderItems(); }
function setSort(s) { S.sort = s; renderItems(); }

function setViewMode(mode) {
  S.viewMode = mode;
  document.getElementById('view-comfortable').className = document.getElementById('view-comfortable').className.replace(/pill-active|pill-inactive/, mode === 'comfortable' ? 'pill-active' : 'pill-inactive');
  document.getElementById('view-compact').className = document.getElementById('view-compact').className.replace(/pill-active|pill-inactive/, mode === 'compact' ? 'pill-active' : 'pill-inactive');
  renderItems();
}

// ─── Item Actions ─────────────────────────────────────────────────────────────
async function copyItem(id) {
  const item = S.items.find(i => i._id === id);
  if (!item) return;
  try {
    await navigator.clipboard.writeText(item.content);
    showToast('Copied!', 'success', 1500);
    const card = document.querySelector(`[data-id="${id}"]`);
    if (card) {
      card.style.borderColor = '#10b981';
      setTimeout(() => card.style.borderColor = '', 800);
    }
  } catch { showToast('Copy failed', 'error'); }
}

async function deleteItem(id) {
  const item = S.items.find(i => i._id === id);
  if (!item) return;

  S.items = S.items.filter(i => i._id !== id);
  renderItems();

  let undone = false;
  showToast(
    `Deleted${item.label ? ': ' + item.label : ''}`,
    'warning',
    5000
  );

  // Show undo toast separately
  const undoEl = document.createElement('div');
  undoEl.className = 'pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl text-white text-sm font-medium shadow-2xl bg-slate-800 border border-border animate-slide-up';
  undoEl.innerHTML = `<span>🗑 Item deleted</span><button class="ml-2 text-violet-400 hover:text-violet-300 font-semibold underline text-xs" onclick="undoDelete('${id}')">Undo</button>`;
  document.getElementById('toast-container').appendChild(undoEl);
  setTimeout(() => { undoEl.style.opacity='0'; undoEl.style.transition='all 0.3s'; setTimeout(()=>undoEl.remove(),300); }, 5000);

  try {
    await fetch(`/api/items/${id}`, { method: 'DELETE' });
  } catch { showToast('Delete failed', 'error'); }
}

async function undoDelete(id) {
  try {
    const res = await fetch(`/api/items/${id}/restore`, { method: 'POST' });
    if (!res.ok) { showToast('Undo window expired', 'error'); return; }
    const item = await res.json();
    if (!S.items.find(i => i._id === id)) {
      S.items.unshift(item);
      renderItems();
    }
    showToast('Item restored!', 'success');
  } catch { showToast('Failed to restore', 'error'); }
}

function openEdit(id) {
  const item = S.items.find(i => i._id === id);
  if (!item) return;
  S.editingId = id;
  document.getElementById('edit-label').value = item.label || '';
  document.getElementById('edit-content').value = item.content;
  document.getElementById('edit-modal').classList.remove('hidden');
  document.getElementById('edit-content').focus();
}

function closeEditModal() {
  document.getElementById('edit-modal').classList.add('hidden');
  S.editingId = null;
}

async function saveEdit() {
  if (!S.editingId) return;
  const content = document.getElementById('edit-content').value.trim();
  const label = document.getElementById('edit-label').value.trim();
  if (!content) { showToast('Content cannot be empty', 'warning'); return; }
  try {
    const res = await fetch(`/api/items/${S.editingId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, label })
    });
    if (!res.ok) throw new Error((await res.json()).error);
    closeEditModal();
    showToast('Saved!', 'success');
  } catch (err) { showToast(err.message, 'error'); }
}

async function togglePin(id) {
  if (!S.isOwner) { showToast('Only the room owner can pin items', 'warning'); return; }
  try {
    await fetch(`/api/items/${id}/pin`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerToken: S.ownerToken })
    });
  } catch { showToast('Failed to pin', 'error'); }
}

function toggleStar(id) {
  if (S.stars.has(id)) S.stars.delete(id);
  else S.stars.add(id);
  localStorage.setItem('droproom-stars', JSON.stringify([...S.stars]));
  renderItems();
}

function shareItem(id) {
  const url = `${location.origin}/rooms/${CODE}/item/${id}`;
  navigator.clipboard.writeText(url).then(() => showToast('Share link copied!', 'success'));
}

// ─── Room Controls ────────────────────────────────────────────────────────────
function copyRoomCode() {
  navigator.clipboard.writeText(CODE).then(() => showToast(`Room code ${CODE} copied!`, 'success', 1500));
}

async function toggleReadOnly() {
  if (!S.isOwner) return;
  try {
    const res = await fetch(`/api/rooms/${CODE}/readonly`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerToken: S.ownerToken })
    });
    const { readOnly } = await res.json();
    S.isReadOnly = readOnly;
    updateReadOnlyUI();
  } catch { showToast('Failed', 'error'); }
}

function updateOwnerUI() {
  const btn = document.getElementById('readonly-btn');
  if (S.isOwner) btn.classList.remove('hidden'), btn.classList.add('flex');
}

function updateReadOnlyUI() {
  const btn = document.getElementById('readonly-btn');
  const banner = document.getElementById('readonly-banner');
  const inputArea = document.getElementById('input-area');

  if (S.isReadOnly) {
    btn.className = btn.className.replace(/bg-\S+/, '').replace(/text-\S+/, '').replace(/border-\S+/, '');
    btn.classList.add('bg-amber-500/10', 'text-amber-400', 'border-amber-500/30');
    document.getElementById('readonly-label').textContent = 'Unlock';
    banner.classList.remove('hidden');
    if (!S.isOwner) inputArea.style.display = 'none';
  } else {
    btn.className = btn.className.replace(/bg-amber-500\/10/, '').replace(/text-amber-400/, '').replace(/border-amber-500\/30/, '');
    btn.classList.add('bg-surface', 'text-slate-400', 'border-border');
    document.getElementById('readonly-label').textContent = 'Lock';
    banner.classList.add('hidden');
    inputArea.style.display = '';
  }
}

// ─── Countdown ────────────────────────────────────────────────────────────────
function setupCountdown() {
  if (!ROOM.expiresAt) return;
  const expiresAt = new Date(ROOM.expiresAt);
  const display = document.getElementById('ttl-display');
  const timer = document.getElementById('ttl-timer');
  display.classList.remove('hidden');
  display.classList.add('flex');

  function tick() {
    const diff = expiresAt - Date.now();
    if (diff <= 0) { timer.textContent = 'Expired'; clearInterval(S.countdown); return; }
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    timer.textContent = h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
  }
  tick();
  S.countdown = setInterval(tick, 1000);
}

// ─── Activity Feed ────────────────────────────────────────────────────────────
let activityOpen = false;
function toggleActivity() {
  activityOpen = !activityOpen;
  const bar = document.getElementById('activity-bar');
  const label = document.getElementById('activity-toggle-label');
  bar.style.maxHeight = activityOpen ? '200px' : '0';
  label.textContent = activityOpen ? '▲ Hide activity' : '▼ Show activity';
}

function addActivityEntry(act, prepend = false) {
  const list = document.getElementById('activity-list');
  const timeAgo = formatTimeAgo(act.timestamp || act.createdAt);
  const icons = { added: '✦', edited: '✎', deleted: '✕', pinned: '📌', restored: '↩' };
  const el = document.createElement('div');
  el.className = 'text-xs text-slate-600 flex items-center gap-2';
  el.innerHTML = `<span class="text-slate-700">${icons[act.action] || '·'}</span> Someone ${act.action} a <span class="text-slate-500">${act.itemType}</span>${act.label ? ': <span class="text-slate-500">' + escHtml(act.label) + '</span>' : ''} <span class="ml-auto">${timeAgo}</span>`;
  if (prepend) list.prepend(el); else list.appendChild(el);
  // Keep last 10
  while (list.children.length > 10) list.lastChild.remove();
}

// ─── Keyboard Shortcuts ───────────────────────────────────────────────────────
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    // N — focus input
    if (e.key === 'n' && !e.ctrlKey && !e.metaKey && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      e.preventDefault();
      document.getElementById('new-content')?.focus();
    }
    // Escape — close modals
    if (e.key === 'Escape') {
      document.getElementById('edit-modal').classList.add('hidden');
      document.getElementById('qr-modal').classList.add('hidden');
    }
    // / — focus search
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      e.preventDefault();
      document.getElementById('search-input')?.focus();
    }
  });
}

// ─── Global Paste ─────────────────────────────────────────────────────────────
function setupGlobalPaste() {
  document.addEventListener('paste', e => {
    const focused = document.activeElement;
    if (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA') return;
    const text = e.clipboardData.getData('text');
    if (!text) return;
    e.preventDefault();
    const ta = document.getElementById('new-content');
    ta.value = text;
    ta.focus();
    onContentInput(text);
    showToast('Pasted! Hit Ctrl+Enter to add.', 'info', 3000);
  });
}

// ─── Typing Indicator ─────────────────────────────────────────────────────────
function setupTypingDetector() {
  // Handled inline in onContentInput
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function hideSkeleton() {
  const sk = document.getElementById('skeleton-loader');
  if (sk) sk.remove();
}

function formatTimeAgo(ts) {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escAttr(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Add icon-btn style via JS (Tailwind purge workaround)
const st = document.createElement('style');
st.textContent = `.icon-btn { display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; border-radius:8px; transition:all 0.15s; cursor:pointer; background:transparent; border:none; }
.icon-btn:hover { background: rgba(255,255,255,0.06); }`;
document.head.appendChild(st);
