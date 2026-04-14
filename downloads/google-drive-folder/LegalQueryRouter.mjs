#!/usr/bin/env node
import process from 'node:process';
import { initChatModel } from 'langchain';

const AI_MODEL = process.env.LEGAL_GRAPH_MODEL || 'openai:gpt-4.1-mini';
const DEFAULT_COLLECTION = 'normativas_chile';

function tryBuildModel() {
  try {
    return initChatModel(AI_MODEL);
  } catch {
    return null;
  }
}

async function askJson(model, system, payload) {
  if (!model) return null;
  try {
    const response = await model.invoke([
      ['system', `${system}\nResponde solo JSON válido.`],
      ['human', JSON.stringify(payload)],
    ]);
    const text = typeof response?.content === 'string'
      ? response.content
      : Array.isArray(response?.content)
        ? response.content.map((x) => x?.text || '').join(' ')
        : '';
    const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```/, '').replace(/```$/, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function heuristicRoute({ question, collection, userCollection }) {
  const q = String(question || '').toLowerCase();
  const hasClientCollection = Boolean(userCollection || (collection && collection !== DEFAULT_COLLECTION));
  const documentSignals = [
    'cláusula', 'contrato', 'anexo', 'pdf', 'word', 'docx', 'escritura', 'mandato', 'pagaré', 'pagare',
    'archivo', 'documento', 'carpeta', 'cliente', 'compraventa', 'arrendamiento', 'salida anticipada',
  ];
  const legalSignals = [
    'ley', 'codigo', 'código', 'artículo', 'articulo', 'norma', 'constitución', 'constitucion', 'bcn', 'ley chile',
    'estatuto', 'decreto', 'reglamento',
  ];

  const docScore = documentSignals.reduce((acc, token) => acc + (q.includes(token) ? 1 : 0), 0);
  const legalScore = legalSignals.reduce((acc, token) => acc + (q.includes(token) ? 1 : 0), 0);

  if (hasClientCollection && docScore >= legalScore) {
    return {
      mode: 'cliente',
      collection: userCollection || collection,
      confidence: Math.min(0.95, 0.65 + (docScore * 0.08)),
      reason: 'Heurística: consulta parece referirse a documentos del cliente.',
      source: 'heuristic',
    };
  }

  return {
    mode: 'normas',
    collection: DEFAULT_COLLECTION,
    confidence: Math.min(0.95, 0.65 + (legalScore * 0.08)),
    reason: 'Heurística: consulta parece normativa general.',
    source: 'heuristic',
  };
}

async function route(payload) {
  const model = tryBuildModel();
  const ai = await askJson(model,
    'Clasifica una consulta jurídica entre dos fuentes: normas generales o documentos del cliente. Devuelve {mode,collection,confidence,reason}. Usa modo=cliente solo si la pregunta apunta a contratos, anexos, PDFs, Word u otros documentos del cliente y existe una colección de cliente disponible. Usa modo=normas para leyes, códigos, artículos o normativa general.',
    payload,
  );
  if (ai?.mode && ai?.collection) return { ...ai, source: 'ai' };
  return heuristicRoute(payload);
}

async function main() {
  const raw = await new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
  const payload = raw.trim() ? JSON.parse(raw) : {};
  const result = await route(payload);
  process.stdout.write(JSON.stringify(result));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
