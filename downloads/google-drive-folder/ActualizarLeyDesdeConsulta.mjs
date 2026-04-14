#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { initChatModel } from 'langchain/chat_models/universal';

const ROOT = '/root/.openclaw/workspace/downloads/google-drive-folder';
const BCN_DIR = path.join(ROOT, 'limpiar-bcn');
const HTML_DIR = path.join(BCN_DIR, 'html_bcn');
const TXT_DIR = path.join(ROOT, 'texto_limpio');
const DOWNLOADER = path.join(BCN_DIR, 'DescargarLeyesChile_portable.py');
const CLEANER = path.join(BCN_DIR, 'extraer_texto.py');
const UPLOADER = path.join(ROOT, 'SubirColeccionLeyesIncremental.mjs');
const MODEL_NAME = process.env.LEGAL_GRAPH_MODEL || 'openai:gpt-4.1-mini';

function slugify(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ñ/gi, 'n')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'norma';
}

function loadLibrary() {
  const source = fs.readFileSync(DOWNLOADER, 'utf8');
  const match = source.match(/biblioteca_maestra\s*=\s*\{([\s\S]*?)\n\}/);
  if (!match) throw new Error('No pude leer biblioteca_maestra');
  const lines = match[1].split('\n').map((l) => l.trim()).filter(Boolean).filter((l) => !l.startsWith('#'));
  const entries = [];
  for (const line of lines) {
    const m = line.match(/^"([^"]+)"\s*:\s*"([^"]+)"/);
    if (m) entries.push({ key: m[1], normaId: m[2], label: m[1].replace(/_/g, ' ') });
  }
  return entries;
}

async function tryResolveWithLLM(query, library) {
  try {
    const model = await initChatModel(MODEL_NAME);
    const prompt = [
      'Eres un resolvedor de leyes chilenas para BCN Chile.',
      'Debes devolver JSON estricto con esta forma:',
      '{"found": boolean, "key": string|null, "normaId": string|null, "name": string|null, "reason": string}',
      'Solo puedes elegir una ley desde esta biblioteca maestra. Si no estás razonablemente seguro, found=false.',
      'Biblioteca:',
      JSON.stringify(library, null, 2),
      'Consulta del usuario:',
      query,
    ].join('\n');
    const response = await model.invoke(prompt);
    const text = typeof response?.content === 'string' ? response.content : Array.isArray(response?.content) ? response.content.map((c) => c?.text || '').join('\n') : String(response?.content || '');
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed || typeof parsed.found !== 'boolean') return null;
    return parsed;
  } catch {
    return null;
  }
}

function resolveHeuristic(query, library) {
  const q = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  let best = null;
  for (const item of library) {
    const label = item.label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const tokens = label.split(/\s+/).filter((t) => t.length > 2);
    let score = 0;
    for (const token of tokens) if (q.includes(token)) score += 1;
    if (q.includes(item.normaId)) score += 5;
    if (!best || score > best.score) best = { ...item, score };
  }
  if (!best || best.score < 2) {
    return { found: false, key: null, normaId: null, name: null, reason: 'Sin match confiable en biblioteca maestra' };
  }
  return { found: true, key: best.key, normaId: best.normaId, name: best.label, reason: `Match heurístico score=${best.score}` };
}

function runOrThrow(command, args, label) {
  const result = spawnSync(command, args, { stdio: 'pipe', encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${label} falló\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return result;
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const dryRun = rawArgs.includes('--dry-run');
  const query = rawArgs.filter((arg) => arg !== '--dry-run').join(' ').trim();
  if (!query) {
    console.error('Uso: node ActualizarLeyDesdeConsulta.mjs [--dry-run] "consulta de ley"');
    process.exit(1);
  }

  fs.mkdirSync(HTML_DIR, { recursive: true });
  fs.mkdirSync(TXT_DIR, { recursive: true });

  const library = loadLibrary();
  const llmResolution = await tryResolveWithLLM(query, library);
  const resolution = llmResolution && llmResolution.found ? llmResolution : resolveHeuristic(query, library);

  if (!resolution.found || !resolution.normaId) {
    console.log(JSON.stringify({ ok: false, stage: 'resolve', query, resolution }, null, 2));
    process.exit(2);
  }

  const safeName = slugify(resolution.key || resolution.name || `norma_${resolution.normaId}`);
  const payload = {
    ok: true,
    dryRun,
    query,
    resolution,
    files: {
      htmlDir: HTML_DIR,
      txtDir: TXT_DIR,
      expectedHtml: path.join(HTML_DIR, `${safeName}_${resolution.normaId}.html`),
      expectedTxtPrefix: `${safeName}_${resolution.normaId}`,
      expectedTxt: path.join(TXT_DIR, `${safeName}_${resolution.normaId}.txt`),
    },
  };

  if (dryRun) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const download = runOrThrow('python3', [DOWNLOADER, '--html-dir', HTML_DIR, '--norma-id', resolution.normaId, '--name', safeName], 'descarga BCN');
  const clean = runOrThrow('python3', [CLEANER, '--html-dir', HTML_DIR, '--output-dir', TXT_DIR], 'limpieza texto');
  const targetTxt = `${safeName}_${resolution.normaId}.txt`;
  const upload = runOrThrow('node', [UPLOADER, '--file', targetTxt], 'carga Qdrant');

  payload.steps = {
    download: download.stdout.trim(),
    clean: clean.stdout.trim(),
    upload: upload.stdout.trim(),
  };

  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
