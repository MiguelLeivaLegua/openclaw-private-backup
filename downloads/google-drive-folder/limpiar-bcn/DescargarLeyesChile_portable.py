"""
Descargador portable BCN Chile para workspace Linux/OpenClaw.
Guarda HTML en la misma carpeta operativa y deja el texto limpio en ../texto_limpio.
"""

import argparse
import json
import logging
import os
import time
from datetime import datetime
from pathlib import Path

from selenium import webdriver
from selenium.common.exceptions import TimeoutException, WebDriverException
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait
from webdriver_manager.chrome import ChromeDriverManager

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_HTML_DIR = BASE_DIR / "html_bcn"
URL_BASE = "https://www.bcn.cl/leychile/navegar?idNorma="
SCROLL_PAUSE_TIME = 1.5
SCROLL_INCREMENT = 800
MAX_SCROLL_ATTEMPTS = 100
WAIT_AFTER_LOAD = 3
HEADLESS = True
WINDOW_WIDTH = 1920
WINDOW_HEIGHT = 1080

biblioteca_maestra = {
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
    "Codigo_Aduanero": "1012351",
    "Ley_de_Transito": "25002",
    "Ley_del_Consumidor": "61274",
    "Ley_Proteccion_Datos_Personales": "150337",
    "Ley_Procedimiento_Administrativo": "212537",
    "Ley_Accidentes_Trabajo": "28650",
    "Ley_Seguro_Cesantia": "184515",
}


def configure_logging(html_dir: Path) -> logging.Logger:
    logger = logging.getLogger("descargar_leyes_bcn")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()
    fmt = logging.Formatter("%(asctime)s - %(levelname)s - %(message)s")
    fh = logging.FileHandler(html_dir / "descarga_leyes.log", encoding="utf-8")
    fh.setFormatter(fmt)
    sh = logging.StreamHandler()
    sh.setFormatter(fmt)
    logger.addHandler(fh)
    logger.addHandler(sh)
    return logger


def configure_browser() -> webdriver.Chrome:
    options = Options()
    if HEADLESS:
        options.add_argument("--headless=new")
    options.add_argument(f"--window-size={WINDOW_WIDTH},{WINDOW_HEIGHT}")
    options.add_argument("--disable-gpu")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument("--lang=es-CL")
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option("useAutomationExtension", False)
    options.add_argument("user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
    service = Service(ChromeDriverManager().install())
    browser = webdriver.Chrome(service=service, options=options)
    browser.set_page_load_timeout(60)
    browser.implicitly_wait(10)
    return browser


def wait_for_content(browser, timeout=30):
    selectors = [
        "div.texto-norma",
        "div#texto_ley",
        "div.contenido-norma",
        "article.norma",
        "div.ley-content",
        "#contenedorNorma",
        ".cuerpo-norma",
    ]
    for selector in selectors:
        try:
            WebDriverWait(browser, 5).until(EC.presence_of_element_located((By.CSS_SELECTOR, selector)))
            return True
        except TimeoutException:
            continue
    try:
        WebDriverWait(browser, timeout).until(EC.presence_of_element_located((By.TAG_NAME, "body")))
        return True
    except TimeoutException:
        return False


def scroll_to_end(browser):
    last_height = browser.execute_script("return document.body.scrollHeight")
    idle = 0
    for _ in range(MAX_SCROLL_ATTEMPTS):
        browser.execute_script(f"window.scrollBy(0, {SCROLL_INCREMENT});")
        time.sleep(SCROLL_PAUSE_TIME)
        current_height = browser.execute_script("return document.body.scrollHeight")
        position = browser.execute_script("return window.pageYOffset + window.innerHeight")
        if current_height > last_height:
            last_height = current_height
            idle = 0
        else:
            idle += 1
        if idle >= 5 and position >= current_height - 100:
            break
    browser.execute_script("window.scrollTo(0, document.body.scrollHeight);")
    time.sleep(SCROLL_PAUSE_TIME)


def save_html(browser, html_dir: Path, name: str, norma_id: str):
    file_name = f"{name}_{norma_id}.html"
    path = html_dir / file_name
    metadata = f"""\n<!--\nNombre: {name}\nID Norma BCN: {norma_id}\nURL: {browser.current_url}\nTítulo: {browser.title}\nFecha descarga: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n-->\n"""
    path.write_text(metadata + browser.page_source, encoding="utf-8")
    return path


def download_law(browser, html_dir: Path, logger: logging.Logger, name: str, norma_id: str):
    url = f"{URL_BASE}{norma_id}"
    result = {"nombre": name, "id_norma": norma_id, "url": url, "exito": False, "archivo": None, "error": None}
    try:
        logger.info(f"Descargando {name} ({norma_id})")
        browser.get(url)
        time.sleep(WAIT_AFTER_LOAD)
        wait_for_content(browser)
        scroll_to_end(browser)
        time.sleep(2)
        path = save_html(browser, html_dir, name, norma_id)
        result["exito"] = True
        result["archivo"] = str(path)
    except (TimeoutException, WebDriverException, Exception) as exc:
        result["error"] = str(exc)[:300]
        logger.error(f"Error descargando {name}: {result['error']}")
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--html-dir", default=str(DEFAULT_HTML_DIR))
    parser.add_argument("--only", nargs="*", help="Nombres de leyes a descargar")
    args = parser.parse_args()

    html_dir = Path(args.html_dir)
    html_dir.mkdir(parents=True, exist_ok=True)
    logger = configure_logging(html_dir)

    laws = biblioteca_maestra
    if args.only:
        requested = set(args.only)
        laws = {k: v for k, v in biblioteca_maestra.items() if k in requested}

    results = []
    browser = None
    try:
        browser = configure_browser()
        for idx, (name, norma_id) in enumerate(laws.items(), 1):
            logger.info(f"[{idx}/{len(laws)}]")
            results.append(download_law(browser, html_dir, logger, name, norma_id))
            if idx < len(laws):
                time.sleep(2)
    finally:
        if browser:
            browser.quit()

    summary = {
        "fecha_descarga": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "total_leyes": len(results),
        "exitosas": sum(1 for r in results if r["exito"]),
        "fallidas": sum(1 for r in results if not r["exito"]),
        "detalle": results,
    }
    (html_dir / "_RESUMEN_DESCARGA.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
