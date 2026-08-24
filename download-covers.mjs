import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const CSV_PATH = path.join(ROOT, 'telenovelas.csv');
const COVERS_DIR = path.join(ROOT, 'covers');

function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (c === '"' && quoted && next === '"') {
      cell += '"'; i++; continue;
    }
    if (c === '"') { quoted = !quoted; continue; }
    if (c === ',' && !quoted) {
      row.push(cell.trim()); cell = ''; continue;
    }
    if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && next === '\n') i++;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; cell = ''; continue;
    }
    cell += c;
  }
  if (cell || row.length) {
    row.push(cell.trim());
    if (row.some(Boolean)) rows.push(row);
  }
  return rows;
}

function serializeCSV(rows) {
  return rows.map(row => row.map(cell => {
    const s = String(cell ?? '');
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }).join(',')).join('\n') + '\n';
}

function slugify(title) {
  return String(title)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'sin-titulo';
}

function extractFileId(url) {
  const m = String(url).match(/\/file\/d\/([^/]+)/);
  return m ? m[1] : '';
}

function isImageBuffer(buf) {
  if (!buf || buf.length < 12) return false;
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  // WEBP
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
    && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'webp';
  // GIF
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'gif';
  return false;
}

async function fetchDriveFile(fileId) {
  const url = `https://drive.google.com/uc?export=download&id=${fileId}`;
  let res = await fetch(url, { redirect: 'follow' });
  let buf = Buffer.from(await res.arrayBuffer());
  const asText = buf.slice(0, 800).toString('utf8');

  if (asText.includes('confirm=') || asText.includes('download_warning') || asText.includes('uc-download-link')) {
    const confirm =
      (asText.match(/confirm=([0-9A-Za-z_-]+)/) || [])[1] ||
      (asText.match(/name="confirm"\s+value="([^"]+)"/) || [])[1];
    const uuid = (asText.match(/name="uuid"\s+value="([^"]+)"/) || [])[1];
    const next = new URL(`https://drive.google.com/uc`);
    next.searchParams.set('export', 'download');
    next.searchParams.set('id', fileId);
    if (confirm) next.searchParams.set('confirm', confirm);
    if (uuid) next.searchParams.set('uuid', uuid);
    res = await fetch(next.toString(), { redirect: 'follow' });
    buf = Buffer.from(await res.arrayBuffer());
  }

  // Alternate: lh3 thumbnail-style direct content sometimes works for images
  const kind = isImageBuffer(buf);
  if (!kind) {
    const alt = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;
    res = await fetch(alt, { redirect: 'follow' });
    buf = Buffer.from(await res.arrayBuffer());
  }

  return buf;
}

async function main() {
  fs.mkdirSync(COVERS_DIR, { recursive: true });
  const text = fs.readFileSync(CSV_PATH, 'utf8');
  const rows = parseCSV(text);
  if (!rows.length) throw new Error('CSV vacío');

  const headers = rows[0].map(h => h.toLowerCase());
  const imgIdx = headers.findIndex(h => h.includes('imagen'));
  const titleIdx = headers.findIndex(h => h.includes('novela')) || 0;
  if (imgIdx < 0) throw new Error('No encontré columna IMAGEN');

  const ok = [];
  const fail = [];
  const usedSlugs = new Map();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const title = row[titleIdx] || `fila-${i}`;
    let slug = slugify(title);
    if (usedSlugs.has(slug)) {
      const n = usedSlugs.get(slug) + 1;
      usedSlugs.set(slug, n);
      slug = `${slug}-${n}`;
    } else {
      usedSlugs.set(slug, 1);
    }

    const imagen = row[imgIdx] || '';
    const fileId = extractFileId(imagen);

    if (!fileId) {
      if (imagen.startsWith('covers/')) {
        console.log(`skip (ya local) ${title}`);
        ok.push(title);
        continue;
      }
      console.log(`FAIL ${title} — sin Drive ID`);
      fail.push({ title, reason: 'sin Drive ID' });
      continue;
    }

    process.stdout.write(`↓ ${title} ... `);
    try {
      const buf = await fetchDriveFile(fileId);
      const kind = isImageBuffer(buf);
      if (!kind) {
        console.log('FAIL (no es imagen)');
        fail.push({ title, reason: 'respuesta no es imagen', fileId });
        continue;
      }
      // Always save as .jpg path for CSV consistency; keep real bytes
      const outName = `${slug}.jpg`;
      const outPath = path.join(COVERS_DIR, outName);
      // If PNG/WebP, still write bytes but name .jpg only if jpeg; else use real ext in filename
      let finalName = outName;
      let finalPath = outPath;
      if (kind !== 'jpg') {
        finalName = `${slug}.${kind}`;
        finalPath = path.join(COVERS_DIR, finalName);
      }
      fs.writeFileSync(finalPath, buf);
      row[imgIdx] = `covers/${finalName}`;
      console.log(`OK → covers/${finalName} (${buf.length} bytes)`);
      ok.push(title);
    } catch (err) {
      console.log(`FAIL (${err.message})`);
      fail.push({ title, reason: err.message, fileId });
    }

    // gentle rate limit
    await new Promise(r => setTimeout(r, 400));
  }

  fs.writeFileSync(CSV_PATH, serializeCSV(rows), 'utf8');

  console.log('\n—— Resumen ——');
  console.log(`OK: ${ok.length}`);
  console.log(`FAIL: ${fail.length}`);
  if (fail.length) {
    console.log('Fallidas:');
    fail.forEach(f => console.log(`  - ${f.title}: ${f.reason}`));
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
