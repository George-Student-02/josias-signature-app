const params = new URLSearchParams(location.search);
const contractId = params.get('id');

const viewerWrap = document.getElementById('viewerWrap');
const contractTitle = document.getElementById('contractTitle');
const entryBody = document.getElementById('entryBody');
const emptyEntries = document.getElementById('emptyEntries');

const entryModal = document.getElementById('entryModal');
const addEntryBtn = document.getElementById('addEntryBtn');
const closeModal = document.getElementById('closeModal');
const entryForm = document.getElementById('entryForm');
const entryError = document.getElementById('entryError');
const saveEntryBtn = document.getElementById('saveEntryBtn');

const sigZoomModal = document.getElementById('sigZoomModal');
const sigZoomImg = document.getElementById('sigZoomImg');
const closeSigZoom = document.getElementById('closeSigZoom');

const deleteContractBtn = document.getElementById('deleteContractBtn');
const deleteCount = document.getElementById('deleteCount');
const deleteError = document.getElementById('deleteError');
let entryCount = 0;

if (!contractId) {
  document.body.innerHTML = '<main><p>No contract specified.</p></main>';
  throw new Error('Missing contract id');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

async function loadContract() {
  const res = await apiFetch(`/api/contracts/${contractId}`);
  if (!res.ok) {
    document.body.innerHTML = '<main><p>Contract not found.</p></main>';
    return;
  }
  const contract = await res.json();
  document.title = contract.title;
  contractTitle.textContent = contract.title;

  const fileUrl = `/api/contracts/${contractId}/file`;
  if (contract.mimeType === 'application/pdf') {
    viewerWrap.innerHTML = `<iframe class="viewer" src="${fileUrl}"></iframe>`;
  } else if (contract.mimeType.startsWith('image/')) {
    viewerWrap.innerHTML = `<img class="viewer-img" src="${fileUrl}">`;
  } else {
    // Word docs and the like cannot be shown in a browser, so offer the file itself
    // and say why, rather than leaving a blank box.
    viewerWrap.innerHTML = `
      <div class="empty">
        <p><strong>${escapeHtml(contract.originalName)}</strong> can't be displayed here —
        only PDFs and photos can be shown on screen.</p>
        <p>You can still add signatures below, but to read the contract in the app,
        re-upload it as a PDF.</p>
        <p><a href="${fileUrl}" target="_blank">Download the file instead</a></p>
      </div>`;
  }
}

async function loadEntries() {
  const res = await apiFetch(`/api/contracts/${contractId}/entries`);
  const entries = await res.json();

  entryCount = entries.length;
  deleteCount.textContent = entryCount === 1 ? 'its 1 signature' : `all ${entryCount} of its signatures`;

  entryBody.innerHTML = '';
  emptyEntries.classList.toggle('hidden', entries.length > 0);

  for (const e of entries) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(e.name)}</td>
      <td>${escapeHtml(e.idNumber)}</td>
      <td><img class="sig-thumb" src="${e.signature}" data-full="${e.signature}"></td>
      <td>${fmtDate(e.createdAt)}</td>
      <td class="row-actions"><button class="btn-danger" data-id="${e.id}">Delete</button></td>
    `;
    entryBody.appendChild(tr);
  }
}

entryBody.addEventListener('click', async (e) => {
  if (e.target.matches('img.sig-thumb')) {
    sigZoomImg.src = e.target.dataset.full;
    sigZoomModal.classList.remove('hidden');
  }
  if (e.target.matches('button[data-id]')) {
    if (!confirm('Delete this entry?')) return;
    await apiFetch(`/api/entries/${e.target.dataset.id}`, { method: 'DELETE' });
    loadEntries();
  }
});

deleteContractBtn.addEventListener('click', async () => {
  deleteError.classList.add('hidden');

  const signatures = entryCount === 1 ? '1 signature' : `${entryCount} signatures`;
  const typed = prompt(
    `This permanently deletes "${document.title}" and ${signatures}. This cannot be undone.\n\n` +
    `Type DELETE to confirm:`
  );
  if (typed === null) return;
  if (typed.trim().toUpperCase() !== 'DELETE') {
    deleteError.textContent = 'Not deleted — you did not type DELETE.';
    deleteError.classList.remove('hidden');
    return;
  }

  deleteContractBtn.disabled = true;
  deleteContractBtn.textContent = 'Deleting...';

  try {
    const res = await apiFetch(`/api/contracts/${contractId}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to delete contract');
    }
    location.href = 'index.html';
  } catch (err) {
    deleteError.textContent = err.message;
    deleteError.classList.remove('hidden');
    deleteContractBtn.disabled = false;
    deleteContractBtn.textContent = 'Delete contract';
  }
});

closeSigZoom.addEventListener('click', () => sigZoomModal.classList.add('hidden'));
sigZoomModal.addEventListener('click', (e) => {
  if (e.target === sigZoomModal) sigZoomModal.classList.add('hidden');
});

// ---- Signature pad ----

const canvas = document.getElementById('sigPad');
const ctx = canvas.getContext('2d');
let drawing = false;
let hasStroke = false;

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = rect.width * ratio;
  canvas.height = rect.height * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#1f2430';
}

function getPos(evt) {
  const rect = canvas.getBoundingClientRect();
  return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
}

canvas.addEventListener('pointerdown', (e) => {
  drawing = true;
  hasStroke = true;
  canvas.setPointerCapture(e.pointerId);
  const p = getPos(e);
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
});

canvas.addEventListener('pointermove', (e) => {
  if (!drawing) return;
  const p = getPos(e);
  ctx.lineTo(p.x, p.y);
  ctx.stroke();
});

function stopDrawing() { drawing = false; }
canvas.addEventListener('pointerup', stopDrawing);
canvas.addEventListener('pointercancel', stopDrawing);
canvas.addEventListener('pointerleave', stopDrawing);

document.getElementById('clearSig').addEventListener('click', () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  hasStroke = false;
});

// ---- Modal open/close ----

function openModal() {
  entryForm.reset();
  entryError.classList.add('hidden');
  entryModal.classList.remove('hidden');
  requestAnimationFrame(() => {
    resizeCanvas();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasStroke = false;
  });
}

function closeEntryModal() {
  entryModal.classList.add('hidden');
}

addEntryBtn.addEventListener('click', openModal);
closeModal.addEventListener('click', closeEntryModal);
entryModal.addEventListener('click', (e) => {
  if (e.target === entryModal) closeEntryModal();
});

entryForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  entryError.classList.add('hidden');

  if (!hasStroke) {
    entryError.textContent = 'Please provide a signature.';
    entryError.classList.remove('hidden');
    return;
  }

  const name = document.getElementById('name').value;
  const idNumber = document.getElementById('idNumber').value;
  const signature = canvas.toDataURL('image/png');

  saveEntryBtn.disabled = true;
  saveEntryBtn.textContent = 'Saving...';

  try {
    const res = await apiFetch(`/api/contracts/${contractId}/entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, idNumber, signature })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to save entry');
    }
    closeEntryModal();
    await loadEntries();
  } catch (err) {
    entryError.textContent = err.message;
    entryError.classList.remove('hidden');
  } finally {
    saveEntryBtn.disabled = false;
    saveEntryBtn.textContent = 'Save entry';
  }
});

loadContract();
loadEntries();
