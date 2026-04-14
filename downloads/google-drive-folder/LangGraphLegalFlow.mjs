import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { pipeline } from '@huggingface/transformers';
import { Embeddings } from '@langchain/core/embeddings';
import { QdrantVectorStore } from '@langchain/qdrant';
import { StateGraph, END } from '@langchain/langgraph';

const QDRANT_URL = 'http://127.0.0.1:6333';
const DEFAULT_COLLECTION = 'normativas_chile';
const MODELO_EMBEDDINGS = 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2';
const MAX_QDRANT_ATTEMPTS = 3;
const MIN_CONFIDENCE_TO_SEND = 0.95;
const EVAL_SERVICE = new URL('./LegalEvalService.mjs', import.meta.url);

class HuggingFaceLocalEmbeddings extends Embeddings {
  constructor(fields = {}) {
    super(fields);
    this.extractorPromise = null;
  }
  async getExtractor() {
    if (!this.extractorPromise) this.extractorPromise = pipeline('feature-extraction', MODELO_EMBEDDINGS);
    return this.extractorPromise;
  }
  async embedOne(text) {
    const extractor = await this.getExtractor();
    const output = await extractor(text, { pooling: 'mean', normalize: false });
    const raw = output.tolist();
    return Array.isArray(raw[0]) ? raw[0] : raw;
  }
  async embedDocuments(texts) {
    const out = [];
    for (const text of texts) out.push(await this.embedOne(text));
    return out;
  }
  async embedQuery(text) {
    return this.embedOne(text);
  }
}

function callEvalService(mode, payload) {
  const out = execFileSync('node', [EVAL_SERVICE.pathname, mode], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    env: process.env,
  });
  return JSON.parse(out);
}

async function buildStore(collectionName = DEFAULT_COLLECTION) {
  const embeddings = new HuggingFaceLocalEmbeddings();
  return QdrantVectorStore.fromExistingCollection(embeddings, {
    url: QDRANT_URL,
    collectionName,
    contentPayloadKey: 'texto',
    metadataPayloadKey: 'metadata',
  });
}

function normalizeDoc(doc, score) {
  const metadata = doc.metadata || {};
  return {
    score,
    texto: String(doc.pageContent || '').trim(),
    titulo: metadata.titulo || null,
    fuente: metadata.fuente || null,
    articulo: metadata.articulo || null,
    archivo: metadata.archivo || null,
    pagina: metadata.pagina || metadata.page || null,
    parrafo: metadata.parrafo || metadata.paragraph || null,
    chunk_index: metadata.chunk_index ?? null,
    metadata,
  };
}

function buildCitation(fragment) {
  const parts = [];
  if (fragment.titulo) parts.push(`Título: ${fragment.titulo}`);
  if (fragment.articulo) parts.push(`Artículo: ${fragment.articulo}`);
  if (fragment.pagina) parts.push(`Página: ${fragment.pagina}`);
  if (fragment.parrafo) parts.push(`Párrafo: ${fragment.parrafo}`);
  if (fragment.archivo) parts.push(`Archivo: ${fragment.archivo}`);
  return parts.join(' | ') || 'Sin cita enriquecida';
}

async function nodoBusqueda(state) {
  const collection = state.collection || DEFAULT_COLLECTION;
  const store = state.store ?? await buildStore(collection);
  const limit = state.limit ?? 6;
  const results = await store.similaritySearchWithScore(state.question, limit);
  const fragments = results.map(([doc, score]) => normalizeDoc(doc, score));
  return {
    ...state,
    store,
    collection,
    attempts: (state.attempts || 0) + 1,
    fragments,
    history: [...(state.history || []), { stage: 'busqueda', attempt: (state.attempts || 0) + 1, hits: fragments.length, collection }],
  };
}

async function nodoCalificacion(state) {
  const evalResult = callEvalService('qualify', {
    question: state.question,
    fragments: (state.fragments || []).map((f) => ({ score: f.score, texto: f.texto, titulo: f.titulo, articulo: f.articulo })),
  });

  const qualified = (state.fragments || []).map((fragment, idx) => {
    const item = evalResult?.items?.find?.((x) => Number(x.index) === idx) || {};
    return {
      ...fragment,
      relevanceScore: Number(item.relevanceScore || 0),
      isRelevant: Boolean(item.isRelevant),
      qualificationReason: item.reason || 'Sin razón de calificación.',
      qualificationSource: evalResult?.source || 'service',
    };
  });

  const relevant = qualified.filter((x) => x.isRelevant);
  return {
    ...state,
    fragments: qualified,
    relevantFragments: relevant,
    needsRetry: relevant.length === 0,
    history: [...(state.history || []), { stage: 'calificacion', relevant: relevant.length, total: qualified.length, source: evalResult?.source || 'service' }],
  };
}

async function nodoRespuesta(state) {
  const top = (state.relevantFragments || []).slice(0, 4);
  const evalResult = callEvalService('draft', {
    question: state.question,
    fragments: top.map((f) => ({
      cita: buildCitation(f),
      score: f.score,
      relevanceScore: f.relevanceScore,
      articulo: f.articulo,
      texto: f.texto,
    })),
  });

  return {
    ...state,
    draftAnswer: evalResult.answer,
    citedAnswer: evalResult.answer,
    history: [...(state.history || []), { stage: 'respuesta', citedFragments: top.length, source: evalResult?.source || 'service' }],
  };
}

async function nodoContraste(state) {
  const evalResult = callEvalService('contrast', {
    question: state.question,
    answer: state.draftAnswer,
    fragments: (state.relevantFragments || []).map((f) => ({
      cita: buildCitation(f),
      articulo: f.articulo,
      relevanceScore: f.relevanceScore,
      score: f.score,
      texto: f.texto,
    })),
  });

  return {
    ...state,
    supported: Boolean(evalResult.supported),
    avgRelevance: Number(evalResult.confidence || 0),
    unsupportedSignals: evalResult.unsupportedSignals || [],
    history: [...(state.history || []), { stage: 'contraste', supported: Boolean(evalResult.supported), avgRelevance: Number(evalResult.confidence || 0), unsupportedSignals: evalResult.unsupportedSignals || [], source: evalResult?.source || 'service' }],
  };
}

function nodoVerificacion(state) {
  const confidence = state.supported ? Math.min(0.99, Math.max(Number(state.avgRelevance || 0), 0)) : 0.2;
  const shouldSend = confidence >= MIN_CONFIDENCE_TO_SEND;
  return {
    ...state,
    mode: state.mode || (state.collection && state.collection !== DEFAULT_COLLECTION ? 'cliente' : 'normas'),
    confidence,
    shouldSend,
    history: [...(state.history || []), { stage: 'verificacion', confidence, shouldSend }],
  };
}

function nodoBCN(state) {
  const isClientMode = (state.mode === 'cliente') || (state.collection && state.collection !== DEFAULT_COLLECTION);
  return {
    ...state,
    fallbackToBCN: !isClientMode,
    needsHumanReview: Boolean(isClientMode),
    history: [...(state.history || []), {
      stage: 'fallback_bcn',
      reason: isClientMode
        ? 'Sin certeza suficiente tras tres intentos en Qdrant del cliente'
        : 'Sin certeza suficiente tras tres intentos en Qdrant'
    }],
  };
}

function routeAfterCalificacion(state) {
  if (state.needsRetry && (state.attempts || 0) < MAX_QDRANT_ATTEMPTS) return 'busqueda';
  if (state.needsRetry && (state.attempts || 0) >= MAX_QDRANT_ATTEMPTS) return 'fallback_bcn';
  return 'respuesta';
}

function routeAfterContraste(state) {
  if (!state.supported && (state.attempts || 0) < MAX_QDRANT_ATTEMPTS) return 'busqueda';
  if (!state.supported && (state.attempts || 0) >= MAX_QDRANT_ATTEMPTS) return 'fallback_bcn';
  return 'verificacion';
}

function routeAfterVerificacion(state) {
  if (state.shouldSend) return END;
  if ((state.attempts || 0) < MAX_QDRANT_ATTEMPTS) return 'busqueda';
  return 'fallback_bcn';
}

export async function buildLegalNormsGraph() {
  const graph = new StateGraph({
    channels: {
      question: null,
      mode: null,
      collection: null,
      limit: null,
      store: null,
      attempts: null,
      fragments: null,
      relevantFragments: null,
      draftAnswer: null,
      citedAnswer: null,
      supported: null,
      avgRelevance: null,
      unsupportedSignals: null,
      confidence: null,
      shouldSend: null,
      fallbackToBCN: null,
      history: null,
      needsRetry: null,
    },
  });

  graph.addNode('busqueda', nodoBusqueda);
  graph.addNode('calificacion', nodoCalificacion);
  graph.addNode('respuesta', nodoRespuesta);
  graph.addNode('contraste', nodoContraste);
  graph.addNode('verificacion', nodoVerificacion);
  graph.addNode('fallback_bcn', nodoBCN);

  graph.setEntryPoint('busqueda');
  graph.addEdge('busqueda', 'calificacion');
  graph.addConditionalEdges('calificacion', routeAfterCalificacion, ['busqueda', 'respuesta', 'fallback_bcn']);
  graph.addEdge('respuesta', 'contraste');
  graph.addConditionalEdges('contraste', routeAfterContraste, ['busqueda', 'verificacion', 'fallback_bcn']);
  graph.addConditionalEdges('verificacion', routeAfterVerificacion, ['busqueda', 'fallback_bcn', END]);
  graph.addEdge('fallback_bcn', END);

  return graph.compile();
}

async function main() {
  const argv = process.argv.slice(2);
  let question = '';
  let collection = DEFAULT_COLLECTION;
  let mode = 'normas';
  let limit = 6;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--collection') {
      collection = argv[++i] || collection;
    } else if (token === '--mode') {
      mode = argv[++i] || mode;
    } else if (token === '--user-collection') {
      collection = argv[++i] || collection;
      mode = 'cliente';
    } else if (token === '--limit') {
      limit = Number(argv[++i] || limit);
    } else if (!token.startsWith('--')) {
      question += `${question ? ' ' : ''}${token}`;
    }
  }

  question = question.trim();
  if (!question) {
    console.error('Uso: node LangGraphLegalFlow.mjs [--mode normas|cliente] [--collection nombre] [--limit n] "consulta jurídica"');
    process.exit(1);
  }

  const app = await buildLegalNormsGraph();
  const result = await app.invoke({ question, mode, collection, limit, attempts: 0, history: [] });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}
