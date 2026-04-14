"""
🇨🇱 DESCARGADOR DE LEYES BCN CHILE - HTML COMPLETO
==================================================
Script para descargar el HTML completo de las leyes desde la Biblioteca del Congreso Nacional de Chile.
Maneja el contenido dinámico (lazy loading) haciendo scroll hasta el final de la página.

Autor: Proyecto Abogacía
Fecha: 2024
"""

import os
import time
import json
import logging
from datetime import datetime
from pathlib import Path

# Selenium para manejar contenido dinámico
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, WebDriverException

# Para descargar el WebDriver automáticamente
from webdriver_manager.chrome import ChromeDriverManager

# ═══════════════════════════════════════════════════════════════════════════════
# 📌 CONFIGURACIÓN
# ═══════════════════════════════════════════════════════════════════════════════

# Carpeta donde se guardarán los HTML
CARPETA_DESTINO = r"C:\Users\Miguel\Desktop\proyecto Abogacia\Respaldo_Ley_Chile_HTML"

# URL base del BCN
URL_BASE = "https://www.bcn.cl/leychile/navegar?idNorma="

# Configuración del scroll
SCROLL_PAUSE_TIME = 1.5       # Segundos entre cada scroll
SCROLL_INCREMENT = 800        # Pixeles por scroll
MAX_SCROLL_ATTEMPTS = 100     # Máximo de scrolls para evitar loops infinitos
WAIT_AFTER_LOAD = 3           # Segundos de espera después de cargar página

# Configuración del navegador
HEADLESS = False              # True para ejecutar sin ventana visible (más rápido)
WINDOW_WIDTH = 1920
WINDOW_HEIGHT = 1080

# Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[
        logging.FileHandler("descarga_leyes.log", encoding='utf-8'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════════════
# 📚 BIBLIOTECA MAESTRA DE LEYES
# ═══════════════════════════════════════════════════════════════════════════════

biblioteca_maestra = {
    # CÓDIGOS FUNDAMENTALES
    "Constitucion_Politica": "242302",
    "Codigo_Civil": "17290",
    "Codigo_Penal": "1987",
    "Codigo_Procesal_Penal": "176595",
    "Codigo_Procedimiento_Civil": "22740",
    "Codigo_del_Trabajo": "207436",
    "Codigo_de_Comercio": "23238",
    "Codigo_Organico_Tribunales": "25563",
    "Codigo_de_Aguas": "6084",
    "Codigo_de_Mineria": "29668",
    "Codigo_Aeronautico": "30441",

    # OTROS CÓDIGOS RELEVANTES
    "Codigo_Tributario": "6394",
    "Codigo_Aduanero": "1012351",
    "Codigo_Sanitario": "5595",
    "Codigo_Justicia_Militar": "23201",

    # LEYES CLAVE VIDA DIARIA
    "Ley_de_Transito": "25002",
    "Ley_del_Consumidor": "61274",
    "Ley_General_Educacion": "1006043",
    "Ley_de_Inclusion_Escolar": "1078170",
    "Ley_Proteccion_Medio_Ambiente": "30667",
    "Ley_Bases_Admin_Estado": "30159",
    "Ley_de_Transparencia": "276363",
    "Ley_Proteccion_Datos_Personales": "150337",
    "Ley_Responsabilidad_Penal_Adolescente": "243170",
    "Ley_Antidiscriminacion_Zamudio": "1042092",

    # LEYES INSTITUCIONALES Y ECONÓMICAS
    "Ley_Organica_Banco_Central": "30244",
    "Ley_Mercado_Valores": "29419",
    "Ley_Sociedades_Anonimas": "29473",
    "Ley_Insolvencia_Reemprendimiento_Quiebras": "1057375",
    "Ley_de_Municipalidades": "251347",

    # JUSTICIA Y PROCEDIMIENTO
    "Ley_Tribunales_Familia": "228674",
    "Ley_Procedimiento_Administrativo": "212537",
    "Ley_Garantias_Ninez": "1173273",

    # FAMILIA Y SOCIEDAD
    "Ley_Matrimonio_Civil": "225100",
    "Ley_Union_Civil": "1075971",
    "Ley_Violencia_Intrafamiliar": "242648",
    "Ley_Identidad_Genero": "1125895",

    # TRABAJO Y SEGURIDAD SOCIAL
    "Ley_Accidentes_Trabajo": "28650",
    "Ley_Pensiones": "271273",
    "Ley_Seguro_Cesantia": "184515",

    # SALUD Y BIENESTAR
    "Ley_Derechos_Deberes_Paciente": "1043811",
    "Ley_Ricarte_Soto": "1077884",

    # MEDIO AMBIENTE Y RECURSOS
    "Ley_Responsabilidad_Productor_REP": "1090883",
    "Ley_Bosque_Nativo": "276361",

    # ESTADO Y ADMINISTRACIÓN
    "Ley_Organica_Congreso_Nacional": "29102",
    "Ley_Organica_Carabineros": "30282",
    "Ley_Fuerzas_Armadas": "30044",

    # ECONOMÍA Y REGULACIÓN
    "Ley_Libre_Competencia": "219504",
    "Ley_Proteccion_al_Empleo": "1144211"
}


# ═══════════════════════════════════════════════════════════════════════════════
# 🔧 FUNCIONES AUXILIARES
# ═══════════════════════════════════════════════════════════════════════════════

def crear_carpeta_destino():
    """Crea la carpeta de destino si no existe."""
    Path(CARPETA_DESTINO).mkdir(parents=True, exist_ok=True)
    logger.info(f"📁 Carpeta de destino: {CARPETA_DESTINO}")


def configurar_navegador():
    """Configura y retorna una instancia del navegador Chrome."""
    logger.info("🌐 Configurando navegador Chrome...")
    
    opciones = Options()
    
    if HEADLESS:
        opciones.add_argument("--headless=new")
    
    # Configuraciones para mejor rendimiento y compatibilidad
    opciones.add_argument(f"--window-size={WINDOW_WIDTH},{WINDOW_HEIGHT}")
    opciones.add_argument("--disable-gpu")
    opciones.add_argument("--no-sandbox")
    opciones.add_argument("--disable-dev-shm-usage")
    opciones.add_argument("--disable-blink-features=AutomationControlled")
    opciones.add_argument("--lang=es-CL")
    
    # Evitar detección de bot
    opciones.add_experimental_option("excludeSwitches", ["enable-automation"])
    opciones.add_experimental_option("useAutomationExtension", False)
    
    # User agent realista
    opciones.add_argument("user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
    
    try:
        # Usar webdriver_manager para descargar automáticamente ChromeDriver
        servicio = Service(ChromeDriverManager().install())
        navegador = webdriver.Chrome(service=servicio, options=opciones)
        
        # Configurar timeouts
        navegador.set_page_load_timeout(60)
        navegador.implicitly_wait(10)
        
        logger.info("✅ Navegador configurado correctamente")
        return navegador
        
    except Exception as e:
        logger.error(f"❌ Error configurando navegador: {e}")
        raise


def scroll_hasta_el_final(navegador, nombre_ley):
    """
    Hace scroll hasta el final de la página para cargar todo el contenido dinámico.
    Retorna True si el scroll fue exitoso.
    """
    logger.info(f"📜 Iniciando scroll para cargar contenido completo de {nombre_ley}...")
    
    # Obtener altura inicial
    altura_anterior = navegador.execute_script("return document.body.scrollHeight")
    intentos_sin_cambio = 0
    scroll_count = 0
    
    while scroll_count < MAX_SCROLL_ATTEMPTS:
        # Hacer scroll hacia abajo
        navegador.execute_script(f"window.scrollBy(0, {SCROLL_INCREMENT});")
        scroll_count += 1
        
        # Esperar a que cargue el contenido
        time.sleep(SCROLL_PAUSE_TIME)
        
        # Verificar si llegamos al final
        altura_actual = navegador.execute_script("return document.body.scrollHeight")
        posicion_actual = navegador.execute_script("return window.pageYOffset + window.innerHeight")
        
        # Si la altura cambió, hay más contenido
        if altura_actual > altura_anterior:
            altura_anterior = altura_actual
            intentos_sin_cambio = 0
            logger.debug(f"  ↓ Scroll {scroll_count}: Nueva altura detectada ({altura_actual}px)")
        else:
            intentos_sin_cambio += 1
        
        # Si no ha cambiado en 5 intentos y estamos cerca del final, terminamos
        if intentos_sin_cambio >= 5 and posicion_actual >= altura_actual - 100:
            break
    
    # Scroll final al fondo absoluto para asegurar
    navegador.execute_script("window.scrollTo(0, document.body.scrollHeight);")
    time.sleep(SCROLL_PAUSE_TIME)
    
    # Scroll de vuelta arriba y luego abajo (a veces ayuda a cargar contenido faltante)
    navegador.execute_script("window.scrollTo(0, 0);")
    time.sleep(0.5)
    navegador.execute_script("window.scrollTo(0, document.body.scrollHeight);")
    time.sleep(SCROLL_PAUSE_TIME)
    
    altura_final = navegador.execute_script("return document.body.scrollHeight")
    logger.info(f"✅ Scroll completado: {scroll_count} scrolls, altura final: {altura_final}px")
    
    return True


def esperar_carga_contenido(navegador, timeout=30):
    """Espera a que el contenido principal de la ley se cargue."""
    try:
        # Esperar a que aparezca el contenedor principal del texto de la ley
        # Estos selectores son específicos del sitio BCN
        selectores_contenido = [
            "div.texto-norma",
            "div#texto_ley",
            "div.contenido-norma",
            "article.norma",
            "div.ley-content",
            "#contenedorNorma",
            ".cuerpo-norma"
        ]
        
        for selector in selectores_contenido:
            try:
                WebDriverWait(navegador, 5).until(
                    EC.presence_of_element_located((By.CSS_SELECTOR, selector))
                )
                logger.debug(f"  Contenido encontrado con selector: {selector}")
                return True
            except TimeoutException:
                continue
        
        # Si no encontramos selectores específicos, esperar el body
        WebDriverWait(navegador, timeout).until(
            EC.presence_of_element_located((By.TAG_NAME, "body"))
        )
        return True
        
    except TimeoutException:
        logger.warning("⚠️ Timeout esperando contenido, continuando de todos modos...")
        return False


def guardar_html(navegador, nombre_ley, id_norma):
    """Guarda el HTML completo de la página."""
    try:
        # Obtener el HTML completo
        html_completo = navegador.page_source
        
        # También guardar información adicional
        url_actual = navegador.current_url
        titulo_pagina = navegador.title
        
        # Crear nombre de archivo seguro
        nombre_archivo = f"{nombre_ley}_{id_norma}.html"
        ruta_archivo = os.path.join(CARPETA_DESTINO, nombre_archivo)
        
        # Agregar metadatos al HTML
        metadatos = f"""
<!--
═══════════════════════════════════════════════════════════════════════════════
METADATOS DE DESCARGA
═══════════════════════════════════════════════════════════════════════════════
Nombre: {nombre_ley}
ID Norma BCN: {id_norma}
URL: {url_actual}
Título: {titulo_pagina}
Fecha descarga: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
═══════════════════════════════════════════════════════════════════════════════
-->
"""
        
        # Insertar metadatos al inicio del HTML
        html_con_metadatos = metadatos + html_completo
        
        # Guardar archivo
        with open(ruta_archivo, 'w', encoding='utf-8') as f:
            f.write(html_con_metadatos)
        
        # Verificar tamaño
        tamano_kb = os.path.getsize(ruta_archivo) / 1024
        logger.info(f"💾 Guardado: {nombre_archivo} ({tamano_kb:.1f} KB)")
        
        return ruta_archivo, tamano_kb
        
    except Exception as e:
        logger.error(f"❌ Error guardando HTML de {nombre_ley}: {e}")
        return None, 0


def descargar_ley(navegador, nombre_ley, id_norma):
    """
    Descarga una ley individual.
    Retorna un diccionario con información de la descarga.
    """
    url = f"{URL_BASE}{id_norma}"
    resultado = {
        "nombre": nombre_ley,
        "id_norma": id_norma,
        "url": url,
        "exito": False,
        "archivo": None,
        "tamano_kb": 0,
        "error": None
    }
    
    try:
        logger.info(f"\n{'='*60}")
        logger.info(f"📥 Descargando: {nombre_ley}")
        logger.info(f"   ID: {id_norma} | URL: {url}")
        logger.info(f"{'='*60}")
        
        # Navegar a la página
        navegador.get(url)
        
        # Esperar carga inicial
        time.sleep(WAIT_AFTER_LOAD)
        esperar_carga_contenido(navegador)
        
        # Hacer scroll para cargar todo el contenido dinámico
        scroll_hasta_el_final(navegador, nombre_ley)
        
        # Espera adicional después del scroll
        time.sleep(2)
        
        # Guardar el HTML
        archivo, tamano = guardar_html(navegador, nombre_ley, id_norma)
        
        if archivo:
            resultado["exito"] = True
            resultado["archivo"] = archivo
            resultado["tamano_kb"] = tamano
        
    except TimeoutException:
        error_msg = "Timeout al cargar la página"
        logger.error(f"❌ {error_msg}: {nombre_ley}")
        resultado["error"] = error_msg
        
    except WebDriverException as e:
        error_msg = f"Error del WebDriver: {str(e)[:100]}"
        logger.error(f"❌ {error_msg}")
        resultado["error"] = error_msg
        
    except Exception as e:
        error_msg = f"Error inesperado: {str(e)[:100]}"
        logger.error(f"❌ {error_msg}")
        resultado["error"] = error_msg
    
    return resultado


def guardar_resumen(resultados):
    """Guarda un resumen de la descarga en formato JSON."""
    resumen = {
        "fecha_descarga": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        "total_leyes": len(resultados),
        "exitosas": sum(1 for r in resultados if r["exito"]),
        "fallidas": sum(1 for r in resultados if not r["exito"]),
        "tamano_total_kb": sum(r["tamano_kb"] for r in resultados),
        "detalle": resultados
    }
    
    ruta_resumen = os.path.join(CARPETA_DESTINO, "_RESUMEN_DESCARGA.json")
    with open(ruta_resumen, 'w', encoding='utf-8') as f:
        json.dump(resumen, f, ensure_ascii=False, indent=2)
    
    logger.info(f"\n📊 Resumen guardado en: {ruta_resumen}")
    return resumen


# ═══════════════════════════════════════════════════════════════════════════════
# 🚀 FUNCIÓN PRINCIPAL
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    """Función principal del script."""
    logger.info("""
    ╔════════════════════════════════════════════════════════════════════════════╗
    ║  🇨🇱 DESCARGADOR DE LEYES - BIBLIOTECA CONGRESO NACIONAL DE CHILE         ║
    ║                                                                            ║
    ║  Este script descargará el HTML completo de las leyes, incluyendo          ║
    ║  todo el contenido dinámico que se carga con scroll.                       ║
    ╚════════════════════════════════════════════════════════════════════════════╝
    """)
    
    # Crear carpeta de destino
    crear_carpeta_destino()
    
    # Estadísticas
    total_leyes = len(biblioteca_maestra)
    logger.info(f"📚 Total de leyes a descargar: {total_leyes}")
    
    # Lista para guardar resultados
    resultados = []
    
    # Configurar navegador
    navegador = None
    try:
        navegador = configurar_navegador()
        
        # Descargar cada ley
        for i, (nombre_ley, id_norma) in enumerate(biblioteca_maestra.items(), 1):
            logger.info(f"\n[{i}/{total_leyes}] Procesando...")
            
            resultado = descargar_ley(navegador, nombre_ley, id_norma)
            resultados.append(resultado)
            
            # Pausa entre descargas para no sobrecargar el servidor
            if i < total_leyes:
                time.sleep(2)
        
    except KeyboardInterrupt:
        logger.warning("\n⚠️ Descarga interrumpida por el usuario")
        
    except Exception as e:
        logger.error(f"❌ Error fatal: {e}")
        
    finally:
        # Cerrar navegador
        if navegador:
            navegador.quit()
            logger.info("🌐 Navegador cerrado")
    
    # Guardar resumen
    if resultados:
        resumen = guardar_resumen(resultados)
        
        # Mostrar resumen final
        logger.info(f"""
    ╔════════════════════════════════════════════════════════════════════════════╗
    ║                           📊 RESUMEN FINAL                                 ║
    ╠════════════════════════════════════════════════════════════════════════════╣
    ║  ✅ Descargas exitosas:  {resumen['exitosas']:>3} / {resumen['total_leyes']}                                    ║
    ║  ❌ Descargas fallidas:  {resumen['fallidas']:>3}                                              ║
    ║  💾 Tamaño total:        {resumen['tamano_total_kb']:.1f} KB                                  ║
    ║  📁 Carpeta:             {CARPETA_DESTINO}
    ╚════════════════════════════════════════════════════════════════════════════╝
        """)
    
    return resultados


# ═══════════════════════════════════════════════════════════════════════════════
# 🎯 EJECUCIÓN
# ═══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    main()
