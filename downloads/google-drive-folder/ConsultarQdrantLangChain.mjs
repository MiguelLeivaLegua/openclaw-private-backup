import process from 'node:process';
import { pipeline } from '@huggingface/transformers';
import { Embeddings } from '@langchain/core/embeddings';
import { QdrantVectorStore } from '@langchain/qdrant';

const QDRANT_URL = 'http://127.0.0.1:6333';
const COLECCION = 'normativas_chile';
const MODELO_EMBEDDINGS = 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2';

class HuggingFaceLocalEmbeddings extends Embeddings {
  constructor(fields = {}) {
    super(fields);
    this.extractorPromise = null;
  }

  async getExtractor() {
    if (!this.extractorPromise) {
      this.extractorPromise = pipeline('feature-extraction', MODELO_EMBEDDINGS);
    }
    return this.extractorPromise;
  }

  async embedOne(text) {
    const extractor = await this.getExtractor();
    const output = await extractor(text, { pooling: 'mean', normalize: false });
    const raw = output.tolist();
    return Array.isArray(raw[0]) ? raw[0] : raw;
  }

  async embedDocuments(texts) {
    const vectors = [];
    for (const text of texts) {
      vectors.push(await this.embedOne(text));
    }
    return vectors;
  }

  async embedQuery(text) {
    return this.embedOne(text);
  }
}

function parseArgs(argv) {
  const args = {
    queries: [],
    limit: 5,
    mode: 'single',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--limit') {
      args.limit = Number(argv[++i] || 5);
    } else if (token === '--query') {
      args.queries.push(argv[++i]);
    } else if (token === '--queries') {
      args.queries.push(...String(argv[++i] || '').split('||').map((x) => x.trim()).filter(Boolean));
      args.mode = 'cross';
    } else if (!token.startsWith('--')) {
      args.queries.push(token);
    }
  }

  if (args.queries.length > 1) {
    args.mode = 'cross';
  }

  if (!args.queries.length) {
    throw new Error('Uso: node ConsultarQdrantLangChain.mjs --query "texto" [--limit 5]');
  }

  return args;
}

function formatDoc(doc, score, index, queryLabel = null) {
  const metadata = doc.metadata || {};
  const pageContent = String(doc.pageContent || '').replace(/\s+/g, ' ').trim();
  const preview = pageContent.slice(0, 500) + (pageContent.length > 500 ? '...' : '');

  const lines = [
    `Resultado ${index}`,
    queryLabel ? `query: ${queryLabel}` : null,
    `score: ${score}`,
    metadata.titulo ? `titulo: ${metadata.titulo}` : null,
    metadata.fuente ? `fuente: ${metadata.fuente}` : null,
    metadata.archivo ? `archivo: ${metadata.archivo}` : null,
    metadata.articulo ? `articulo: ${metadata.articulo}` : null,
    metadata.usuario ? `usuario: ${metadata.usuario}` : null,
    metadata.causa ? `causa: ${metadata.causa}` : null,
    `texto: ${preview || '[sin texto en payload]'}`,
  ].filter(Boolean);

  return lines.join('\n');
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

async function runSingle(store, query, limit) {
  const results = await store.similaritySearchWithScore(query, limit);
  console.log(`Consulta: ${query}`);
  console.log(`Colección: ${COLECCION}`);
  console.log(`Modo: langchain-single`);
  console.log(`Resultados: ${results.length}`);
  console.log('='.repeat(80));
  results.forEach(([doc, score], idx) => {
    console.log(formatDoc(doc, score, idx + 1));
    console.log('-'.repeat(80));
  });
}

async function runCross(store, queries, limit) {
  const merged = [];
  const seen = new Set();

  for (const query of queries) {
    const results = await store.similaritySearchWithScore(query, limit);
    for (const [doc, score] of results) {
      const metadata = doc.metadata || {};
      const key = [metadata.archivo, metadata.chunk_index, doc.pageContent.slice(0, 160)].join('::');
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({ query, doc, score, metadata });
    }
  }

  merged.sort((a, b) => b.score - a.score);

  console.log(`Consultas: ${queries.join(' | ')}`);
  console.log(`Colección: ${COLECCION}`);
  console.log(`Modo: langchain-cross`);
  console.log(`Resultados únicos: ${merged.length}`);
  console.log('='.repeat(80));
  merged.slice(0, limit * queries.length).forEach((item, idx) => {
    console.log(formatDoc(item.doc, item.score, idx + 1, item.query));
    console.log('-'.repeat(80));
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const store = await buildStore();

  if (args.mode === 'cross') {
    await runCross(store, args.queries, args.limit);
  } else {
    await runSingle(store, args.queries[0], args.limit);
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
