const contractList = document.getElementById('contractList');
const emptyState = document.getElementById('emptyState');
const uploadForm = document.getElementById('uploadForm');
const uploadBtn = document.getElementById('uploadBtn');
const uploadError = document.getElementById('uploadError');

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

async function loadContracts() {
  const res = await apiFetch('/api/contracts');
  const contracts = await res.json();

  contractList.innerHTML = '';
  emptyState.classList.toggle('hidden', contracts.length > 0);

  for (const c of contracts) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `contract.html?id=${encodeURIComponent(c.id)}`;
    a.innerHTML = `
      <span>
        <strong>${escapeHtml(c.title)}</strong><br>
        <span class="meta">Uploaded ${fmtDate(c.uploadedAt)}</span>
      </span>
      <span class="badge">${c.entryCount} sign${c.entryCount === 1 ? '' : 's'}</span>
    `;
    li.appendChild(a);
    contractList.appendChild(li);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

uploadForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  uploadError.classList.add('hidden');

  const fileInput = document.getElementById('file');
  if (!fileInput.files.length) return;

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  formData.append('title', document.getElementById('title').value);

  uploadBtn.disabled = true;
  uploadBtn.textContent = 'Uploading...';

  try {
    const res = await apiFetch('/api/contracts', { method: 'POST', body: formData });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Upload failed');
    }
    uploadForm.reset();
    await loadContracts();
  } catch (err) {
    uploadError.textContent = err.message;
    uploadError.classList.remove('hidden');
  } finally {
    uploadBtn.disabled = false;
    uploadBtn.textContent = 'Upload contract';
  }
});

loadContracts();
