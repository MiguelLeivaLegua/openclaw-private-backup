#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { pipeline } from '@huggingface/transformers';
import { QdrantClient } from '@qdrant/js-client-rest';

const ROOT = '/root/.openclaw/workspace/downloads/google-drive-folder';
const RUTA_TXTS = path.join(ROOT, 'texto_limpio');
const COLECCION = 'normativas_chile';
const CHUNK_SIZE = 1500;
const OVERLAP = 200;
const BATCH_SIZE = 50;
const MODELO_EMBEDDINGS = 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2';
const QDRANT_URL = 'http://127.0.0.1:6333';

const SEPARADORES_LEGALES = [
  /(?=LIBRO\s+[IVXLCDM]+)/i,
  /(?=T[ÍI]TULO\s+[IVXLCDM]+)/i,
  /(?=CAP[ÍI]TULO\s+[IVXLCDM]+)/i,
  /(?=P[ÁA]RRAFO\s+\d+[°º]?)/i,
  /(?=Art[íi]culo\s+\d+[°º]?)/i,
  /(?=\n\s*[a-z]\)\s+)/i,
  /(?=\n\s*\d+[°º\.\)]\s+)/i,
  /\n\s*\n+/i,
  /(?<=\.)\s*\n/i,
  /(?<=[.;:!?])\s+/i,
  /\n/i,
  /\s+/i,
];

let extractorPromise = null;
async function getExtractor() {
  if (!extractorPromise) extractorPromise = pipeline('feature-extraction', MODELO_EMBEDDINGS);
  return extractorPromise;
}

async function embedOne(text) {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: 'mean', normalize: false });
  const raw = output.tolist();
  return Array.isArray(raw[0]) ? raw[0] : raw;
}

function normalizarTexto(texto) {
  return texto
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((linea) => linea.trim())
    .join('\n')
    .trim();
}

function dividirConOverlapFinal(texto, maxChars, overlap) {
  const palabras = texto.split(/\s+/).filter(Boolean);
  const chunks = [];
  let actual = [];
  let longitud = 0;
  for (const palabra of palabras) {
    if (longitud + palabra.length + 1 <= maxChars) {
      actual.push(palabra);
      longitud += palabra.length + 1;
    } else {
      if (actual.length) chunks.push(actual.join(' '));
      const overlapWords = actual.slice(-Math.max(1, Math.floor(overlap / 10)));
      actual = [...overlapWords, palabra];
      longitud = actual.reduce((acc, p) => acc + p.length + 1, 0);
    }
  }
  if (actual.length) chunks.push(actual.join(' '));
  return chunks;
}

function aplicarOverlap(chunks, overlap) {
  if (chunks.length <= 1 || overlap <= 0) return chunks;
  const out = [chunks[0]];
  for (let i = 1; i < chunks.length; i += 1) {
    const prevWords = chunks[i - 1].split(/\s+/);
    const count = Math.min(prevWords.length, Math.floor(overlap / 8));
    if (count > 0) out.push(`[...] ${prevWords.slice(-count).join(' ')} ${chunks[i]}`);
    else out.push(chunks[i]);
  }
  return out;
}

function dividirRecursivo(texto, maxChars = CHUNK_SIZE, overlap = OVERLAP, nivel = 0) {
  if (texto.length <= maxChars) return texto.trim() ? [texto.trim()] : [];
  if (nivel >= SEPARADORES_LEGALES.length) return dividirConOverlapFinal(texto, maxChars, overlap);
  const partes = texto.split(SEPARADORES_LEGALES[nivel]).map((s) => s.trim()).filter(Boolean);
  if (partes.length <= 1) return dividirRecursivo(texto, maxChars, overlap, nivel + 1);
  const chunks = [];
  let buffer = '';
  for (const parte of partes) {
    if ((buffer + ' ' + parte).trim().length <= maxChars) {
      buffer = (buffer + ' ' + parte).trim();
    } else {
      if (buffer) chunks.push(buffer);
      if (parte.length > maxChars) {
        chunks.push(...dividirRecursivo(parte, maxChars, overlap, nivel + 1));
        buffer = '';
      } else {
        buffer = parte;
      }
    }
  }
  if (buffer) chunks.push(buffer);
  return aplicarOverlap(chunks, overlap);
}

function limpiarTextoLegal(textoCrudo) {
  if (textoCrudo.includes('no se encuentra en nuestra Base de Datos')) return '';
  const lineas = textoCrudo.split('\n');
  const noVacias = lineas.map((l) => l.trim()).filter(Boolean);
  const ruidoSolo = new Set(['búsqueda avanzada', 'selección', 'término', 'última versión', 'texto original', 'tipo versión', 'intermedio']);
  if (noVacias.every((l) => ruidoSolo.has(l.toLowerCase()) || l.length < 20)) return '';
  let fin = lineas.length;
  for (let i = 0; i < lineas.length; i += 1) {
    if (lineas[i].trim() === 'Tipo Versión') { fin = i; break; }
  }
  const patronesUI = /^(×|Cerrar|Loading\.\.\.|Copiar|Procesando\.\.\.|Ocultar notas|Comparando|Portada|Volver|Navegar Norma|EXPANDIR|Selección|Modo oscuro|Alto contraste|Búsqueda avanzada|Formulario de contacto|OK, Entendido|Descargar con firma|Descargar ahora sin firma|Descarga sin firma|Descarga con Firma|Escuchar|Puede descargar el documento inmediatamente.*|Esta opción es más rápida.*|ahora sin firma)$/;
  const limpias = lineas.slice(0, fin).filter((linea) => !patronesUI.test(linea.trim()));
  while (limpias.length && ['', 'Término'].includes(limpias[limpias.length - 1].trim())) limpias.pop();
  return limpias.join('\n').trim();
}

function dividirTextoLegal(texto) {
  return dividirRecursivo(normalizarTexto(texto), CHUNK_SIZE, OVERLAP, 0);
}

function parseNormaInfo(archivo, texto) {
  const stem = path.basename(archivo, '.txt');
  const idMatch = stem.match(/_(\d+)$/);
  const idNorma = idMatch ? idMatch[1] : null;
  const norma = stem.replace(/_/g, ' ').replace(/\s+\d+$/, '').trim();
  const firstLines = texto.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 10);
  const titulo = firstLines.find((line) => line.length > 8) || norma;
  return {
    norma,
    titulo,
    idNorma,
    fuente: 'BCN Chile',
    archivo,
  };
}

function extractChunkMetadata(chunk, baseInfo) {
  const libro = chunk.match(/LIBRO\s+[IVXLCDM]+/i)?.[0] || null;
  const tituloNormativo = chunk.match(/T[ÍI]TULO\s+[IVXLCDM]+/i)?.[0] || null;
  const capitulo = chunk.match(/CAP[ÍI]TULO\s+[IVXLCDM]+/i)?.[0] || null;
  const parrafo = chunk.match(/P[ÁA]RRAFO\s+\d+[°º]?/i)?.[0] || null;
  const articulo = chunk.match(/Art[íi]culo\s+\d+[°º]?|Art\.\s*\d+[°º]?/i)?.[0] || null;
  return {
    ...baseInfo,
    libro,
    titulo_normativo: tituloNormativo,
    capitulo,
    parrafo,
    articulo,
  };
}

function parseArgs(argv) {
  const args = { file: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--file') args.file = argv[++i];
  }
  if (!args.file) throw new Error('Uso: node SubirColeccionLeyesIncremental.mjs --file archivo.txt');
  return args;
}

async function ensureCollection(client) {
  const collections = await client.getCollections();
  const names = (collections.collections || []).map((c) => c.name);
  if (!names.includes(COLECCION)) {
    await client.createCollection(COLECCION, { vectors: { size: 384, distance: 'Cosine' } });
  }
}

async function deletePrevious(client, archivo) {
  await client.delete(COLECCION, {
    filter: { must: [{ key: 'archivo', match: { value: archivo } }] },
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rutaTxt = path.isAbsolute(args.file) ? args.file : path.join(RUTA_TXTS, args.file);
  const archivo = path.basename(rutaTxt);
  const textoCrudo = fs.readFileSync(rutaTxt, 'utf8');
  const textoLimpio = limpiarTextoLegal(textoCrudo);
  if (!textoLimpio || textoLimpio.length < 100) throw new Error(`Sin contenido legal extraíble: ${archivo}`);
  const baseInfo = parseNormaInfo(archivo, textoLimpio);
  const chunks = dividirTextoLegal(textoLimpio).filter((chunk) => chunk.trim().length >= 100);
  const client = new QdrantClient({ url: QDRANT_URL });
  await ensureCollection(client);
  await deletePrevious(client, archivo);

  let total = 0;
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const vectors = [];
    for (const chunk of batch) vectors.push(await embedOne(chunk));
    const points = batch.map((chunk, idx) => {
      const meta = extractChunkMetadata(chunk, baseInfo);
      return {
        id: crypto.randomUUID(),
        vector: vectors[idx],
        payload: {
          texto: chunk,
          archivo,
          norma: baseInfo.norma,
          titulo: meta.titulo,
          fuente: meta.fuente,
          id_norma: meta.idNorma,
          libro: meta.libro,
          titulo_normativo: meta.titulo_normativo,
          capitulo: meta.capitulo,
          parrafo: meta.parrafo,
          articulo: meta.articulo,
          chunk_index: i + idx + 1,
          chunk_num: i + idx + 1,
          total_chunks: chunks.length,
          chars: chunk.length,
          metadata: meta,
        },
      };
    });
    await client.upsert(COLECCION, { wait: true, points });
    total += points.length;
  }

  console.log(JSON.stringify({ ok: true, archivo, chunks: total, coleccion: COLECCION, titulo: baseInfo.titulo, id_norma: baseInfo.idNorma }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
