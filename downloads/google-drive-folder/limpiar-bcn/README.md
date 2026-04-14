# Pipeline BCN portable

## Objetivo

Descargar HTML de BCN Chile y dejar los `.txt` limpios en la misma carpeta operativa usada por el corpus legal:

- `/root/.openclaw/workspace/downloads/google-drive-folder/texto_limpio/`

## Scripts

- `DescargarLeyesChile_portable.py`
  - descarga HTML de BCN en `limpiar-bcn/html_bcn/`
- `extraer_texto.py`
  - limpia HTML y escribe `.txt` en `../texto_limpio/`

## Uso recomendado

### 1. Descargar HTML

```bash
python3 DescargarLeyesChile_portable.py
```

### 2. Extraer texto limpio al corpus operativo

```bash
python3 extraer_texto.py \
  --html-dir /root/.openclaw/workspace/downloads/google-drive-folder/limpiar-bcn/html_bcn \
  --output-dir /root/.openclaw/workspace/downloads/google-drive-folder/texto_limpio
```

### 3. Subir a Qdrant

Desde la carpeta superior:

```bash
python3 /root/.openclaw/workspace/downloads/google-drive-folder/SubirColeccionLeyes.py
```

## Nota

El requisito principal pedido quedó respetado:

- los `.txt` finales deben quedar en `downloads/google-drive-folder/texto_limpio/`
