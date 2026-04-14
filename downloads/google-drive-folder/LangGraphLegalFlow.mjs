import process from 'node:process';
import { pipeline } from '@huggingface/transformers';
import { Embeddings } from '@langchain/core/embeddings';
import { QdrantVectorStore } from '@langchain/qdrant';
import { StateGraph, END } from '@langchain/langgraph';
import { initChatModel } from 'langchain';

const QDRANT_URL = 'http://127.0.0.1:6333';
const COLECCION = 'normativas_chile';
const MODELO_EMBEDDINGS = 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2';
const MAX_QDRANT_ATTEMPTS = 3;
const MIN_CONFIDENCE_TO_SEND = 0.95;
const AI_MODEL = process.env.LEGAL_GRAPH_MODEL || 'openai:gpt-4.1-mini';

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

async function nodoCalificacion(state) {
  const model = state.model || tryBuildModel();
  const questionTerms = state.question.toLowerCase().split(/\W+/).filter((x) => x.length > 3);

  const aiResult = await askJson(model,
    'Evalúa si cada fragmento responde realmente una pregunta jurídica de un abogado. Devuelve un arreglo items con {index, isRelevant, relevanceScore, reason}.',
    {
      question: state.question,
      fragments: (state.fragments || []).map((f, i) => ({ index: i, score: f.score, texto: f.texto.slice(0, 1800), titulo: f.titulo, articulo: f.articulo })),
    });

  const qualified = (state.fragments || []).map((fragment, idx) => {
    const aiItem = aiResult?.items?.find?.((x) => Number(x.index) === idx);
    if (aiItem) {
      return {
        ...fragment,
        matchedTerms: [],
        relevanceScore: Number(aiItem.relevanceScore || 0),
        isRelevant: Boolean(aiItem.isRelevant),
        qualificationReason: aiItem.reason || 'Calificación IA sin detalle adicional.',
        qualificationSource: 'ai',
      };
    }

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
      qualificationSource: 'heuristic',
    };
  });

  const relevant = qualified.filter((x) => x.isRelevant);
  return {
    ...state,
    model,
    fragments: qualified,
    relevantFragments: relevant,
    needsRetry: relevant.length === 0,
    history: [...(state.history || []), { stage: 'calificacion', relevant: relevant.length, total: qualified.length, source: aiResult ? 'ai' : 'heuristic' }],
  };
}

async function nodoRespuesta(state) {
  const model = state.model || tryBuildModel();
  const fragments = state.relevantFragments || [];
  const top = fragments.slice(0, 4);

  let draft = null;
  const aiResult = await askJson(model,
    'Redacta una respuesta jurídica preliminar exclusivamente basada en fragmentos entregados. Devuelve JSON con {answer}. No agregues datos externos.',
    {
      question: state.question,
      fragments: top.map((f) => ({
        cita: buildCitation(f),
        score: f.score,
        relevanceScore: f.relevanceScore,
        texto: f.texto.slice(0, 1800),
      })),
    });

  if (aiResult?.answer) {
    draft = aiResult.answer;
  } else {
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
    draft = top.length
      ? `Respuesta preliminar basada en fragmentos recuperados:\n\n${answerBody}`
      : 'No hay fragmentos suficientemente relevantes para redactar una respuesta preliminar.';
  }

  return {
    ...state,
    model,
    draftAnswer: draft,
    citedAnswer: draft,
    history: [...(state.history || []), { stage: 'respuesta', citedFragments: top.length, source: aiResult?.answer ? 'ai' : 'heuristic' }],
  };
}

async function nodoContraste(state) {
  const model = state.model || tryBuildModel();
  const draft = String(state.draftAnswer || '');
  const fragments = state.relevantFragments || [];

  const aiResult = await askJson(model,
    'Evalúa si la respuesta contiene datos no soportados por los fragmentos. Devuelve {supported, confidence, unsupportedSignals}.',
    {
      question: state.question,
      answer: draft,
      fragments: fragments.map((f) => ({ cita: buildCitation(f), texto: f.texto.slice(0, 1800) })),
    });

  if (aiResult) {
    return {
      ...state,
      model,
      supported: Boolean(aiResult.supported),
      avgRelevance: Number(aiResult.confidence || 0),
      unsupportedSignals: aiResult.unsupportedSignals || [],
      history: [...(state.history || []), { stage: 'contraste', supported: Boolean(aiResult.supported), avgRelevance: Number(aiResult.confidence || 0), unsupportedSignals: aiResult.unsupportedSignals || [], source: 'ai' }],
    };
  }

  const unsupportedSignals = [];
  if (!fragments.length) unsupportedSignals.push('No hay fragmentos relevantes para soportar la respuesta.');
  if (/artículo\s+\d+/i.test(draft) && !fragments.some((f) => f.articulo)) unsupportedSignals.push('La respuesta menciona artículos, pero los fragmentos no traen artículo identificado.');
  if (/título:/i.test(draft) && !fragments.some((f) => f.titulo)) unsupportedSignals.push('La respuesta cita título, pero el fragmento no lo trae enriquecido.');
  const avgRelevance = fragments.length ? fragments.reduce((acc, cur) => acc + (cur.relevanceScore || 0), 0) / fragments.length : 0;
  const supported = unsupportedSignals.length === 0 && avgRelevance >= 0.55;

  return {
    ...state,
    model,
    supported,
    avgRelevance,
    unsupportedSignals,
    history: [...(state.history || []), { stage: 'contraste', supported, avgRelevance, unsupportedSignals, source: 'heuristic' }],
  };
}

function nodoVerificacion(state) {
  const confidence = state.supported ? Math.min(0.99, Math.max(Number(state.avgRelevance || 0), 0)) : 0.2;
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
      model: null,
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
