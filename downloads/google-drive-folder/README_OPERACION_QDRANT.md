# Operación legal con Qdrant

## Regla operativa

Para preguntas sobre leyes chilenas, normas o relaciones jurídicas basadas en legislación chilena, la consulta debe pasar primero por la base Qdrant `normativas_chile`.

## Archivos clave en esta carpeta

- `SubirColeccionLeyes.py` → carga el corpus en Qdrant
- `ConsultarQdrant.py` → consulta semántica rápida sobre Qdrant
- `texto_limpio/` → corpus fuente descargado

## Consulta rápida

Ejemplo:

```bash
python ConsultarQdrant.py "despido injustificado y pago de indemnización laboral" --limit 3
```

Si el host no tiene Python/librerías locales, usar Docker como contingencia.

## Replicación de emergencia

1. Tener Qdrant arriba en `127.0.0.1:6333`
2. Mantener esta carpeta completa
3. Ejecutar `SubirColeccionLeyes.py` para recargar el corpus
4. Ejecutar `ConsultarQdrant.py` para validar búsquedas

## Nota importante

Qdrant es la fuente principal operativa para este flujo legal. Si alguna respuesta no aparece bien respaldada por la base, se debe priorizar la recuperación desde Qdrant antes de responder.

## Regla de aislamiento de datos

- Cada usuario debe tener su propia colección en Qdrant.
- No mezclar datos entre usuarios.
- No cruzar causas entre colecciones por error.
- Antes de indexar cualquier documento, extraer y depurar el contenido hasta obtener texto limpio `.txt`.
- Solo el texto depurado debe viajar a Qdrant.
