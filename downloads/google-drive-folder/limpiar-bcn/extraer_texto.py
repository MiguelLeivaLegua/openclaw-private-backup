import argparse
import html
import re
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_HTML_DIR = BASE_DIR / 'html_bcn'
DEFAULT_OUTPUT_DIR = BASE_DIR.parent / 'texto_limpio'

UI_PHRASES = [
    'Contraseña (segura)', 'Repita contraseña', 'Registrarse', '¿Ya tiene una cuenta? Ingrese',
    'Validar correo', 'Loading...', 'Cargando...', 'Descarga sin firma', 'Iniciar sesión', 'Cerrar sesión',
    'Correo electrónico', 'Usuario', 'Ingresar', 'Salir', 'BCN︱Ley Chile', 'BCN|Ley Chile',
    'Biblioteca del Congreso Nacional', 'Búsqueda avanzada', 'Navegar Norma', 'Selección', 'Portada',
    'Modo oscuro', 'Alto contraste', 'Accesibilidad', 'Compartir', 'Imprimir', 'Descargar', 'Exportar',
    'Volver arriba', 'Síguenos en:', 'Políticas de privacidad', 'Mapa del sitio', 'Contacto', 'Ayuda',
    'Versión para imprimir', 'Versión PDF', 'Guardar como PDF',
]


def isolate_main_content(raw: str) -> str:
    idx = raw.find('contenido-norma')
    if idx > 0:
        div_start = raw.rfind('<div', 0, idx)
        if div_start >= 0:
            raw = raw[div_start:]
            for token in ['<bcn-footer', '<footer', 'class="footer', 'tramites-relacionados', 'Trámites relacionados', '>Trámites<']:
                end = raw.find(token)
                if end > 0:
                    raw = raw[:end]
                    break
    return raw


def clean_html_to_text(raw: str) -> str:
    raw = isolate_main_content(raw)
    raw = re.sub(r'<!--[\s\S]*?-->', '', raw, flags=re.S)
    raw = re.sub(r'<script[\s\S]*?</script>', '', raw, flags=re.I)
    raw = re.sub(r'<style[\s\S]*?</style>', '', raw, flags=re.I)
    raw = re.sub(r'<head[\s\S]*?</head>', '', raw, flags=re.I)
    raw = re.sub(r'<(header|footer|nav|aside|form|noscript|iframe|button)[\s\S]*?</\1>', '', raw, flags=re.I)
    raw = re.sub(r'<input[^>]*>', '', raw, flags=re.I)
    raw = re.sub(r'<select[\s\S]*?</select>', '', raw, flags=re.I)
    raw = re.sub(r'<label[\s\S]*?</label>', '', raw, flags=re.I)
    raw = html.unescape(raw)
    raw = re.sub(r'<[^>]+>', '\n', raw, flags=re.S)
    for phrase in UI_PHRASES:
        raw = raw.replace(phrase, '')
    raw = re.sub(r'\b(id|class|role|aria-[a-z]+|data-[a-z-]+|tabindex|style|onclick|onload)\s*=\s*(["\']).*?\2', '', raw, flags=re.I)
    raw = re.sub(r'^\s*(Texto|Versión|Vigencia|Promulgación|Publicación|Encabezado|Tipo Versión|Desde|Hasta|Modificaciones)\s*$', '', raw, flags=re.M)
    raw = re.sub(r'^\s*(Ley Chile\s*-?\s*Ley Chile|Búsqueda avanzada|Acortar|Sin resultados)\s*$', '', raw, flags=re.M | re.I)
    raw = re.sub(r'^\s*\d+\.-\s*$', '', raw, flags=re.M)
    raw = re.sub(r'^\s*[\*\|\-\+]+\s*$', '', raw, flags=re.M)
    raw = re.sub(r'^\s*[a-zA-Z]{1,2}\s*$', '', raw, flags=re.M)
    lines = [line.strip() for line in raw.replace('\r', '\n').split('\n')]
    filtered = []
    last_empty = True
    for line in lines:
        line = re.sub(r'\s+', ' ', line).strip()
        if not line:
            if not last_empty:
                filtered.append('')
            last_empty = True
            continue
        filtered.append(line)
        last_empty = False
    text = '\n'.join(filtered).strip()
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text


def process_dir(html_dir: Path, out_dir: Path):
    out_dir.mkdir(parents=True, exist_ok=True)
    files = sorted(html_dir.glob('*.html'))
    results = []
    for idx, path in enumerate(files, 1):
        text = clean_html_to_text(path.read_text(encoding='utf-8', errors='ignore'))
        out_path = out_dir / f'{path.stem}.txt'
        out_path.write_text(text, encoding='utf-8')
        results.append(out_path)
        print(f'[{idx}/{len(files)}] {path.name} -> {out_path.name}')
    print(f'COMPLETADO: {len(results)} archivos procesados')
    print(f'SALIDA: {out_dir}')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--html-dir', default=str(DEFAULT_HTML_DIR))
    parser.add_argument('--output-dir', default=str(DEFAULT_OUTPUT_DIR))
    args = parser.parse_args()
    process_dir(Path(args.html_dir), Path(args.output_dir))


if __name__ == '__main__':
    main()
