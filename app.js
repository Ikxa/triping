// ╔══════════════════════════════════════════════════════════════╗
// ║     Amsterdam Trip Planner — app.js                         ║
// ║     Data: GitHub Gist (shared) + localStorage (fallback)    ║
// ║     Photos: ImgBB (cloud) + base64 Canvas (fallback)        ║
// ╚══════════════════════════════════════════════════════════════╝

import { TRIP_DATE, GIST_ID, IMGBB_API_KEY } from './config.js';

// ──────────────────────────────────────────────────────────────
// CONSTANTS
// ──────────────────────────────────────────────────────────────
const PLACEHOLDER  = 'YOUR_';
const STORAGE_KEY  = 'amsterdam-trip-v1';
const VOTED_KEY    = 'amsterdam-voted-v1';
const TOKEN_KEY    = 'amsterdam-gist-token'; // GitHub PAT stored locally per user
const GIST_FILE    = 'data.json';
const GIST_URL     = `https://api.github.com/gists/${GIST_ID}`;
const AUTO_REFRESH = 180_000; // 3 minutes pour économiser le quota (5000 req/h)

// PAT helpers — stored in localStorage, never in source code
function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}
function setToken(t) { localStorage.setItem(TOKEN_KEY, t.trim()); }

const CATEGORIES = {
  bar:      { emoji: '🍺', label: 'Bar',        color: '#E8A838' },
  resto:    { emoji: '🍽️', label: 'Restaurant', color: '#E05C3A' },
  culture:  { emoji: '🏛️', label: 'Culture',    color: '#5B7FE8' },
  nature:   { emoji: '🌿', label: 'Nature',      color: '#4CAF7D' },
  shopping: { emoji: '🛍️', label: 'Shopping',   color: '#C862D4' },
  music:    { emoji: '🎵', label: 'Nightlife',   color: '#E85B9A' },
  other:    { emoji: '💡', label: 'Autre',        color: '#8B96A8' },
};

const BUDGETS = { free: '🆓 Gratuit', low: '€', mid: '€€', high: '€€€' };

const STATUSES = {
  todo: { emoji: '📌', label: 'À faire' },
  done: { emoji: '✅', label: 'Visité'  },
  skip: { emoji: '⏭️', label: 'Skip'   },
};

const ROTATIONS = [-1.5, 0.8, -0.5, 1.3, -1, 0.4, -1.8, 1.6, 0.2, -1.2];

// ──────────────────────────────────────────────────────────────
// STATE
// ──────────────────────────────────────────────────────────────
let items        = [];
let editingId    = null;
let deletingId   = null;
let pendingPhoto = null; // { type: 'file'|'url', file?, url? }
let useCloud     = false;
let refreshTimer = null;

let filter = { cat: 'all', status: 'all', search: '', sort: 'date-desc' };

// ──────────────────────────────────────────────────────────────
// GITHUB GIST API
// ──────────────────────────────────────────────────────────────
function isCloudConfigured() {
  return GIST_ID && !GIST_ID.startsWith(PLACEHOLDER);
}

// Read — uses auth if available to get 5000 req/hr limit instead of 60
async function cloudGet() {
  const token = getToken();
  const headers = { 'Accept': 'application/vnd.github+json' };
  if (token) headers['Authorization'] = `token ${token}`;

  const res = await fetch(GIST_URL, { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `GitHub Gist GET ${res.status}`);
  }
  const gist = await res.json();
  const raw  = gist.files?.[GIST_FILE]?.content ?? '{"items":[]}';
  const data = JSON.parse(raw);
  return Array.isArray(data.items) ? data.items : [];
}

// Write — requires PAT with gist scope
async function cloudPut(data) {
  const token = getToken();
  if (!token) throw new Error('no-token');

  const res = await fetch(GIST_URL, {
    method:  'PATCH',
    headers: {
      'Accept':        'application/vnd.github+json',
      'Authorization': `token ${token}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      files: { [GIST_FILE]: { content: JSON.stringify({ items: data }) } },
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `GitHub Gist PATCH ${res.status}`);
  }
}

// ──────────────────────────────────────────────────────────────
// STORAGE INIT
// ──────────────────────────────────────────────────────────────
async function initStorage() {
  if (!isCloudConfigured()) {
    loadLocal();
    showSyncBadge('local');
    return;
  }

  setSyncBadge('loading');
  try {
    const data = await cloudGet();
    items = Array.isArray(data) ? data : [];
    useCloud = true;
    renderAll();
    showSyncBadge('cloud');
    updateLastSync();
    // Auto-refresh
    refreshTimer = setInterval(refresh, AUTO_REFRESH);
  } catch (err) {
    console.warn('[Amsterdam] GitHub Gist error, falling back to localStorage:', err);
    if (err.message.includes('Bad credentials') || err.message.includes('401')) {
      localStorage.removeItem(TOKEN_KEY);
      openTokenModal('Ton token a expiré ou est invalide. <strong>Entre le nouveau token</strong> fourni par Jordan pour te reconnecter.');
    }
    loadLocal();
    showSyncBadge('local');
    toast(`⚠️ Gist inaccessible (${err.message}) — mode local activé`, 'default', 5000);
  }
}

// Manual / auto refresh
async function refresh(silent = false) {
  if (!useCloud) return;
  const btn = document.getElementById('refreshBtn');
  btn?.classList.add('spinning');
  try {
    const data = await cloudGet();
    items = Array.isArray(data) ? data : [];
    renderAll();
    updateLastSync();
    if (!silent) toast('🔄 Données actualisées', 'default', 1800);
  } catch (err) {
    if (!silent) toast('❌ Impossible de rafraîchir', 'error');
  } finally {
    btn?.classList.remove('spinning');
  }
}

// ──────────────────────────────────────────────────────────────
// LOCAL STORAGE
// ──────────────────────────────────────────────────────────────
function loadLocal() {
  try { items = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { items = []; }
  renderAll();
}

function saveLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function uid() {
  return Date.now() + '-' + Math.random().toString(36).slice(2, 7);
}

// ──────────────────────────────────────────────────────────────
// CRUD
// ──────────────────────────────────────────────────────────────
async function addItem(data) {
  const item = { id: uid(), ...data, votes: 0, status: 'todo', createdAt: Date.now() };

  if (useCloud) {
    // Always GET fresh data before writing to avoid race conditions
    const fresh = await cloudGet();
    const updated = Array.isArray(fresh) ? [...fresh, item] : [item];
    await cloudPut(updated);
    items = updated;
  } else {
    items.push(item);
    saveLocal();
  }
  renderAll();
  updateLastSync();
}

async function updateItem(id, data) {
  if (useCloud) {
    const fresh   = await cloudGet();
    const updated = (Array.isArray(fresh) ? fresh : []).map(i => i.id === id ? { ...i, ...data } : i);
    await cloudPut(updated);
    items = updated;
  } else {
    items = items.map(i => i.id === id ? { ...i, ...data } : i);
    saveLocal();
  }
  renderAll();
  updateLastSync();
}

async function deleteItem(id) {
  if (useCloud) {
    const fresh   = await cloudGet();
    const updated = (Array.isArray(fresh) ? fresh : []).filter(i => i.id !== id);
    await cloudPut(updated);
    items = updated;
  } else {
    items = items.filter(i => i.id !== id);
    saveLocal();
  }
  renderAll();
  updateLastSync();
}

async function voteItem(id) {
  const item = items.find(i => i.id === id);
  if (!item) return;

  const voted    = getVoted();
  const hasVoted = voted.includes(id);

  if (hasVoted) {
    await updateItem(id, { votes: Math.max(0, (item.votes || 0) - 1) });
    localStorage.setItem(VOTED_KEY, JSON.stringify(voted.filter(v => v !== id)));
  } else {
    await updateItem(id, { votes: (item.votes || 0) + 1 });
    localStorage.setItem(VOTED_KEY, JSON.stringify([...voted, id]));
  }
}

async function cycleStatus(id) {
  const item = items.find(i => i.id === id);
  if (!item) return;
  const cycle = ['todo', 'done', 'skip'];
  const next  = cycle[(cycle.indexOf(item.status || 'todo') + 1) % cycle.length];
  await updateItem(id, { status: next });
  toast(`Statut → ${STATUSES[next].emoji} ${STATUSES[next].label}`);
}

function getVoted() {
  try { return JSON.parse(localStorage.getItem(VOTED_KEY) || '[]'); }
  catch { return []; }
}

// ──────────────────────────────────────────────────────────────
// FILTERING & SORTING
// ──────────────────────────────────────────────────────────────
function getFiltered() {
  let res = [...items];

  if (filter.cat    !== 'all') res = res.filter(i => i.category === filter.cat);
  if (filter.status !== 'all') res = res.filter(i => (i.status || 'todo') === filter.status);

  if (filter.search) {
    const q = filter.search.toLowerCase();
    res = res.filter(i =>
      [i.title, i.description, i.address, i.addedBy, i.tips]
        .some(v => (v || '').toLowerCase().includes(q))
    );
  }

  const BO = { free: 0, low: 1, mid: 2, high: 3, '': 4 };
  switch (filter.sort) {
    case 'date-desc':  res.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); break;
    case 'date-asc':   res.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)); break;
    case 'votes-desc': res.sort((a, b) => (b.votes || 0) - (a.votes || 0));         break;
    case 'alpha':      res.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'fr')); break;
    case 'budget-asc': res.sort((a, b) => (BO[a.budget] ?? 4) - (BO[b.budget] ?? 4)); break;
  }
  return res;
}

// ──────────────────────────────────────────────────────────────
// RENDER
// ──────────────────────────────────────────────────────────────
function renderAll() {
  const board = document.getElementById('board');
  const empty = document.getElementById('emptyState');
  const voted = getVoted();
  const data  = getFiltered();

  const total = items.length;
  const done  = items.filter(i => i.status === 'done').length;
  const votes = items.reduce((s, i) => s + (i.votes || 0), 0);
  document.getElementById('statCount').textContent = `${total} lieu${total !== 1 ? 'x' : ''}`;
  document.getElementById('statDone').textContent  = `${done} visité${done !== 1 ? 's' : ''}`;
  document.getElementById('statVotes').textContent = `${votes} vote${votes !== 1 ? 's' : ''}`;

  if (data.length === 0) {
    board.innerHTML = '';
    empty.classList.add('visible');
    return;
  }
  empty.classList.remove('visible');
  board.innerHTML = data.map((item, idx) => renderCard(item, idx, voted)).join('');
}

function renderCard(item, idx, voted) {
  const cat    = CATEGORIES[item.category] || CATEGORIES.other;
  const status = STATUSES[item.status || 'todo'];
  const rot    = ROTATIONS[idx % ROTATIONS.length];
  const isVot  = voted.includes(item.id);
  const budget = item.budget ? BUDGETS[item.budget] : null;
  const mapsUrl = item.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.address + ', Amsterdam')}`
    : null;

  return `
<article class="card cat-${item.category || 'other'} status-${item.status || 'todo'}"
         data-id="${item.id}"
         style="--rot:${rot}deg"
         tabindex="0"
         role="button"
         aria-label="${escHtml(item.title)}">
  <div class="card-pin"></div>

  ${item.photo
    ? `<div class="card-photo">
         <img src="${escHtml(item.photo)}" alt="${escHtml(item.title)}"
              onerror="this.closest('.card-photo').style.display='none'">
       </div>`
    : ''}

  <div class="card-body">
    <div class="card-header-row">
      <span class="cat-badge"
            style="background:${cat.color}18;color:${cat.color};border-color:${cat.color}40">
        ${cat.emoji} ${cat.label}
      </span>
      ${budget ? `<span class="budget-badge">${budget}</span>` : ''}
    </div>

    <h3 class="card-title">${escHtml(item.title)}</h3>

    ${item.description ? `<p class="card-desc">${escHtml(item.description)}</p>` : ''}

    ${item.address
      ? `<a class="card-address" href="${mapsUrl}" target="_blank" rel="noopener"
            onclick="event.stopPropagation()">📍 ${escHtml(item.address)}</a>`
      : ''}

    ${item.tips ? `<p class="card-tips">💬 ${escHtml(item.tips)}</p>` : ''}

    <div class="card-footer">
      <span class="card-author">✍️ ${escHtml(item.addedBy || '?')}</span>
      <button class="status-badge status-${item.status || 'todo'}"
              data-action="status"
              title="Cliquer pour changer">
        ${status.emoji} ${status.label}
      </button>
    </div>
  </div>

  <div class="card-actions">
    <button class="magic-btn"
            data-action="showcase"
            title="Showcase ridicule ! ✨">
      ✨
    </button>

    <button class="vote-btn ${isVot ? 'voted' : ''}"
            data-action="vote"
            title="${isVot ? 'Retirer mon vote' : "J'y vais !"}">
      ❤️ <span>${item.votes || 0}</span>
    </button>

    <div class="card-links">
      ${item.website
        ? `<a href="${escHtml(item.website)}" target="_blank" rel="noopener"
              class="link-btn" title="Site web" onclick="event.stopPropagation()">🔗</a>`
        : ''}
      ${item.instagram
        ? `<a href="https://instagram.com/${escHtml(item.instagram.replace('@', ''))}"
              target="_blank" rel="noopener"
              class="link-btn" title="Instagram" onclick="event.stopPropagation()">📸</a>`
        : ''}
      ${mapsUrl
        ? `<a href="${mapsUrl}" target="_blank" rel="noopener"
              class="link-btn" title="Google Maps" onclick="event.stopPropagation()">🗺️</a>`
        : ''}
    </div>

    <div class="card-controls">
      <button class="edit-btn"   data-action="edit"   title="Modifier">✏️</button>
      <button class="delete-btn" data-action="delete" title="Supprimer">🗑️</button>
    </div>
  </div>
</article>`;
}

// L'attachement se fait désormais au démarrage via délégation (plus performant)
// function attachCardEvents() { ... }
function handleCardClick(e) {
  const action = e.target.closest('[data-action]')?.dataset.action;
  const card   = e.target.closest('.card');
  if (!card) return;
  const id = card.dataset.id;

  if (action === 'vote') { 
    e.stopPropagation(); 
    const btn = card.querySelector('.vote-btn');
    if (btn) btn.disabled = true;
    voteItem(id).catch(err => {
      if (err.message === 'no-token') {
        openTokenModal(`Tu veux voter pour <strong>${card.querySelector('.card-title')?.textContent || 'ce lieu'}</strong> ? Entre le token pour participer au board.`);
      } else {
        toast('❌ Erreur : ' + err.message, 'error');
      }
    }).finally(() => {
      if (btn) btn.disabled = false;
    });
    return; 
  }
  if (action === 'showcase') { e.stopPropagation(); openShowcase(id);   return; }
  if (action === 'status') { 
    e.stopPropagation(); 
    const btn = card.querySelector('[data-action="status"]');
    if (btn) btn.disabled = true;
    cycleStatus(id).catch(err => {
      if (err.message === 'no-token') {
        openTokenModal(`Tu veux changer le statut de <strong>${card.querySelector('.card-title')?.textContent || 'ce lieu'}</strong> ? Entre le token pour modifier le board.`);
      } else {
        toast('❌ Erreur : ' + err.message, 'error');
      }
    }).finally(() => {
      if (btn) btn.disabled = false;
    });
    return; 
  }
  if (action === 'edit')     { e.stopPropagation(); openEditModal(id); return; }
  if (action === 'delete')   { e.stopPropagation(); openConfirm(id);   return; }

  if (!e.target.closest('.card-actions')) openDetail(id);
}

// ──────────────────────────────────────────────────────────────
// MODAL : ADD / EDIT
// ──────────────────────────────────────────────────────────────
window.openAddModal = function() {
  editingId = null;
  document.getElementById('formTitle').textContent  = '📌 Nouveau lieu';
  document.getElementById('formSubmit').textContent = 'Ajouter 📌';
  document.getElementById('itemForm').reset();
  document.getElementById('fieldId').value = '';
  resetPhotoInput();
  openOverlay('formOverlay');
};

function openEditModal(id) {
  const item = items.find(i => i.id === id);
  if (!item) return;
  editingId = id;

  document.getElementById('formTitle').textContent  = '✏️ Modifier le lieu';
  document.getElementById('formSubmit').textContent = 'Enregistrer ✓';
  document.getElementById('fieldId').value          = id;
  document.getElementById('fieldAuthor').value      = item.addedBy     || '';
  document.getElementById('fieldCategory').value    = item.category    || '';
  document.getElementById('fieldTitle').value       = item.title       || '';
  document.getElementById('fieldDesc').value        = item.description || '';
  document.getElementById('fieldAddress').value     = item.address     || '';
  document.getElementById('fieldBudget').value      = item.budget      || '';
  document.getElementById('fieldWebsite').value     = item.website     || '';
  document.getElementById('fieldInstagram').value   = item.instagram   || '';
  document.getElementById('fieldTips').value        = item.tips        || '';

  resetPhotoInput();
  if (item.photo) {
    pendingPhoto = { type: 'url', url: item.photo };
    showPhotoPreview(item.photo);
  }

  openOverlay('formOverlay');
}

// ──────────────────────────────────────────────────────────────
// MODAL : DETAIL
// ──────────────────────────────────────────────────────────────
function openDetail(id) {
  const item = items.find(i => i.id === id);
  if (!item) return;

  const cat    = CATEGORIES[item.category] || CATEGORIES.other;
  const status = STATUSES[item.status || 'todo'];
  const budget = item.budget ? BUDGETS[item.budget] : null;
  const voted  = getVoted();
  const isVot  = voted.includes(id);
  const mapsUrl  = item.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.address + ', Amsterdam')}` : null;
  const embedUrl = item.address ? `https://maps.google.com/maps?q=${encodeURIComponent(item.address + ', Amsterdam')}&output=embed` : null;

  document.getElementById('detailContent').innerHTML = `
    ${item.photo
      ? `<div class="detail-photo">
           <img src="${escHtml(item.photo)}" alt="${escHtml(item.title)}"
                onerror="this.closest('.detail-photo').style.display='none'">
         </div>`
      : ''}
    <div class="detail-body">
      <div class="detail-badges">
        <span class="cat-badge" style="background:${cat.color}18;color:${cat.color};border-color:${cat.color}40">
          ${cat.emoji} ${cat.label}
        </span>
        ${budget ? `<span class="budget-badge">${budget}</span>` : ''}
        <span class="status-badge status-${item.status || 'todo'}">${status.emoji} ${status.label}</span>
      </div>
      <h2 class="detail-title">${escHtml(item.title)}</h2>
      ${item.description ? `<p class="detail-desc">${escHtml(item.description)}</p>` : ''}
      ${item.tips ? `<div class="detail-tips"><strong>💬 Tips :</strong> ${escHtml(item.tips)}</div>` : ''}
      ${item.address ? `<a class="detail-address" href="${mapsUrl}" target="_blank" rel="noopener">📍 ${escHtml(item.address)}</a>` : ''}
      ${(item.website || item.instagram)
        ? `<div class="detail-links">
             ${item.website   ? `<a href="${escHtml(item.website)}" target="_blank" rel="noopener" class="detail-link-btn">🔗 Site web</a>` : ''}
             ${item.instagram ? `<a href="https://instagram.com/${escHtml(item.instagram.replace('@',''))}" target="_blank" rel="noopener" class="detail-link-btn">📸 @${escHtml(item.instagram.replace('@',''))}</a>` : ''}
           </div>`
        : ''}
      ${embedUrl ? `<iframe class="detail-map" src="${embedUrl}" loading="lazy" allowfullscreen></iframe>` : ''}
      <div class="detail-meta">
        <span>Proposé par <strong>✍️ ${escHtml(item.addedBy || '?')}</strong></span>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="detail-vote-btn ${isVot ? 'voted' : ''}" id="detailVoteBtn"
                  onclick="handleDetailVote('${id}')">
            ❤️ ${item.votes || 0} vote${(item.votes || 0) !== 1 ? 's' : ''}
          </button>
          <button class="detail-edit-btn" onclick="openEditModalFromDetail('${id}')">✏️ Modifier</button>
        </div>
      </div>
    </div>`;

  openOverlay('detailOverlay');
}

window.handleDetailVote = async function(id) {
  const btn = document.getElementById('detailVoteBtn');
  if (btn) btn.style.pointerEvents = 'none';
  try {
    await voteItem(id);
    const item  = items.find(i => i.id === id);
    const voted = getVoted();
    if (btn && item) {
      btn.textContent = `❤️ ${item.votes || 0} vote${(item.votes || 0) !== 1 ? 's' : ''}`;
      btn.classList.toggle('voted', voted.includes(id));
    }
  } catch (err) {
    if (err.message === 'no-token') {
      openTokenModal(`Tu veux <strong>voter pour ce lieu</strong> ? Entre le token pour participer au board.`);
    } else {
      toast('❌ Erreur : ' + err.message, 'error');
    }
  } finally {
    if (btn) btn.style.pointerEvents = 'auto';
  }
};

window.openEditModalFromDetail = function(id) {
  closeOverlay('detailOverlay');
  setTimeout(() => openEditModal(id), 250);
};

// ──────────────────────────────────────────────────────────────
// MODAL : CONFIRM DELETE
// ──────────────────────────────────────────────────────────────
function openConfirm(id) { deletingId = id; openOverlay('confirmOverlay'); }

// ──────────────────────────────────────────────────────────────
// OVERLAY HELPERS
// ──────────────────────────────────────────────────────────────
function openOverlay(id)  { document.getElementById(id).classList.add('open'); }
function closeOverlay(id) { document.getElementById(id).classList.remove('open'); }

// ──────────────────────────────────────────────────────────────
// MODAL : TOKEN (Rejoindre le board)
// ──────────────────────────────────────────────────────────────
function openTokenModal(reason = null) {
  document.getElementById('tokenInput').value = getToken();
  document.getElementById('tokenError').style.display = 'none';

  const subtitle = document.getElementById('tokenSubtitle');
  if (reason) {
    subtitle.innerHTML = reason;
  } else {
    subtitle.textContent = 'Pour modifier le board, tu as besoin d\'un token d\'accès.';
  }
  openOverlay('tokenOverlay');
}

async function saveToken() {
  const val = document.getElementById('tokenInput').value.trim();
  const err = document.getElementById('tokenError');
  if (!val) { err.textContent = 'Entre un token valide.'; err.style.display = 'block'; return; }

  // Quick validation — test a write to the gist
  const btn = document.getElementById('tokenSave');
  btn.disabled = true; btn.textContent = 'Vérification…';
  try {
    // Read current data first, then write it back with the new token
    setToken(val);
    const fresh = await cloudGet();
    await cloudPut(fresh); // no-op write just to test auth
    closeOverlay('tokenOverlay');
    showSyncBadge('cloud');
    toast('🔑 Token valide — tu peux écrire sur le board !', 'success', 3000);
  } catch (e) {
    localStorage.removeItem(TOKEN_KEY); // clear bad token
    err.textContent = e.message.includes('Bad credentials') || e.message.includes('401')
      ? 'Token incorrect ou expiré. Vérifie et réessaie.'
      : `Erreur : ${e.message}`;
    err.style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = 'Rejoindre ✓';
  }
}

// ──────────────────────────────────────────────────────────────
// PHOTO HANDLING — ImgBB + Canvas fallback
// ──────────────────────────────────────────────────────────────
function isImgBBConfigured() {
  return IMGBB_API_KEY && !IMGBB_API_KEY.startsWith(PLACEHOLDER);
}

async function uploadToImgBB(file) {
  const form = new FormData();
  form.append('image', file);
  const res  = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
    method: 'POST', body: form,
  });
  const data = await res.json();
  if (!data.success) throw new Error('ImgBB: ' + (data.error?.message || 'upload failed'));
  return data.data.display_url; // permanent CDN URL
}

function compressImage(file, maxPx = 900, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxPx || height > maxPx) {
          if (width > height) { height = Math.round(height * maxPx / width); width = maxPx; }
          else                { width  = Math.round(width  * maxPx / height); height = maxPx; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function resolvePhoto() {
  if (!pendingPhoto) return '';
  if (pendingPhoto.type === 'url')  return pendingPhoto.url;
  if (pendingPhoto.type === 'file') {
    if (isImgBBConfigured()) {
      return uploadToImgBB(pendingPhoto.file); // → CDN URL
    } else {
      return compressImage(pendingPhoto.file); // → base64
    }
  }
  return '';
}

function showPhotoPreview(src) {
  document.getElementById('photoPreviewImg').src = src;
  document.getElementById('photoPreview').style.display = 'block';
}
function hidePhotoPreview() {
  document.getElementById('photoPreview').style.display = 'none';
  document.getElementById('photoPreviewImg').src = '';
}
function resetFileInput() {
  document.getElementById('fieldPhotoFile').value = '';
  document.getElementById('photoFileLabel').textContent = 'Choisir un fichier…';
}
function resetPhotoInput() {
  pendingPhoto = null;
  resetFileInput();
  document.getElementById('fieldPhotoUrl').value = '';
  hidePhotoPreview();
}

// ──────────────────────────────────────────────────────────────
// WEATHER
// ──────────────────────────────────────────────────────────────
async function loadWeather() {
  try {
    const res  = await fetch('https://api.open-meteo.com/v1/forecast?latitude=52.374&longitude=4.890&current=temperature_2m,weather_code&timezone=Europe%2FAmsterdam&forecast_days=1');
    const data = await res.json();
    document.getElementById('weatherIcon').textContent = weatherEmoji(data.current.weather_code);
    document.getElementById('weatherVal').textContent  = `${Math.round(data.current.temperature_2m)}°C`;
  } catch {
    document.getElementById('weatherVal').textContent = '—';
  }
}

function weatherEmoji(c) {
  if (c === 0) return '☀️'; if (c <= 2) return '🌤️'; if (c <= 3) return '☁️';
  if (c <= 49) return '🌫️'; if (c <= 67) return '🌧️'; if (c <= 77) return '❄️';
  if (c <= 82) return '🌧️'; return '⛈️';
}

// ──────────────────────────────────────────────────────────────
// COUNTDOWN
// ──────────────────────────────────────────────────────────────
function updateCountdown() {
  if (!TRIP_DATE) { document.getElementById('countdownWidget').style.display = 'none'; return; }
  const diff = new Date(TRIP_DATE) - Date.now();
  const val  = document.getElementById('countdownVal');
  if (diff <= 0) { val.textContent = "C'est parti ! 🎉"; return; }
  const d = Math.floor(diff / 864e5);
  const h = Math.floor((diff % 864e5) / 36e5);
  val.textContent = d > 0 ? `${d}j ${h}h` : `${h}h`;
}

// ──────────────────────────────────────────────────────────────
// SYNC BADGE
// ──────────────────────────────────────────────────────────────
function setSyncBadge(state) {
  const el = document.getElementById('syncIndicator');
  el.className = 'sync-indicator show';
  if (state === 'loading') { el.textContent = '⟳ Connexion…'; el.classList.add('mode-local'); }
}

function showSyncBadge(mode) {
  const el = document.getElementById('syncIndicator');
  el.classList.add('show');
  if (mode === 'cloud') { el.textContent = '🐙 GitHub Gist sync'; el.classList.add('mode-firebase'); }
  else                  { el.textContent = '💾 Mode local';    el.classList.add('mode-local');   }
}

function updateLastSync() {
  const el = document.getElementById('lastSync');
  if (el) el.textContent = 'sync ' + new Date().toLocaleTimeString('fr', { hour: '2-digit', minute: '2-digit' });
}

// ──────────────────────────────────────────────────────────────
// TOAST
// ──────────────────────────────────────────────────────────────
function toast(msg, type = 'default', duration = 2800) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => { el.classList.add('exit'); setTimeout(() => el.remove(), 300); }, duration);
}

// ──────────────────────────────────────────────────────────────
// UTILS
// ──────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ──────────────────────────────────────────────────────────────
// EVENTS
// ──────────────────────────────────────────────────────────────
function setupEvents() {
  // Board delegation
  const board = document.getElementById('board');
  board.addEventListener('click', handleCardClick);
  board.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === e.target.closest('.card')) {
      e.preventDefault(); // prevent scrolling on space
      openDetail(e.target.closest('.card').dataset.id);
    }
  });

  // FAB
  document.getElementById('fabBtn').addEventListener('click', openAddModal);

  // Refresh
  document.getElementById('refreshBtn')?.addEventListener('click', () => refresh(false));

  // Form overlay close
  document.getElementById('formClose').addEventListener('click',  () => closeOverlay('formOverlay'));
  document.getElementById('formCancel').addEventListener('click', () => closeOverlay('formOverlay'));
  document.getElementById('formOverlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeOverlay('formOverlay');
  });

  // Form submit
  document.getElementById('itemForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('formSubmit');
    btn.disabled = true;

    let photoUrl = '';
    try {
      if (pendingPhoto?.type === 'file') {
        btn.textContent = isImgBBConfigured() ? '🖼️ Upload ImgBB…' : '🖼️ Compression…';
        photoUrl = await resolvePhoto();
      } else {
        photoUrl = await resolvePhoto();
      }
    } catch (err) {
      toast('❌ Erreur photo : ' + err.message, 'error');
      btn.disabled = false;
      btn.textContent = editingId ? 'Enregistrer ✓' : 'Ajouter 📌';
      return;
    }

    const data = {
      addedBy:     document.getElementById('fieldAuthor').value.trim(),
      category:    document.getElementById('fieldCategory').value,
      title:       document.getElementById('fieldTitle').value.trim(),
      description: document.getElementById('fieldDesc').value.trim(),
      address:     document.getElementById('fieldAddress').value.trim(),
      budget:      document.getElementById('fieldBudget').value,
      photo:       photoUrl,
      website:     document.getElementById('fieldWebsite').value.trim(),
      instagram:   document.getElementById('fieldInstagram').value.trim(),
      tips:        document.getElementById('fieldTips').value.trim(),
    };

    btn.textContent = '💾 Sauvegarde…';
    try {
      if (editingId) { await updateItem(editingId, data); toast('✅ Lieu modifié !', 'success'); }
      else           { await addItem(data);               toast('📌 Lieu ajouté !', 'success'); }
      closeOverlay('formOverlay');
    } catch (err) {
      if (err.message === 'no-token') {
        closeOverlay('formOverlay');
        openTokenModal();
        toast('🔑 Entre ton token pour écrire sur le board', 'default', 4000);
      } else {
        toast('❌ ' + err.message, 'error');
      }
    } finally {
      btn.disabled = false;
      btn.textContent = editingId ? 'Enregistrer ✓' : 'Ajouter 📌';
    }
  });

  // Photo: file picker
  document.getElementById('fieldPhotoFile').addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    pendingPhoto = { type: 'file', file };
    document.getElementById('photoFileLabel').textContent = file.name;
    document.getElementById('fieldPhotoUrl').value = '';
    const preview = await compressImage(file, 600, 0.8);
    showPhotoPreview(preview);
  });

  // Photo: URL input
  document.getElementById('fieldPhotoUrl').addEventListener('input', e => {
    const url = e.target.value.trim();
    if (url) {
      pendingPhoto = { type: 'url', url };
      showPhotoPreview(url);
      resetFileInput();
    } else if (!pendingPhoto || pendingPhoto.type === 'url') {
      pendingPhoto = null;
      hidePhotoPreview();
    }
  });

  // Photo: clear
  document.getElementById('photoClear').addEventListener('click', resetPhotoInput);

  // Detail overlay
  document.getElementById('detailClose').addEventListener('click', () => closeOverlay('detailOverlay'));
  document.getElementById('detailOverlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeOverlay('detailOverlay');
  });

  // Confirm overlay
  document.getElementById('confirmCancel').addEventListener('click', () => closeOverlay('confirmOverlay'));
  document.getElementById('confirmOverlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeOverlay('confirmOverlay');
  });
  document.getElementById('confirmOk').addEventListener('click', async () => {
    if (!deletingId) return;
    const btn = document.getElementById('confirmOk');
    btn.textContent = '…'; btn.disabled = true;
    try { 
      await deleteItem(deletingId); 
      toast('🗑️ Supprimé'); 
      deletingId = null;
      closeOverlay('confirmOverlay');
    } catch (err) { 
      if (err.message === 'no-token') {
        closeOverlay('confirmOverlay');
        openTokenModal('<strong>Pour supprimer un lieu</strong>, tu dois avoir les droits d\'écriture. Entre ton token d\'accès.');
      } else {
        toast('❌ ' + err.message, 'error');
      }
    } finally { 
      btn.textContent = 'Supprimer'; 
      btn.disabled = false; 
    }
  });

  // Category filter
  document.getElementById('categoryFilters').addEventListener('click', e => {
    const btn = e.target.closest('.pill[data-cat]');
    if (!btn) return;
    document.querySelectorAll('#categoryFilters .pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filter.cat = btn.dataset.cat;
    renderAll();
  });

  // Status filter
  document.getElementById('statusFilters').addEventListener('click', e => {
    const btn = e.target.closest('.pill[data-status]');
    if (!btn) return;
    document.querySelectorAll('#statusFilters .pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filter.status = btn.dataset.status;
    renderAll();
  });

  // Sort
  document.getElementById('sortSelect').addEventListener('change', e => {
    filter.sort = e.target.value; renderAll();
  });

  // Search (debounced)
  let searchTimer;
  document.getElementById('searchInput').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { filter.search = e.target.value.trim(); renderAll(); }, 220);
  });

  // Token modal
  document.getElementById('tokenSave').addEventListener('click', saveToken);
  document.getElementById('tokenSkip').addEventListener('click', () => {
    closeOverlay('tokenOverlay');
    showSyncBadge('readonly');
    toast('👁️ Mode lecture seule activé. Tu peux consulter le board sans rien modifier.', 'default', 3500);
  });
  document.getElementById('tokenInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') saveToken();
  });
  // Sync badge click → re-open token modal
  document.getElementById('syncIndicator').addEventListener('click', () => {
    openTokenModal();
  });

  // Escape
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    ['formOverlay', 'detailOverlay', 'confirmOverlay', 'showcaseOverlay', 'tokenOverlay'].forEach(id => {
      if (document.getElementById(id).classList.contains('open')) {
        if (id === 'showcaseOverlay' && typeof closeShowcase === 'function') closeShowcase();
        else closeOverlay(id);
      }
    });
  });
}

// ──────────────────────────────────────────────────────────────
// RIDICULOUS SHOWCASE LOGIC
// ──────────────────────────────────────────────────────────────
let showcaseIdx = 0;
let showcaseData = [];

function openShowcase(id) {
  const item = items.find(i => i.id === id);
  if (!item) return;

  showcaseIdx = 0;
  generateShowcaseContent(item);
  renderShowcaseSlides();
  
  // Force a layout reflow so the browser restarts CSS animations cleanly
  void document.getElementById('showcaseSlides').offsetHeight;
  
  updateShowcaseState();
  openOverlay('showcaseOverlay');
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function shuffle(arr) { return [...arr].sort(() => Math.random() - 0.5); }

function generateShowcaseContent(item) {
  const title   = item.title   || '?';
  const cat     = item.category || 'other';
  const author  = item.addedBy || 'quelqu\'un';
  const desc    = item.description || '';
  const tips    = item.tips || '';
  const address = item.address || '';
  const budget  = item.budget || '';
  const votes   = item.votes || 0;

  // ── 1. Slide d'ouverture (toujours là, parmi plusieurs variantes)
  const openingSlides = [
    { title: '🚨 ALERTE BONNE ADRESSE', content: `Accrochez-vous...<br><strong>${title.toUpperCase()}</strong><br><small>proposé par le légendaire ${author}</small>` },
    { title: '📢 ANNONCE OFFICIELLE', content: `Le jury a tranché :<br><strong>${title}</strong><br>est l'endroit où vous DEVEZ aller.` },
    { title: '⚡ BREAKING NEWS', content: `Des sources anonymes (${author}) révèlent que <strong>${title}</strong> est absolument incontournable.` },
    { title: '🎺 ROULEMENTS DE TAMBOUR...', content: `Le lieu le plus important du voyage s'appelle...<br><br><strong>${title.toUpperCase()} !!!</strong>` },
  ];

  // ── 2. Pool par catégorie
  const catSlides = {
    bar: [
      { title: '🍺 EXPERTISE BRASSICOLE', content: `<strong>${title}</strong> — là où les bières néerlandaises te regardent avec respect.` },
      { title: '🍻 ALERTE ALCOOL', content: `${title} c'est comme une pharmacie, mais les médicaments sont délicieux et font chanter.` },
      { title: '🎯 LA MISSION', content: `Trouver une place à <strong>${title}</strong>, commander en premier, et prétendre connaître la bière locale depuis toujours.` },
      { title: '🔬 ANALYSE CHIMIQUE', content: `Les chercheurs confirment : les bières de <strong>${title}</strong> contiennent 300% plus de bonne humeur que la moyenne.` },
    ],
    resto: [
      { title: '🍽️ RAPPORT GASTRONOMIQUE', content: `<strong>${title}</strong> : l'endroit où on mange tellement bien qu'on réfléchit à s'expatrier.` },
      { title: '👨‍🍳 ALERTE CULINAIRE', content: `La cuisine de <strong>${title}</strong> a été déclarée "arme de régal massif" par 3 experts anonymes.` },
      { title: '🤌 LE VERDICT CULINAIRE', content: `${title} — si tu ne tries pas une photo de ton plat pour ta story, tu n'y étais pas.` },
      { title: '🥇 CLASSEMENT MONDIAL', content: `<strong>${title}</strong> se classe #1 dans la catégorie "endroits où on mange bien à Amsterdam selon ${author}".` },
    ],
    culture: [
      { title: '🏛️ ENRICHISSEMENT CULTUREL', content: `<strong>${title}</strong> va te faire paraître 40% plus intelligent en soirée. Garanti.` },
      { title: '🎨 RAPPORT ARTISTIQUE', content: `Tu vas ressortir de <strong>${title}</strong> avec des opinions sur des trucs que tu n'avais jamais vus avant.` },
      { title: '🧠 ALERTE SAVOIR', content: `<strong>${title}</strong> : là où les neurones font la fête. Apporte ton cerveau (et une bouteille d'eau).` },
      { title: '📚 NIVEAU CULTUREL +1', content: `Après <strong>${title}</strong>, tu pourras enfin placer "Amsterdam" dans une conversation sans te la péter.` },
    ],
    nature: [
      { title: '🌿 CONNEXION AVEC LA TERRE', content: `<strong>${title}</strong> — pour se rappeler que la nature existe entre deux cafés.` },
      { title: '🌳 BULLETIN MÉTÉO INTÉRIEUR', content: `Prévisions : détente maximale à <strong>${title}</strong>, avec des éclaircies de sérénité.` },
      { title: '🦆 RAPPORT FAUNE & FLORE', content: `<strong>${title}</strong> : les canards y sont en charge de la sécurité. Respectez la chaîne de commandement.` },
      { title: '🍃 ORDONNANCE MÉDICALE', content: `Prescription du Dr. ${author} : 2h minimum à <strong>${title}</strong> pour guérir le stress du quotidien.` },
    ],
    shopping: [
      { title: '🛍️ ALERTE ÉCONOMIQUE', content: `<strong>${title}</strong> : ton compte en banque sait déjà ce qui l'attend. Il a peur.` },
      { title: '💳 RAPPORT FINANCIER', content: `Des études montrent que 100% des visiteurs de <strong>${title}</strong> repartent les sacs pleins et le portefeuille léger.` },
      { title: '🏷️ PROTOCOLE ACHATS', content: `Règle n°1 à <strong>${title}</strong> : si tu as un doute, tu l'achètes. C'est pour le voyage.` },
      { title: '📊 PRÉVISIONS BUDGÉTAIRES', content: `Entrée à <strong>${title}</strong> : gratuit.<br>Sortie sans rien acheter : statistiquement impossible.` },
    ],
    music: [
      { title: '🎵 RAPPORT ACOUSTIQUE', content: `<strong>${title}</strong> : là où tes oreilles vont vivre leur meilleur moment de l'année.` },
      { title: '🎧 ALERTE SONORE', content: `Les scientifiques confirment : danser à <strong>${title}</strong> brûle 3x plus de calories qu'à la salle de sport.` },
      { title: '🕺 PROTOCOLE NIGHTLIFE', content: `Étape 1 : arriver à <strong>${title}</strong>. Étape 2 : bouger. Étape 3 : rater le dernier métro. Étape 4 : aucun regret.` },
      { title: '🔊 NIVEAU SONORE', content: `<strong>${title}</strong> a été classé "dangereux pour la sobrié́té" par l'Agence Fictive des Nuits Hollandaises.` },
    ],
    other: [
      { title: '💡 LE LIEU MYSTÉRIEUX', content: `<strong>${title}</strong> — personne ne sait exactement ce que c'est, mais tout le monde veut y aller.` },
      { title: '🔮 L\'ORACLE A PARLÉ', content: `Les astres sont formels : <strong>${title}</strong> est une étape cosmiquement obligatoire de ce voyage.` },
      { title: '🎲 BONUS SURPRISE', content: `${author} a ajouté <strong>${title}</strong> dans la liste. C'est surprenant. C'est donc excellent.` },
    ],
  };

  // ── 3. Slides contextuelles selon les données renseignées
  const contextualPool = [];

  if (desc) {
    const shortDesc = desc.length > 100 ? desc.slice(0, 97) + '...' : desc;
    contextualPool.push({ title: '🔎 LES FAITS BRUTS', content: `Ce que ${author} nous dit :<br><em>"${shortDesc}"</em>` });
    contextualPool.push({ title: '📋 ANALYSE OFFICIELLE', content: `Après étude approfondie de la description, les experts concluent :<br><strong>Incontournable. On y va. Point.</strong>` });
  }

  if (tips) {
    const shortTips = tips.length > 110 ? tips.slice(0, 107) + '...' : tips;
    contextualPool.push({ title: '🤫 CONSEIL TOP SECRET', content: `${author} a glissé ce tip sous la table :<br><em>"${shortTips}"</em>` });
    contextualPool.push({ title: '💡 ASTUCE DE NIVEAU EXPERT', content: `Insider tip (ne répète pas ça) :<br><em>"${shortTips}"</em>` });
  }

  if (address) {
    contextualPool.push({ title: '📍 LA LOCALISATION', content: `Mission : rallier <strong>${address}</strong>.<br>Si tu te perds, c'est que tu n'avais pas assez bu.` });
    contextualPool.push({ title: '🗺️ COORDONNÉES GPS', content: `L'objectif :<br><strong>${address}</strong><br><small>(les canaux sont normaux, ne panique pas)</small>` });
  }

  if (budget === 'free') {
    contextualPool.push({ title: '🆓 ALERTE GRATUIT !!!', content: `<strong>${title}</strong> est GRATUIT.<br>L'argent économisé est juridiquement obligatoire d'être dépensé en bières.` });
  } else if (budget === 'high') {
    contextualPool.push({ title: '💎 AVERTISSEMENT FINANCIER', content: `<strong>${title}</strong> est dans la catégorie €€€.<br>Vends un rein si nécessaire. Ça vaut le coup.` });
  } else if (budget === 'low') {
    contextualPool.push({ title: '💶 RAPPORT BUDGÉTAIRE', content: `<strong>${title}</strong> : pas cher du tout.<br>Tu n'as littéralement aucune excuse pour ne pas y aller.` });
  } else if (budget === 'mid') {
    contextualPool.push({ title: '💰 BILAN FINANCIER', content: `<strong>${title}</strong> en €€ : raisonnable.<br>Ça rentre dans le budget si tu sautes un repas. Ça vaut le coup.` });
  }

  if (votes > 0) {
    contextualPool.push({
      title: `❤️ ${votes} VOTE${votes > 1 ? 'S' : ''} !`,
      content: votes >= 3
        ? `<strong>${votes} personnes</strong> ont voté pour <strong>${title}</strong>.<br>C'est démocratiquement incontournable. Vox populi.`
        : `<strong>${votes} vote${votes > 1 ? 's' : ''}</strong> déjà pour ça.<br>Sois dans le bon camp de l'histoire.`
    });
  }

  // ── 4. Une slide générique "pourquoi y aller" pour toujours avoir du contenu
  const genericSlide = { title: 'POURQUOI Y ALLER ?', content: pick([
    `Parce que les tulipes pleurent si tu passes à côté de <strong>${title}</strong>.`,
    `Parce que ${author} dit que c'est bien, et ${author} a toujours raison.`,
    `Pour pouvoir dire "J'y suis allé" avec un sourire supérieur.`,
    'Pour flexer sur tes potes qui travaillent pendant que tu kiffes Amsterdam.',
    'C\'est légalement obligatoire pour les touristes de qualité supérieure.',
  ])};

  // ── 5. Slide de verdict (toujours en dernier, parmi plusieurs variantes)
  const verdictSlides = [
    { title: '🏆 LE VERDICT FINAL', content: `<strong>11/10 — INCONTOURNABLE !</strong><br>🚀 On y va direct ! 🚀` },
    { title: '⭐ CONCLUSION OFFICIELLE', content: `<strong>${title}</strong> a reçu la note de 11/10.<br>Le jury est unanime. Débat clos.` },
    { title: '✅ DÉCISION PRISE', content: `<strong>${title}</strong> est dans le planning.<br>Qui n'est pas chaud assume les conséquences.` },
    { title: '🎯 ORDRE DE MISSION', content: `Direction <strong>${title}</strong>.<br>C'est pas une suggestion. C'est la loi du voyage.` },
    { title: '📜 DÉCRET OFFICIEL', content: `Par le présent décret,<br><strong>${title}</strong> est déclaré "MUST-DO".<br>Signé : ${author} & l'Univers.` },
  ];

  // ── Assemblage final : opening + shuffle(cat + contextual + generic) + verdict
  const catPool  = shuffle(catSlides[cat] || catSlides.other);
  const ctxPool  = shuffle(contextualPool);
  const nbCat    = pick([1, 1, 2]);   // 1 ou 2 slides de catégorie
  const nbCtx    = Math.min(ctxPool.length, pick([1, 2])); // 1 ou 2 contextuelles

  const middle = shuffle([
    ...catPool.slice(0, nbCat),
    ...ctxPool.slice(0, nbCtx),
    genericSlide,
  ]);

  showcaseData = [
    pick(openingSlides),
    ...middle,
    pick(verdictSlides),
  ];
}

function renderShowcaseSlides() {
  const container = document.getElementById('showcaseSlides');
  // On ne met pas la classe 'active' ici, l'update d'état s'en chargera après le reflow
  container.innerHTML = showcaseData.map((s) => `
    <div class="showcase-slide">
      <h2 class="showcase-title">${s.title}</h2>
      <p class="showcase-content">${s.content}</p>
    </div>
  `).join('');
}

function updateShowcaseState() {
  const slides = document.querySelectorAll('.showcase-slide');
  slides.forEach((s, i) => s.classList.toggle('active', i === showcaseIdx));
  
  document.getElementById('showcasePrev').disabled = (showcaseIdx === 0);
  document.getElementById('showcaseNext').textContent = (showcaseIdx === showcaseData.length - 1) ? 'Terminé ! 🏁' : 'Suivant ! 🚀';
  document.getElementById('showcaseProgress').textContent = `${showcaseIdx + 1} / ${showcaseData.length}`;
}

function closeShowcase() {
  closeOverlay('showcaseOverlay');
  setTimeout(() => { 
    showcaseIdx = 0; 
    const slides = document.querySelectorAll('.showcase-slide');
    slides.forEach(s => s.classList.remove('active'));
  }, 300);
}

function nextSlide() {
  if (showcaseIdx < showcaseData.length - 1) {
    showcaseIdx++;
    updateShowcaseState();
  } else {
    closeShowcase();
  }
}

function prevSlide() {
  if (showcaseIdx > 0) {
    showcaseIdx--;
    updateShowcaseState();
  }
}

function setupShowcaseEvents() {
  document.getElementById('showcaseClose').addEventListener('click', closeShowcase);
  document.getElementById('showcaseNext').addEventListener('click', nextSlide);
  document.getElementById('showcasePrev').addEventListener('click', prevSlide);
  
  document.getElementById('showcaseOverlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeShowcase();
  });
}

// ──────────────────────────────────────────────────────────────
// INIT
// ──────────────────────────────────────────────────────────────
async function init() {
  setupEvents();
  setupShowcaseEvents();
  loadWeather();
  updateCountdown();
  setInterval(updateCountdown, 60_000);
  await initStorage();
}

init();
