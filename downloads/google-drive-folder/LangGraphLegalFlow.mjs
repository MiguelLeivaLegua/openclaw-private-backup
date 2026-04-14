import process from 'node:process';
import { pipeline } from '@huggingface/transformers';
import { Embeddings } from '@langchain/core/embeddings';
import { QdrantVectorStore } from '@langchain/qdrant';
import { StateGraph, END } from '@langchain/langgraph';

const QDRANT_URL = 'http://127.0.0.1:6333';
const COLECCION = 'normativas_chile';
const MODELO_EMBEDDINGS = 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2';
const MAX_QDRANT_ATTEMPTS = 3;
const MIN_CONFIDENCE_TO_SEND = 0.95;

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

async function buildStore() {
  const embeddings = new HuggingFaceLocalEmbeddings();
  return QdrantVectorStore.fromExistingCollection(embeddings, {
    url: QDRANT_URL,
    collectionName: COLECCION,
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
  const store = state.store ?? await buildStore();
  const limit = state.limit ?? 6;
  const results = await store.similaritySearchWithScore(state.question, limit);
  const fragments = results.map(([doc, score]) => normalizeDoc(doc, score));
  return {
    ...state,
    store,
    attempts: (state.attempts || 0) + 1,
    fragments,
    history: [...(state.history || []), { stage: 'busqueda', attempt: (state.attempts || 0) + 1, hits: fragments.length }],
  };
}

function nodoCalificacion(state) {
  const questionTerms = state.question.toLowerCase().split(/\W+/).filter((x) => x.length > 3);
  const qualified = (state.fragments || []).map((fragment) => {
    const text = `${fragment.titulo || ''} ${fragment.texto}`.toLowerCase();
    const matchedTerms = questionTerms.filter((term) => text.includes(term));
    const semanticScore = Number(fragment.score || 0);
    const relevanceScore = Math.min(1, (semanticScore * 0.7) + ((matchedTerms.length / Math.max(questionTerms.length, 1)) * 0.3));
    return {
      ...fragment,
      matchedTerms,
      relevanceScore,
      isRelevant: relevanceScore >= 0.45,
      qualificationReason: relevanceScore >= 0.45 ? 'El fragmento sí parece responder a la pregunta jurídica.' : 'El fragmento no parece suficientemente alineado con la pregunta.',
    };
  });

  const relevant = qualified.filter((x) => x.isRelevant);
  return {
    ...state,
    fragments: qualified,
    relevantFragments: relevant,
    needsRetry: relevant.length === 0,
    history: [...(state.history || []), { stage: 'calificacion', relevant: relevant.length, total: qualified.length }],
  };
}

function nodoRespuesta(state) {
  const fragments = state.relevantFragments || [];
  const top = fragments.slice(0, 4);
  const answerBody = top.map((fragment, idx) => {
    const preview = fragment.texto.slice(0, 700).replace(/\s+/g, ' ').trim();
    return [
      `Fragmento ${idx + 1}`,
      buildCitation(fragment),
      `Score semántico: ${fragment.score}`,
      `Relevancia interna: ${fragment.relevanceScore}`,
      `Texto: ${preview}`,
    ].join('\n');
  }).join('\n\n');

  const draft = top.length
    ? `Respuesta preliminar basada en fragmentos recuperados:\n\n${answerBody}`
    : 'No hay fragmentos suficientemente relevantes para redactar una respuesta preliminar.';

  return {
    ...state,
    draftAnswer: draft,
    citedAnswer: draft,
    history: [...(state.history || []), { stage: 'respuesta', citedFragments: top.length }],
  };
}

function nodoContraste(state) {
  const draft = String(state.draftAnswer || '');
  const fragments = state.relevantFragments || [];
  const unsupportedSignals = [];

  if (!fragments.length) unsupportedSignals.push('No hay fragmentos relevantes para soportar la respuesta.');
  if (/artículo\s+\d+/i.test(draft) && !fragments.some((f) => f.articulo)) unsupportedSignals.push('La respuesta menciona artículos, pero los fragmentos no traen artículo identificado.');
  if (/título:/i.test(draft) && !fragments.some((f) => f.titulo)) unsupportedSignals.push('La respuesta cita título, pero el fragmento no lo trae enriquecido.');

  const avgRelevance = fragments.length ? fragments.reduce((acc, cur) => acc + (cur.relevanceScore || 0), 0) / fragments.length : 0;
  const supported = unsupportedSignals.length === 0 && avgRelevance >= 0.55;

  return {
    ...state,
    supported,
    unsupportedSignals,
    avgRelevance,
    history: [...(state.history || []), { stage: 'contraste', supported, avgRelevance, unsupportedSignals }],
  };
}

function nodoVerificacion(state) {
  const confidence = state.supported ? Math.min(0.99, (state.avgRelevance || 0) + 0.15) : 0.2;
  const shouldSend = confidence >= MIN_CONFIDENCE_TO_SEND;
  return {
    ...state,
    confidence,
    shouldSend,
    history: [...(state.history || []), { stage: 'verificacion', confidence, shouldSend }],
  };
}

function nodoBCN(state) {
  return {
    ...state,
    fallbackToBCN: true,
    history: [...(state.history || []), { stage: 'fallback_bcn', reason: 'Sin certeza suficiente tras tres intentos en Qdrant' }],
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
  const question = process.argv.slice(2).join(' ').trim();
  if (!question) {
    console.error('Uso: node LangGraphLegalFlow.mjs "consulta jurídica"');
    process.exit(1);
  }

  const app = await buildLegalNormsGraph();
  const result = await app.invoke({ question, limit: 6, attempts: 0, history: [] });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}
