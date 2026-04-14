const fs = require('fs');
const path = require('path');

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

function copyFile(src, dest) {
  fs.copyFileSync(src, dest);
}

function readUtf8Safe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function buildTxtPlaceholder(originalPath, ext, fileName) {
  const lines = [
    `archivo_original: ${fileName}`,
    `extension_original: ${ext || 'sin-extension'}`,
    `estado_extraccion: pendiente_o_manual`,
    '',
    'NOTA:',
    'Este archivo fue ingresado al flujo de evidencia.',
    'Si el formato no es texto plano, aquí debe quedar el texto limpio extraído antes de indexar en Qdrant.',
  ];

  if (ext === '.txt' || ext === '.md' || ext === '.csv' || ext === '.json') {
    const body = readUtf8Safe(originalPath);
    return body || lines.join('\n');
  }

  return lines.join('\n');
}

function main() {
  const [, , userArg, caseArg, sourceFile, dateArg] = process.argv;

  if (!userArg || !caseArg || !sourceFile) {
    console.error('Uso: node scripts/ingest-evidence-file.js "Usuario" "Causa o Asunto" /ruta/al/archivo [YYYY-MM-DD]');
    process.exit(1);
  }

  const absSource = path.resolve(sourceFile);
  if (!fs.existsSync(absSource)) {
    console.error(`No existe el archivo fuente: ${absSource}`);
    process.exit(1);
  }

  const date = dateArg || new Date().toISOString().slice(0, 10);
  const userSlug = slugify(userArg);
  const caseSlug = slugify(caseArg);
  const base = path.join(process.cwd(), 'evidence', userSlug, `${date}_${caseSlug}`);
  const originalsDir = path.join(base, 'originals');
  const extractedDir = path.join(base, 'extracted-text');
  const stagingDir = path.join(base, 'qdrant-staging');
  const notesDir = path.join(base, 'notes');

  [base, originalsDir, extractedDir, stagingDir, notesDir].forEach(ensureDir);

  const ext = path.extname(absSource).toLowerCase();
  const originalName = path.basename(absSource);
  const originalTarget = path.join(originalsDir, originalName);
  copyFile(absSource, originalTarget);

  const stem = slugify(path.basename(absSource, ext));
  const txtName = `${stem}.txt`;
  const extractedTarget = path.join(extractedDir, txtName);
  const stagingTarget = path.join(stagingDir, txtName);

  const txtContent = buildTxtPlaceholder(originalTarget, ext, originalName);
  fs.writeFileSync(extractedTarget, txtContent, 'utf8');
  fs.writeFileSync(stagingTarget, txtContent, 'utf8');

  const manifestPath = path.join(notesDir, 'ingest-manifest.json');
  let manifest = [];
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (!Array.isArray(manifest)) manifest = [];
    } catch {
      manifest = [];
    }
  }

  const record = {
    ingestedAt: new Date().toISOString(),
    userDisplayName: userArg,
    caseDisplayName: caseArg,
    userSlug,
    caseSlug,
    sourceFile: absSource,
    originalStoredAs: originalTarget,
    extractedTextPath: extractedTarget,
    qdrantStagingPath: stagingTarget,
    originalExtension: ext || null,
  };

  manifest.push(record);
  writeJson(manifestPath, manifest);

  console.log(JSON.stringify({ ok: true, base, originalTarget, extractedTarget, stagingTarget, manifestPath }, null, 2));
}

main();
