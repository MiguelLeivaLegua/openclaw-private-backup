import os
import re
import logging
from qdrant_client import QdrantClient
from qdrant_client.models import VectorParams, Distance, PointStruct
from sentence_transformers import SentenceTransformer

# 📌 Configuración
RUTA_TXTS = os.path.join(os.path.dirname(__file__), "texto_limpio")
COLECCION = "normativas_chile"
CHUNK_SIZE = 1500      # Chunks grandes para mantener contexto legal completo
OVERLAP = 200          # Solapamiento para no perder contexto entre chunks
BATCH_SIZE = 50        # Inserción en lotes

# 🧠 Modelo multilingüe (mejor para textos en español)
MODELO_EMBEDDINGS = 'paraphrase-multilingual-MiniLM-L12-v2'  # 384 dims, multilingüe
# Alternativa más precisa (requiere más RAM): 'intfloat/multilingual-e5-base' (768 dims)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


# 📚 Separadores jerárquicos para textos legales chilenos (de mayor a menor importancia semántica)
SEPARADORES_LEGALES = [
    r'(?=LIBRO\s+[IVXLCDM]+)',                      # LIBRO I, II, III...
    r'(?=T[ÍI]TULO\s+[IVXLCDM]+)',                  # TÍTULO I, II...
    r'(?=CAP[ÍI]TULO\s+[IVXLCDM]+)',                # CAPÍTULO I, II...
    r'(?=P[ÁA]RRAFO\s+\d+[°º]?)',                   # PÁRRAFO 1°, 2°...
    r'(?=Art[íi]culo\s+\d+[°º]?)',                  # Artículo 1°, 2°...
    r'(?=\n\s*[a-z]\)\s+)',                         # incisos: a), b), c)...
    r'(?=\n\s*\d+[°º\.\)]\s+)',                     # numerales: 1°, 2., 3)...
    r'\n\s*\n+',                                     # 🆕 PÁRRAFOS: doble salto de línea o más
    r'(?<=\.)\s*\n',                                 # 🆕 PUNTO APARTE: punto seguido de salto de línea
    r'(?<=[.;:!?])\s+',                             # oraciones (punto seguido, punto y coma, etc.)
    r'\n',                                           # 🆕 SALTO DE LÍNEA simple
    r'\s+',                                          # palabras (último recurso)
]


def normalizar_texto(texto: str) -> str:
    """
    Normaliza el texto antes de procesarlo.
    Limpia caracteres problemáticos y estandariza espacios/saltos.
    """
    # Normalizar saltos de línea (Windows \r\n, Mac antiguo \r, Unix \n)
    texto = texto.replace('\r\n', '\n').replace('\r', '\n')
    
    # Eliminar caracteres de control excepto \n y \t
    texto = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', texto)
    
    # Normalizar múltiples espacios en línea (pero preservar saltos)
    texto = re.sub(r'[^\S\n]+', ' ', texto)
    
    # Normalizar múltiples líneas vacías a máximo 2
    texto = re.sub(r'\n{3,}', '\n\n', texto)
    
    # Eliminar espacios al inicio/final de cada línea
    lineas = [linea.strip() for linea in texto.split('\n')]
    texto = '\n'.join(lineas)
    
    return texto.strip()


def dividir_recursivo(texto: str, max_chars: int = CHUNK_SIZE, overlap: int = OVERLAP, 
                      nivel_separador: int = 0) -> list[str]:
    """
    Chunking RECURSIVO y SEMÁNTICO para textos legales chilenos.
    
    Estrategia:
    1. Intenta dividir por el separador más importante (LIBRO, TÍTULO...)
    2. Si las secciones son muy grandes, recursivamente usa el siguiente separador
    3. Continúa hasta llegar a oraciones o palabras si es necesario
    4. Aplica overlap entre chunks para mantener contexto
    """
    # Si el texto ya cabe, retornarlo directamente
    if len(texto) <= max_chars:
        return [texto.strip()] if texto.strip() else []
    
    # Si ya probamos todos los separadores, dividir por caracteres con overlap
    if nivel_separador >= len(SEPARADORES_LEGALES):
        return dividir_con_overlap_final(texto, max_chars, overlap)
    
    # Intentar dividir con el separador actual
    separador = SEPARADORES_LEGALES[nivel_separador]
    secciones = re.split(separador, texto, flags=re.IGNORECASE)
    secciones = [s.strip() for s in secciones if s.strip()]
    
    # Si no dividió nada útil, probar el siguiente separador
    if len(secciones) <= 1:
        return dividir_recursivo(texto, max_chars, overlap, nivel_separador + 1)
    
    # Procesar cada sección
    chunks = []
    buffer = ""
    
    for seccion in secciones:
        # Si la sección cabe en el buffer actual
        if len(buffer) + len(seccion) + 1 <= max_chars:
            buffer = (buffer + " " + seccion).strip()
        else:
            # Guardar buffer actual
            if buffer:
                chunks.append(buffer)
            
            # Si la sección individual es muy grande, dividirla recursivamente
            if len(seccion) > max_chars:
                sub_chunks = dividir_recursivo(seccion, max_chars, overlap, nivel_separador + 1)
                chunks.extend(sub_chunks)
                buffer = ""
            else:
                buffer = seccion
    
    if buffer:
        chunks.append(buffer)
    
    # Aplicar overlap entre chunks
    return aplicar_overlap(chunks, overlap)


def dividir_con_overlap_final(texto: str, max_chars: int, overlap: int) -> list[str]:
    """Último recurso: dividir por caracteres respetando palabras."""
    palabras = texto.split()
    chunks = []
    actual = []
    longitud_actual = 0
    
    for palabra in palabras:
        if longitud_actual + len(palabra) + 1 <= max_chars:
            actual.append(palabra)
            longitud_actual += len(palabra) + 1
        else:
            if actual:
                chunks.append(" ".join(actual))
            # Overlap: mantener últimas palabras
            palabras_overlap = actual[-max(1, overlap // 10):] if actual else []
            actual = palabras_overlap + [palabra]
            longitud_actual = sum(len(p) + 1 for p in actual)
    
    if actual:
        chunks.append(" ".join(actual))
    
    return chunks


def aplicar_overlap(chunks: list[str], overlap: int) -> list[str]:
    """Agrega contexto del chunk anterior al inicio del siguiente."""
    if len(chunks) <= 1 or overlap <= 0:
        return chunks
    
    chunks_con_overlap = [chunks[0]]
    
    for i in range(1, len(chunks)):
        # Tomar las últimas palabras del chunk anterior como contexto
        palabras_anteriores = chunks[i - 1].split()
        num_palabras_overlap = min(len(palabras_anteriores), overlap // 8)
        
        if num_palabras_overlap > 0:
            contexto = " ".join(palabras_anteriores[-num_palabras_overlap:])
            chunk_con_contexto = f"[...] {contexto} {chunks[i]}"
        else:
            chunk_con_contexto = chunks[i]
        
        chunks_con_overlap.append(chunk_con_contexto)
    
    return chunks_con_overlap


def dividir_texto_legal(texto: str, max_chars: int = CHUNK_SIZE, overlap: int = OVERLAP) -> list[str]:
    """
    Wrapper principal - Chunking SEMÁNTICO y RECURSIVO para leyes chilenas.
    
    Jerarquía de separadores (mayor a menor importancia):
    LIBRO → TÍTULO → CAPÍTULO → PÁRRAFO → Artículo → inciso → numeral → párrafo → punto aparte → oración → salto → palabra
    """
    # 🧹 Normalizar texto primero (saltos de línea, espacios, caracteres especiales)
    texto_normalizado = normalizar_texto(texto)
    
    return dividir_recursivo(texto_normalizado, max_chars, overlap, nivel_separador=0)


def limpiar_texto_legal(texto_crudo: str) -> str:
    """
    Limpia archivos TXT pre-procesados de Ley Chile (BCN).
    
    Los archivos ya fueron convertidos de HTML a texto plano, pero conservan:
    - Bloque de metadatos al final (versiones, jurisprudencia, historia de la ley,
      proyectos de ley, Ley Fácil, Chile Atiende, etc.) desde "Tipo Versión" hasta "Término"
    - Líneas residuales de UI web ("Búsqueda avanzada", "Selección", etc.)
    - Archivos inválidos (errores de scraping, normas no encontradas)
    
    Estrategia:
    1. Detectar archivos inválidos → retornar vacío
    2. Cortar el bloque de metadatos BCN al final (desde "Tipo Versión")
    3. Limpiar líneas residuales de UI
    4. Eliminar marcador "Término" suelto al final
    """
    # 1️⃣ Detectar archivos inválidos (errores de scraping, normas no encontradas)
    if 'no se encuentra en nuestra Base de Datos' in texto_crudo:
        return ""
    
    lineas = texto_crudo.split('\n')
    
    # Detectar archivos que son solo ruido de UI (sin contenido legal real)
    # Un archivo válido debe tener al menos alguna línea con contenido sustantivo
    lineas_no_vacias = [l.strip() for l in lineas if l.strip()]
    RUIDO_SOLO = {
        'búsqueda avanzada', 'selección', 'término', 'última versión',
        'texto original', 'tipo versión', 'intermedio',
    }
    if all(l.lower() in RUIDO_SOLO or len(l) < 20 for l in lineas_no_vacias):
        return ""
    
    # 2️⃣ Cortar el bloque de metadatos BCN al final
    # El bloque siempre empieza con una línea que dice exactamente "Tipo Versión"
    fin_contenido = len(lineas)
    for i, linea in enumerate(lineas):
        if linea.strip() == 'Tipo Versión':
            fin_contenido = i
            break
    
    contenido_lineas = lineas[:fin_contenido]
    
    # 3️⃣ Limpiar líneas residuales de UI que puedan quedar dentro del contenido
    patrones_ui = re.compile(
        r'^(×|Cerrar|Loading\.\.\.|Copiar|Procesando\.\.\.|Ocultar notas|'
        r'Comparando|Portada|Volver|Navegar Norma|EXPANDIR|Selección|'
        r'Modo oscuro|Alto contraste|Búsqueda avanzada|Formulario de contacto|'
        r'OK, Entendido|Descargar con firma|Descargar ahora sin firma|'
        r'Descarga sin firma|Descarga con Firma|Escuchar|'
        r'Puede descargar el documento inmediatamente.*|'
        r'Esta opción es más rápida.*|ahora sin firma)$'
    )
    
    lineas_limpias = []
    for linea in contenido_lineas:
        if not patrones_ui.match(linea.strip()):
            lineas_limpias.append(linea)
    
    # 4️⃣ Eliminar "Término" suelto al final (si el marcador "Tipo Versión" no existía)
    while lineas_limpias and lineas_limpias[-1].strip() in ('', 'Término'):
        lineas_limpias.pop()
    
    texto_limpio = '\n'.join(lineas_limpias).strip()
    
    return texto_limpio


def procesar_txts():
    # 🔌 Conectar a Qdrant
    try:
        client = QdrantClient("localhost", port=6333)
        logger.info("Conectado a Qdrant")
    except Exception as e:
        logger.error(f"Error conectando a Qdrant: {e}")
        return

    # 🧠 Modelo de embeddings multilingüe (optimizado para español)
    logger.info(f"Cargando modelo: {MODELO_EMBEDDINGS}")
    modelo = SentenceTransformer(MODELO_EMBEDDINGS)

    # 🧱 Crear colección (si no existe)
    colecciones = [c.name for c in client.get_collections().collections]
    if COLECCION not in colecciones:
        client.create_collection(
            collection_name=COLECCION,
            vectors_config=VectorParams(size=384, distance=Distance.COSINE)
        )
        logger.info(f"Colección '{COLECCION}' creada")

    # 🔢 ID incremental
    id_counter = 1
    puntos_batch = []
    archivos_procesados = 0
    archivos_vacios = 0
    errores = 0

    archivos_txt = [f for f in os.listdir(RUTA_TXTS) if f.lower().endswith(".txt")]
    logger.info(f"Encontrados {len(archivos_txt)} archivos TXT")

    # 📄 Procesar TXTs
    for archivo in archivos_txt:
        ruta_txt = os.path.join(RUTA_TXTS, archivo)
        
        try:
            # Leer archivo con manejo de encoding
            texto_crudo = None
            for encoding in ['utf-8', 'latin-1', 'cp1252']:
                try:
                    with open(ruta_txt, 'r', encoding=encoding) as f:
                        texto_crudo = f.read()
                    break
                except UnicodeDecodeError:
                    continue
            
            if texto_crudo is None:
                logger.warning(f"⚠️ {archivo}: No se pudo decodificar el archivo")
                errores += 1
                continue
            
            # 🧹 Limpiar ruido residual de los archivos TXT
            texto_limpio = limpiar_texto_legal(texto_crudo)
            
            if not texto_limpio or len(texto_limpio) < 100:
                archivos_vacios += 1
                logger.warning(f"⚠️ {archivo}: Sin contenido legal extraíble ({len(texto_limpio)} chars)")
                continue
            
            # Derivar nombre legible del archivo
            nombre_norma = os.path.splitext(archivo)[0].replace('_', ' ')
            # Quitar el ID numérico final (ej: "Codigo del Trabajo 207436" → "Codigo del Trabajo")
            nombre_norma = re.sub(r'\s+\d+$', '', nombre_norma)
            
            # ✂️ Dividir en chunks semánticos (documento completo)
            chunks = dividir_texto_legal(texto_limpio)
            chunks_insertados = 0

            for idx, chunk in enumerate(chunks):
                # Ignorar chunks muy pequeños (menos de 100 chars)
                if len(chunk.strip()) < 100:
                    continue
                
                vector = modelo.encode(chunk).tolist()

                puntos_batch.append(PointStruct(
                    id=id_counter,
                    vector=vector,
                    payload={
                        "texto": chunk,
                        "archivo": archivo,
                        "norma": nombre_norma,
                        "chunk_num": idx + 1,
                        "total_chunks": len(chunks),
                        "chars": len(chunk)
                    }
                ))
                id_counter += 1
                chunks_insertados += 1

                # Insertar en lotes para mejor rendimiento
                if len(puntos_batch) >= BATCH_SIZE:
                    client.upsert(collection_name=COLECCION, points=puntos_batch)
                    logger.info(f"   📦 Lote insertado ({BATCH_SIZE} vectores)")
                    puntos_batch = []

            archivos_procesados += 1
            logger.info(f"✓ {nombre_norma} → {chunks_insertados} chunks ({archivos_procesados}/{len(archivos_txt)})")
            
        except Exception as e:
            errores += 1
            logger.error(f"✗ Error en {archivo}: {e}")

    # Insertar puntos restantes
    if puntos_batch:
        client.upsert(collection_name=COLECCION, points=puntos_batch)

    logger.info(f"")
    logger.info(f"{'='*60}")
    logger.info(f"✅ COMPLETADO")
    logger.info(f"   📄 Archivos procesados: {archivos_procesados}")
    logger.info(f"   📊 Total chunks/vectores: {id_counter - 1}")
    logger.info(f"   ⚠️  Archivos vacíos: {archivos_vacios}")
    logger.info(f"   ❌ Errores: {errores}")
    logger.info(f"{'='*60}")


if __name__ == "__main__":
    procesar_txts()