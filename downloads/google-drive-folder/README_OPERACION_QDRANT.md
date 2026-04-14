# Operación legal con Qdrant

## Regla operativa

Para preguntas sobre leyes chilenas, normas o relaciones jurídicas basadas en legislación chilena, la consulta debe pasar primero por la base Qdrant `normativas_chile`.

## Archivos clave en esta carpeta

- `SubirColeccionLeyes.py` → carga el corpus en Qdrant
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
3. Ejecutar `SubirColeccionLeyes.py` para recargar el corpus
4. Ejecutar `ConsultarQdrant.py` o `ConsultarQdrantLangChain.mjs` para validar búsquedas

## Nota importante

Qdrant es la fuente principal operativa para este flujo legal. Si alguna respuesta no aparece bien respaldada por la base, se debe priorizar la recuperación desde Qdrant antes de responder.

## Flujo LangGraph para búsquedas normativas

Archivo base:

- `LangGraphLegalFlow.mjs`

Diseño actual del grafo:

1. **Nodo de búsqueda**
   - consulta Qdrant
   - recupera fragmentos semánticos
2. **Nodo de calificación**
   - evalúa si los fragmentos realmente responden a la pregunta del abogado
   - si no son relevantes, vuelve a buscar en Qdrant
3. **Nodo de respuesta**
   - construye una respuesta preliminar citando lo disponible del fragmento
4. **Nodo de contraste**
   - compara la respuesta contra los fragmentos
   - si detecta datos no soportados, invalida y reinicia
5. **Nodo de verificación**
   - solo permite salida si la utilidad/certeza supera 95%
   - si no lo logra tras 3 intentos, deriva a BCN Chile

Regla de oro:

- si la respuesta contiene datos no respaldados por los fragmentos, no se entrega
- se reintenta hasta 3 veces en Qdrant
- recién después se habilita fallback a BCN Chile

## Regla de aislamiento de datos

- Cada usuario debe tener su propia colección en Qdrant.
- No mezclar datos entre usuarios.
- No cruzar causas entre colecciones por error.
- Antes de indexar cualquier documento, extraer y depurar el contenido hasta obtener texto limpio `.txt`.
- Solo el texto depurado debe viajar a Qdrant.
