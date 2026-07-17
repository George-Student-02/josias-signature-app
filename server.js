require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('cookie-session');
const multer = require('multer');
const supabase = require('./supabase');
const { buildExportPdf } = require('./export-pdf');

const BUCKET = 'contracts';
const app = express();
app.set('trust proxy', 1);

app.use(express.json({ limit: '10mb' })); // signatures are base64 PNGs
// The session lives in a signed cookie, not in server memory: the free hosting plan
// sleeps and restarts the app constantly, and an in-memory store would log everyone
// out every time that happened.
app.use(session({
  name: 'sess',
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 30 * 24 * 60 * 60 * 1000
}));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB
});

function requireAuth(req, res, next) {
  if (req.session && req.session.authed) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

function toClientContract(c) {
  return {
    id: c.id,
    title: c.title,
    originalName: c.original_name,
    mimeType: c.mime_type,
    uploadedAt: c.uploaded_at
  };
}

function toClientEntry(e) {
  return {
    id: e.id,
    contractId: e.contract_id,
    name: e.name,
    idNumber: e.id_number,
    signature: e.signature,
    createdAt: e.created_at
  };
}

// ---- Auth ----

app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (!process.env.APP_PASSWORD) {
    return res.status(500).json({ error: 'Server is missing APP_PASSWORD config' });
  }
  if (password && password === process.env.APP_PASSWORD) {
    req.session.authed = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Incorrect password' });
});

app.post('/api/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.get('/api/session', (req, res) => {
  res.json({ authed: !!(req.session && req.session.authed) });
});

// ---- Contracts ----

app.get('/api/contracts', requireAuth, async (req, res) => {
  const { data: contracts, error } = await supabase
    .from('contracts')
    .select('*')
    .order('uploaded_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  const { data: entries, error: entriesError } = await supabase.from('entries').select('contract_id');
  if (entriesError) return res.status(500).json({ error: entriesError.message });

  const counts = {};
  for (const e of entries) counts[e.contract_id] = (counts[e.contract_id] || 0) + 1;

  res.json(contracts.map((c) => ({ ...toClientContract(c), entryCount: counts[c.id] || 0 })));
});

app.post('/api/contracts', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const id = crypto.randomUUID();
  const ext = path.extname(req.file.originalname);
  const storagePath = `${id}${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype });
  if (uploadError) return res.status(500).json({ error: uploadError.message });

  const { data, error } = await supabase
    .from('contracts')
    .insert({
      id,
      title: (req.body.title || req.file.originalname).trim(),
      original_name: req.file.originalname,
      storage_path: storagePath,
      mime_type: req.file.mimetype
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });

  res.status(201).json(toClientContract(data));
});

app.get('/api/contracts/:id', requireAuth, async (req, res) => {
  const { data: contract, error } = await supabase
    .from('contracts')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (error || !contract) return res.status(404).json({ error: 'Contract not found' });
  res.json(toClientContract(contract));
});

app.patch('/api/contracts/:id', requireAuth, async (req, res) => {
  const { title } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: 'Title cannot be empty' });

  const { data, error } = await supabase
    .from('contracts')
    .update({ title: title.trim() })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error || !data) return res.status(404).json({ error: 'Contract not found' });

  res.json(toClientContract(data));
});

app.get('/api/contracts/:id/file', requireAuth, async (req, res) => {
  const { data: contract, error } = await supabase
    .from('contracts')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (error || !contract) return res.status(404).json({ error: 'Contract not found' });

  const { data: blob, error: downloadError } = await supabase.storage
    .from(BUCKET)
    .download(contract.storage_path);
  if (downloadError) return res.status(404).json({ error: 'File missing' });

  const buffer = Buffer.from(await blob.arrayBuffer());
  res.setHeader('Content-Type', contract.mime_type);
  res.send(buffer);
});

app.get('/api/contracts/:id/export', requireAuth, async (req, res) => {
  const { data: contract, error } = await supabase
    .from('contracts')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (error || !contract) return res.status(404).json({ error: 'Contract not found' });

  const { data: blob, error: downloadError } = await supabase.storage
    .from(BUCKET)
    .download(contract.storage_path);
  if (downloadError) return res.status(404).json({ error: 'Contract file is missing' });

  const { data: entries, error: entriesError } = await supabase
    .from('entries')
    .select('*')
    .eq('contract_id', req.params.id)
    .order('created_at', { ascending: true });
  if (entriesError) return res.status(500).json({ error: entriesError.message });

  try {
    const { bytes } = await buildExportPdf({
      contract: toClientContract(contract),
      fileBytes: Buffer.from(await blob.arrayBuffer()),
      entries: (entries || []).map(toClientEntry)
    });

    const safeName = contract.title.replace(/[^a-z0-9\-_ ]/gi, '').trim() || 'contract';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.pdf"`);
    res.send(Buffer.from(bytes));
  } catch (err) {
    console.error('Export failed:', err);
    res.status(500).json({ error: 'Could not build the export PDF.' });
  }
});

app.delete('/api/contracts/:id', requireAuth, async (req, res) => {
  const { data: contract, error } = await supabase
    .from('contracts')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (error || !contract) return res.status(404).json({ error: 'Contract not found' });

  await supabase.storage.from(BUCKET).remove([contract.storage_path]);
  await supabase.from('contracts').delete().eq('id', req.params.id);
  res.status(204).end();
});

// ---- Entries (name, id number, signature) ----

app.get('/api/contracts/:id/entries', requireAuth, async (req, res) => {
  const { data: contract, error: contractError } = await supabase
    .from('contracts')
    .select('id')
    .eq('id', req.params.id)
    .single();
  if (contractError || !contract) return res.status(404).json({ error: 'Contract not found' });

  const { data: entries, error } = await supabase
    .from('entries')
    .select('*')
    .eq('contract_id', req.params.id)
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });

  res.json(entries.map(toClientEntry));
});

app.post('/api/contracts/:id/entries', requireAuth, async (req, res) => {
  const { data: contract, error: contractError } = await supabase
    .from('contracts')
    .select('id')
    .eq('id', req.params.id)
    .single();
  if (contractError || !contract) return res.status(404).json({ error: 'Contract not found' });

  const { name, idNumber, signature } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  if (!idNumber || !idNumber.trim()) return res.status(400).json({ error: 'ID number is required' });
  if (!signature || !signature.startsWith('data:image/')) {
    return res.status(400).json({ error: 'Signature is required' });
  }

  const { data, error } = await supabase
    .from('entries')
    .insert({
      id: crypto.randomUUID(),
      contract_id: req.params.id,
      name: name.trim(),
      id_number: idNumber.trim(),
      signature
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });

  res.status(201).json(toClientEntry(data));
});

app.delete('/api/entries/:id', requireAuth, async (req, res) => {
  const { error, count } = await supabase
    .from('entries')
    .delete({ count: 'exact' })
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  if (!count) return res.status(404).json({ error: 'Entry not found' });
  res.status(204).end();
});

// Static files last, so /api/* above always takes precedence.
app.use(express.static(path.join(__dirname, 'public')));

// Turn upload failures into clean JSON instead of Express's default HTML stack trace.
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'That file is too big. The limit is 25MB.'
      : `Upload problem: ${err.message}`;
    return res.status(400).json({ error: message });
  }
  if (err) {
    console.error(err);
    return res.status(500).json({ error: 'Something went wrong on the server.' });
  }
  next();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Signature app running on port ${PORT}`);
});
