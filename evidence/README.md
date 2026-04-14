# Estructura de evidencia

Organización base para archivos recibidos desde Slack u otros canales.

## Regla general

Cada usuario debe tener su propio espacio.
Dentro de cada usuario, cada causa o asunto debe tener su propia carpeta.

## Estructura sugerida

```text
evidence/
  <usuario>/
    <causa-o-asunto>/
      inbox/
      originals/
      extracted-text/
      qdrant-staging/
      notes/
      exports/
```

## Carpetas

- `inbox/`: ingreso inicial, antes de clasificar
- `originals/`: archivo original tal como llegó
- `extracted-text/`: texto limpio `.txt` extraído del material
- `qdrant-staging/`: archivos preparados para indexación
- `notes/`: contexto, metadatos, observaciones, cadena de custodia básica
- `exports/`: entregables o derivados

## Convención de nombres sugerida

```text
<fecha>_<usuario>_<causa>_<tipo>_<descripcion>.<ext>
```

Ejemplo:

```text
2026-04-13_juan-perez_despido-laboral_audio_whatsapp-01.mp3
2026-04-13_juan-perez_despido-laboral_documento_contrato.pdf
2026-04-13_juan-perez_despido-laboral_texto_contrato.txt
```

## Regla Qdrant

Antes de indexar:
1. guardar original
2. extraer texto limpio
3. validar usuario y causa
4. enviar solo `.txt` limpio a la colección correcta del usuario
