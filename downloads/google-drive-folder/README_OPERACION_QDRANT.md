# Operación legal con Qdrant

## Regla operativa

Para preguntas sobre leyes chilenas, normas o relaciones jurídicas basadas en legislación chilena, la consulta debe pasar primero por la base Qdrant `normativas_chile`.

## Archivos clave en esta carpeta

- `SubirColeccionLeyes.py` → recarga completa del corpus en Qdrant
- `SubirColeccionLeyesIncremental.mjs` → carga incremental de un `.txt` puntual en Qdrant con metadatos enriquecidos (`titulo`, `fuente`, `id_norma`, `articulo`, `capitulo`, `parrafo`, etc.)
- `ActualizarLeyDesdeConsulta.mjs` → resuelve una ley por consulta y dispara descarga, limpieza e indexación incremental
- `ConsultarQdrant.py` → consulta semántica rápida sobre Qdrant
- `ConsultarQdrantLangChain.mjs` → consulta y cruces sobre Qdrant usando LangChain
- `texto_limpio/` → corpus fuente descargado

## Consulta rápida

Ejemplos:

```bash
python ConsultarQdrant.py "despido injustificado y pago de indemnización laboral" --limit 3
node ConsultarQdrantLangChain.mjs --query "despido injustificado y pago de indemnización laboral" --limit 3
node ConsultarQdrantLangChain.mjs --queries "despido injustificado || nulidad del despido || indemnización sustitutiva" --limit 3
```

Regla nueva de operación:

- cuando el cliente realice búsquedas o cruces de información sobre la base legal, la capa preferente de consulta debe pasar por `ConsultarQdrantLangChain.mjs`
- `ConsultarQdrant.py` puede seguir existiendo como helper simple de contingencia

Si el host no tiene Python/librerías locales, usar Docker como contingencia. El helper LangChain queda autosuficiente dentro del workspace vía Node.

## Replicación de emergencia

1. Tener Qdrant arriba en `127.0.0.1:6333`
2. Mantener esta carpeta completa
3. Para una ley puntual, ejecutar `SubirColeccionLeyesIncremental.mjs --file <archivo>.txt`
4. Para recarga completa, ejecutar `SubirColeccionLeyes.py`
5. Ejecutar `ConsultarQdrant.py` o `ConsultarQdrantLangChain.mjs` para validar búsquedas

## Nota importante

Qdrant es la fuente principal operativa para este flujo legal. Si alguna respuesta no aparece bien respaldada por la base, se debe priorizar la recuperación desde Qdrant antes de responder.

## Flujo LangGraph para búsquedas normativas

Archivos base:

- `LangGraphLegalFlow.mjs`
- `LegalEvalService.mjs`
- `LegalQueryRouter.mjs`

Diseño actual del grafo:

El grafo ahora soporta dos modos:

- `normas` → colección `normativas_chile`
- `cliente` → colección `user_<slug>` o la que se indique explícitamente

Además, antes de entrar a búsqueda, pasa por un router:

- `LegalQueryRouter.mjs`
- intenta clasificar la consulta con LLM si hay modelo
- si no, usa heurística robusta
- decide entre normativa general y base documental del cliente

1. **Nodo de búsqueda**
   - consulta Qdrant
   - recupera fragmentos semánticos
2. **Nodo de calificación**
   - evalúa si los fragmentos realmente responden a la pregunta del abogado
   - si hay modelo disponible, usa IA estructurada
   - si no, usa fallback heurístico
   - si no son relevantes, vuelve a buscar en Qdrant
3. **Nodo de respuesta**
   - construye una respuesta preliminar citando lo disponible del fragmento
   - si hay modelo disponible, redacta con IA limitada a los fragmentos
4. **Nodo de contraste**
   - compara la respuesta contra los fragmentos
   - si hay modelo disponible, hace contraste estructurado con IA
   - si detecta datos no soportados, invalida y reinicia
5. **Nodo de verificación**
   - solo permite salida si la utilidad/certeza supera 95%
   - si no lo logra tras 3 intentos:
     - en modo `normas`, deriva a BCN Chile
     - en modo `cliente`, marca revisión humana o insuficiencia documental

Regla de oro:

- si la respuesta contiene datos no respaldados por los fragmentos, no se entrega
- se reintenta hasta 3 veces en Qdrant
- recién después se habilita fallback a BCN Chile

Metadatos enriquecidos actuales del corpus legal:

- el cargador incremental ya intenta derivar y guardar por chunk:
  - `titulo`
  - `fuente`
  - `id_norma`
  - `libro`
  - `titulo_normativo`
  - `capitulo`
  - `parrafo`
  - `articulo`
- esto mejora citas, contraste y trazabilidad en el grafo

Servicio interno actual:

- `LegalEvalService.mjs` centraliza las tareas de:
  - calificación de fragmentos
  - redacción preliminar
  - contraste contra fragmentos
- el servicio intenta usar modelo cuando está disponible
- si el modelo no está disponible en el proceso, cae a heurística sin romper el flujo

## Regla de aislamiento de datos

- Cada usuario debe tener su propia colección en Qdrant.
- No mezclar datos entre usuarios.
- No cruzar causas entre colecciones por error.
- Antes de indexar cualquier documento, extraer y depurar el contenido hasta obtener texto limpio `.txt`.
- Solo el texto depurado debe viajar a Qdrant.
