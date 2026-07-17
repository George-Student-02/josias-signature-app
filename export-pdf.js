const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const mammoth = require('mammoth');

const A4 = [595.28, 841.89];
const MARGIN = 50;

// The standard PDF fonts only cover WinAnsi. Anything outside it (smart quotes,
// dashes pasted from Word) would otherwise throw while drawing.
const WINANSI_REPLACEMENTS = {
  '‘': "'", '’': "'", '“': '"', '”': '"',
  '–': '-', '—': '-', '…': '...', ' ': ' ',
  '•': '-', '‹': '<', '›': '>', '™': '(TM)'
};

function sanitize(text) {
  return String(text)
    .replace(/[‘’“”–—… •‹›™]/g, (c) => WINANSI_REPLACEMENTS[c])
    .replace(/\t/g, '    ')
    // Drop anything still outside the encodable range rather than crash the export.
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '');
}

function wrapText(text, font, size, maxWidth) {
  const lines = [];
  for (const paragraph of sanitize(text).split('\n')) {
    if (!paragraph.trim()) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
      } else {
        if (line) lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(',')[1] || '';
  return Buffer.from(base64, 'base64');
}

function fmtDate(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function addContractPages(pdf, contract, fileBytes, font, bold) {
  const mime = contract.mimeType || '';

  if (mime === 'application/pdf') {
    const source = await PDFDocument.load(fileBytes, { ignoreEncryption: true });
    const pages = await pdf.copyPages(source, source.getPageIndices());
    pages.forEach((p) => pdf.addPage(p));
    return { converted: false };
  }

  if (mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/jpg') {
    const image = mime === 'image/png'
      ? await pdf.embedPng(fileBytes)
      : await pdf.embedJpg(fileBytes);
    const page = pdf.addPage(A4);
    const maxW = A4[0] - MARGIN * 2;
    const maxH = A4[1] - MARGIN * 2;
    const scale = Math.min(maxW / image.width, maxH / image.height, 1);
    const w = image.width * scale;
    const h = image.height * scale;
    page.drawImage(image, {
      x: (A4[0] - w) / 2,
      y: (A4[1] - h) / 2,
      width: w,
      height: h
    });
    return { converted: false };
  }

  // Word documents: pull the text out. Layout, images and tables are lost, so the
  // export says so rather than silently presenting a degraded contract as the original.
  const isWord = mime.includes('wordprocessingml') || mime === 'application/msword';
  if (isWord) {
    let text = '';
    try {
      const result = await mammoth.extractRawText({ buffer: Buffer.from(fileBytes) });
      text = result.value || '';
    } catch (err) {
      text = '';
    }
    if (!text.trim()) {
      const page = pdf.addPage(A4);
      page.drawText('The text of this Word document could not be read.', {
        x: MARGIN, y: A4[1] - MARGIN - 20, size: 12, font: bold, color: rgb(0.6, 0, 0)
      });
      return { converted: true, failed: true };
    }
    drawTextPages(pdf, text, font, 11);
    return { converted: true, failed: false };
  }

  const page = pdf.addPage(A4);
  page.drawText(`This contract file (${sanitize(contract.originalName)}) cannot be`, {
    x: MARGIN, y: A4[1] - MARGIN - 20, size: 12, font: bold, color: rgb(0.6, 0, 0)
  });
  page.drawText('included in the export. Signatures are listed below.', {
    x: MARGIN, y: A4[1] - MARGIN - 38, size: 12, font: bold, color: rgb(0.6, 0, 0)
  });
  return { converted: true, failed: true };
}

function drawTextPages(pdf, text, font, size) {
  const lineHeight = size * 1.45;
  const maxWidth = A4[0] - MARGIN * 2;
  const lines = wrapText(text, font, size, maxWidth);

  let page = pdf.addPage(A4);
  let y = A4[1] - MARGIN;

  for (const line of lines) {
    if (y < MARGIN) {
      page = pdf.addPage(A4);
      y = A4[1] - MARGIN;
    }
    if (line) {
      page.drawText(line, { x: MARGIN, y, size, font, color: rgb(0, 0, 0) });
    }
    y -= lineHeight;
  }
}

async function addSignaturePages(pdf, entries, font, bold) {
  let page = pdf.addPage(A4);
  let y = A4[1] - MARGIN;

  page.drawText('Signatures', { x: MARGIN, y, size: 18, font: bold });
  y -= 10;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: A4[0] - MARGIN, y },
    thickness: 1,
    color: rgb(0.8, 0.8, 0.8)
  });
  y -= 26;

  if (!entries.length) {
    page.drawText('No one has signed this contract yet.', {
      x: MARGIN, y, size: 12, font, color: rgb(0.4, 0.4, 0.4)
    });
    return;
  }

  const BLOCK_HEIGHT = 108;

  for (const entry of entries) {
    if (y - BLOCK_HEIGHT < MARGIN) {
      page = pdf.addPage(A4);
      y = A4[1] - MARGIN;
    }

    page.drawText(sanitize(entry.name), { x: MARGIN, y, size: 13, font: bold });
    y -= 17;
    page.drawText(`ID Number: ${sanitize(entry.idNumber)}`, { x: MARGIN, y, size: 11, font });
    y -= 15;
    page.drawText(`Signed: ${fmtDate(entry.createdAt)}`, {
      x: MARGIN, y, size: 10, font, color: rgb(0.4, 0.4, 0.4)
    });
    y -= 8;

    try {
      const image = await pdf.embedPng(dataUrlToBytes(entry.signature));
      const maxW = 200;
      const maxH = 55;
      const scale = Math.min(maxW / image.width, maxH / image.height, 1);
      const w = image.width * scale;
      const h = image.height * scale;
      page.drawImage(image, { x: MARGIN, y: y - h, width: w, height: h });
      y -= h + 6;
    } catch (err) {
      page.drawText('(signature image could not be rendered)', {
        x: MARGIN, y: y - 12, size: 9, font, color: rgb(0.6, 0, 0)
      });
      y -= 20;
    }

    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: A4[0] - MARGIN, y },
      thickness: 0.5,
      color: rgb(0.85, 0.85, 0.85)
    });
    y -= 22;
  }
}

async function buildExportPdf({ contract, fileBytes, entries }) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const result = await addContractPages(pdf, contract, fileBytes, font, bold);
  await addSignaturePages(pdf, entries, font, bold);

  pdf.setTitle(sanitize(contract.title));
  return { bytes: await pdf.save(), ...result };
}

module.exports = { buildExportPdf };
