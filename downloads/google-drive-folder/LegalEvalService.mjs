import process from 'node:process';
import { initChatModel } from 'langchain';

const AI_MODEL = process.env.LEGAL_GRAPH_MODEL || 'openai:gpt-4.1-mini';

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

function heuristicQualification(question, fragments) {
  const questionTerms = String(question).toLowerCase().split(/\W+/).filter((x) => x.length > 3);
  return {
    items: fragments.map((fragment, index) => {
      const text = `${fragment.titulo || ''} ${fragment.texto || ''}`.toLowerCase();
      const matchedTerms = questionTerms.filter((term) => text.includes(term));
      const semanticScore = Number(fragment.score || 0);
      const relevanceScore = Math.min(1, (semanticScore * 0.7) + ((matchedTerms.length / Math.max(questionTerms.length, 1)) * 0.3));
      return {
        index,
        isRelevant: relevanceScore >= 0.45,
        relevanceScore,
        reason: relevanceScore >= 0.45 ? 'Heurística: el fragmento parece responder a la consulta.' : 'Heurística: el fragmento no parece suficientemente alineado.',
      };
    }),
    source: 'heuristic',
  };
}

function heuristicDraft(question, fragments) {
  const top = fragments.slice(0, 4);
  const avgRelevance = top.length
    ? top.reduce((acc, cur) => acc + Number(cur.relevanceScore || cur.score || 0), 0) / top.length
    : 0;
  const certainty = avgRelevance >= 0.8 ? 'Alta' : avgRelevance >= 0.6 ? 'Media' : 'Baja / Requiere verificación';
  const observation = top.length
    ? (top.some((f) => !f.cita || f.cita === 'Sin cita enriquecida')
      ? 'Los fragmentos recuperados no traen cita suficientemente enriquecida, por lo que la conclusión debe tratarse como preliminar.'
      : 'La respuesta se apoya en los fragmentos recuperados.')
    : 'No hay fragmentos suficientes para una conclusión confiable.';
  const fundamento = top.length
    ? top.map((f, i) => `Fragmento ${i + 1}: ${f.cita || 'Sin cita enriquecida'}`).join(' | ')
    : 'Sin fundamento recuperado.';
  const cuerpo = top.length
    ? top.map((f, i) => `Fragmento ${i + 1}\nCita: ${f.cita || 'Sin cita enriquecida'}\nTexto: ${String(f.texto || '').slice(0, 900)}`).join('\n\n')
    : 'No hay fragmentos suficientes para redactar una respuesta preliminar.';
  const answer = [
    `Respuesta corta: análisis preliminar para: ${question}`,
    `Fundamento: ${fundamento}`,
    `Nivel de certeza: ${certainty}`,
    `Observación: ${observation}`,
    '',
    cuerpo,
  ].join('\n');
  return { answer, certainty, observation, source: 'heuristic' };
}

function heuristicContrast(answer, fragments) {
  const unsupportedSignals = [];
  if (!fragments.length) unsupportedSignals.push('No hay fragmentos para soportar la respuesta.');
  if (/artículo\s+\d+/i.test(answer) && !fragments.some((f) => f.articulo)) unsupportedSignals.push('La respuesta menciona artículos sin artículo identificado en fragmentos.');
  const avg = fragments.length ? fragments.reduce((acc, cur) => acc + Number(cur.relevanceScore || cur.score || 0), 0) / fragments.length : 0;
  return {
    supported: unsupportedSignals.length === 0 && avg >= 0.55,
    confidence: avg,
    unsupportedSignals,
    source: 'heuristic',
  };
}

async function qualify(model, payload) {
  const ai = await askJson(model,
    'Evalúa si cada fragmento responde realmente una pregunta jurídica. Devuelve {items:[{index,isRelevant,relevanceScore,reason}]}.',
    payload);
  return ai || heuristicQualification(payload.question, payload.fragments || []);
}

async function draft(model, payload) {
  const ai = await askJson(model,
    'Redacta una respuesta jurídica preliminar exclusivamente basada en fragmentos. Devuelve {answer,certainty,observation}. La respuesta debe incluir conclusión breve, fundamento y nivel de certeza. No agregues hechos externos.',
    payload);
  return ai ? { ...ai, source: 'ai' } : heuristicDraft(payload.question, payload.fragments || []);
}

async function contrast(model, payload) {
  const ai = await askJson(model,
    'Evalúa si la respuesta contiene datos no soportados por los fragmentos. Devuelve {supported,confidence,unsupportedSignals}.',
    payload);
  return ai ? { ...ai, source: 'ai' } : heuristicContrast(payload.answer, payload.fragments || []);
}

async function main() {
  const mode = process.argv[2];
  const raw = await new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
  const payload = raw.trim() ? JSON.parse(raw) : {};
  const model = tryBuildModel();

  let result;
  if (mode === 'qualify') result = await qualify(model, payload);
  else if (mode === 'draft') result = await draft(model, payload);
  else if (mode === 'contrast') result = await contrast(model, payload);
  else throw new Error('Modo inválido. Usa: qualify | draft | contrast');

  process.stdout.write(JSON.stringify(result));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
