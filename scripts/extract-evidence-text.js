const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const { PDFParse } = require('pdf-parse');
const Tesseract = require('tesseract.js');

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'sin-nombre';
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readUtf8Safe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (['.txt', '.md', '.csv', '.json'].includes(ext)) {
    return { text: readUtf8Safe(filePath), method: 'plain-text' };
  }

  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ path: filePath });
    return { text: result.value || '', method: 'mammoth-docx' };
  }

  if (ext === '.pdf') {
    const dataBuffer = fs.readFileSync(filePath);
    const parser = new PDFParse({ data: dataBuffer });
    const result = await parser.getText();
    await parser.destroy();
    return { text: result.text || '', method: 'pdf-parse' };
  }

  if (['.png', '.jpg', '.jpeg', '.webp', '.tiff', '.bmp'].includes(ext)) {
    const result = await Tesseract.recognize(filePath, 'spa+eng');
    return { text: result.data?.text || '', method: 'tesseract-ocr' };
  }

  if (['.mp3', '.wav', '.m4a', '.ogg'].includes(ext)) {
    return {
      text: [
        `archivo_original: ${path.basename(filePath)}`,
        `estado_extraccion: pendiente`,
        'motivo: no hay motor local de transcripción instalado en este flujo todavía',
        'accion_requerida: transcribir audio antes de indexar en Qdrant',
      ].join('\n'),
      method: 'audio-placeholder',
    };
  }

  return {
    text: [
      `archivo_original: ${path.basename(filePath)}`,
      `estado_extraccion: pendiente`,
      `motivo: formato no soportado automaticamente (${ext || 'sin-extension'})`,
      'accion_requerida: convertir a texto limpio antes de indexar en Qdrant',
    ].join('\n'),
    method: 'unsupported-placeholder',
  };
}

async function main() {
  const [, , sourceFile, outDirArg] = process.argv;
  if (!sourceFile) {
    console.error('Uso: node scripts/extract-evidence-text.js /ruta/al/archivo [directorio-salida]');
    process.exit(1);
  }

  const absSource = path.resolve(sourceFile);
  if (!fs.existsSync(absSource)) {
    console.error(`No existe el archivo fuente: ${absSource}`);
    process.exit(1);
  }

  const outDir = outDirArg ? path.resolve(outDirArg) : path.dirname(absSource);
  ensureDir(outDir);

  const stem = slugify(path.basename(absSource, path.extname(absSource)));
  const outPath = path.join(outDir, `${stem}.txt`);
  const { text, method } = await extractText(absSource);
  fs.writeFileSync(outPath, (text || '').trim() + '\n', 'utf8');

  console.log(JSON.stringify({ ok: true, source: absSource, outPath, method }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
