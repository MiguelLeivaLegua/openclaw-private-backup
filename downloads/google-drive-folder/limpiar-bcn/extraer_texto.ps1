# =============================================================================
# Script: extraer_texto.ps1
# Descripcion: Extrae texto limpio de todos los archivos HTML del directorio,
#              eliminando etiquetas HTML, scripts, estilos y JS.
# Salida: Archivos .txt en subcarpeta "texto_limpio"
# =============================================================================

$dirBase   = Split-Path -Parent $MyInvocation.MyCommand.Path
$dirSalida = Join-Path $dirBase "texto_limpio"

# Crear directorio de salida si no existe
if (-not (Test-Path $dirSalida)) {
    New-Item -ItemType Directory -Path $dirSalida | Out-Null
    Write-Host "Carpeta creada: $dirSalida" -ForegroundColor Cyan
}

# Cargar el helper de Regex via Add-Type para evitar problemas de sintaxis
Add-Type -Language CSharp @"
using System;
using System.Text;
using System.Text.RegularExpressions;

public static class HtmlTextExtractor {
    public static string Extract(string html) {
        // 0. PRIMERO: Intentar extraer solo el contenido de la norma legal
        int startIdx = html.IndexOf("contenido-norma");
        if (startIdx > 0) {
            // Buscar el inicio del div que contiene contenido-norma
            int divStart = html.LastIndexOf("<div", startIdx);
            if (divStart >= 0) {
                // Extraer desde ahi hasta el final del documento
                html = html.Substring(divStart);
                // Buscar donde termina el contenido principal (antes del footer o tramites relacionados)
                int footerIdx = html.IndexOf("<bcn-footer");
                if (footerIdx < 0) footerIdx = html.IndexOf("<footer");
                if (footerIdx < 0) footerIdx = html.IndexOf("class=\"footer");
                if (footerIdx < 0) footerIdx = html.IndexOf("tramites-relacionados", StringComparison.OrdinalIgnoreCase);
                if (footerIdx < 0) footerIdx = html.IndexOf("Trámites relacionados", StringComparison.OrdinalIgnoreCase);
                if (footerIdx < 0) footerIdx = html.IndexOf("tramites relacionados", StringComparison.OrdinalIgnoreCase);
                if (footerIdx < 0) footerIdx = html.IndexOf(">Trámites<", StringComparison.OrdinalIgnoreCase);
                if (footerIdx > 0) {
                    html = html.Substring(0, footerIdx);
                }
            }
        }
        
        // 1. Eliminar comentarios HTML
        html = Regex.Replace(html, @"<!--[\s\S]*?-->", "", RegexOptions.Singleline);

        // 2. Eliminar bloques <script>
        html = Regex.Replace(html, @"<script[\s\S]*?</script>", "", RegexOptions.IgnoreCase | RegexOptions.Singleline);

        // 3. Eliminar bloques <style>
        html = Regex.Replace(html, @"<style[\s\S]*?</style>", "", RegexOptions.IgnoreCase | RegexOptions.Singleline);

        // 4. Eliminar bloque <head>
        html = Regex.Replace(html, @"<head[\s\S]*?</head>", "", RegexOptions.IgnoreCase | RegexOptions.Singleline);

        // 4b. Eliminar bloques de interfaz web (header, nav, footer, aside, formularios)
        html = Regex.Replace(html, @"<header[\s\S]*?</header>", "", RegexOptions.IgnoreCase | RegexOptions.Singleline);
        html = Regex.Replace(html, @"<footer[\s\S]*?</footer>", "", RegexOptions.IgnoreCase | RegexOptions.Singleline);
        html = Regex.Replace(html, @"<nav[\s\S]*?</nav>", "", RegexOptions.IgnoreCase | RegexOptions.Singleline);
        html = Regex.Replace(html, @"<aside[\s\S]*?</aside>", "", RegexOptions.IgnoreCase | RegexOptions.Singleline);
        html = Regex.Replace(html, @"<form[\s\S]*?</form>", "", RegexOptions.IgnoreCase | RegexOptions.Singleline);
        html = Regex.Replace(html, @"<noscript[\s\S]*?</noscript>", "", RegexOptions.IgnoreCase | RegexOptions.Singleline);
        html = Regex.Replace(html, @"<iframe[\s\S]*?</iframe>", "", RegexOptions.IgnoreCase | RegexOptions.Singleline);
        
        // 4c. Eliminar divs con clases/ids de UI comunes (modal, menu, toolbar, sidebar, popup, cookie, banner, alert)
        html = Regex.Replace(html, @"<div[^>]*(class|id)\s*=\s*[""'][^""']*(modal|menu|toolbar|sidebar|popup|cookie|banner|alert|notification|toast|overlay|dialog|dropdown|accordion|tab-content|tabpanel|login|register|signup|signin|search-form|social|share|widget|ads|advertisement)[^""']*[""'][^>]*>[\s\S]*?</div>", "", RegexOptions.IgnoreCase | RegexOptions.Singleline);
        
        // 4d. Eliminar botones y controles de UI
        html = Regex.Replace(html, @"<button[\s\S]*?</button>", "", RegexOptions.IgnoreCase | RegexOptions.Singleline);
        html = Regex.Replace(html, @"<input[^>]*>", "", RegexOptions.IgnoreCase | RegexOptions.Singleline);
        html = Regex.Replace(html, @"<select[\s\S]*?</select>", "", RegexOptions.IgnoreCase | RegexOptions.Singleline);
        html = Regex.Replace(html, @"<label[\s\S]*?</label>", "", RegexOptions.IgnoreCase | RegexOptions.Singleline);

        // 5. Convertir entidades HTML comunes
        html = html.Replace("&nbsp;",  " ");
        html = html.Replace("&amp;",   "&");
        html = html.Replace("&lt;",    "<");
        html = html.Replace("&gt;",    ">");
        html = html.Replace("&quot;",  "\"");
        html = html.Replace("&apos;",  "'");
        html = html.Replace("&#160;",  " ");
        html = html.Replace("&laquo;", "\u00AB");
        html = html.Replace("&raquo;", "\u00BB");
        html = html.Replace("&deg;",   "\u00B0");
        html = html.Replace("&sect;",  "\u00A7");
        html = html.Replace("&ordm;",  "\u00BA");
        html = html.Replace("&ordf;",  "\u00AA");
        html = html.Replace("&times;", "x");
        html = html.Replace("&copy;",  "\u00A9");
        html = html.Replace("&reg;",   "\u00AE");
        html = html.Replace("&#176;",  "\u00B0");
        html = html.Replace("&#167;",  "\u00A7");
        html = html.Replace("&#186;",  "\u00BA");
        html = html.Replace("&#170;",  "\u00AA");
        html = html.Replace("&#8211;", "-");
        html = html.Replace("&#8212;", "--");
        html = html.Replace("&#8220;", "\"");
        html = html.Replace("&#8221;", "\"");
        html = html.Replace("&#8216;", "'");
        html = html.Replace("&#8217;", "'");

        // Entidades numericas genericas &#NNN; y &#xHH;
        html = Regex.Replace(html, @"&#x([0-9a-fA-F]+);", m => {
            try { return ((char)Convert.ToInt32(m.Groups[1].Value, 16)).ToString(); }
            catch { return ""; }
        });
        html = Regex.Replace(html, @"&#([0-9]+);", m => {
            try { return ((char)int.Parse(m.Groups[1].Value)).ToString(); }
            catch { return ""; }
        });
        // Entidades &xxx; desconocidas restantes
        html = Regex.Replace(html, @"&[a-zA-Z]{2,8};", " ");

        // 6. Eliminar todas las etiquetas HTML restantes
        html = Regex.Replace(html, @"<[^>]+>", "", RegexOptions.Singleline);

        // 6b. Eliminar atributos HTML residuales (id="...", class="...", role="...", etc.)
        html = Regex.Replace(html, @"\b(id|class|role|aria-[a-z]+|data-[a-z-]+|tabindex|style|onclick|onload)\s*=\s*""[^""]*""", "", RegexOptions.IgnoreCase);
        html = Regex.Replace(html, @"\b(id|class|role|aria-[a-z]+|data-[a-z-]+|tabindex|style|onclick|onload)\s*=\s*'[^']*'", "", RegexOptions.IgnoreCase);

        // 6c. Eliminar frases de UI especificas del sitio BCN/Ley Chile
        string[] frasesUI = new string[] {
            // Formularios de login/registro
            "Contraseña (segura)", "Repita contraseña", "Registrarse", "¿Ya tiene una cuenta? Ingrese",
            "Seleccione las notificaciones a registrar", "Para registrar notificaciones debe ingresar un correo electrónico",
            "Validar correo", "Loading...", "Cargando...", "Descarga sin firma",
            "Puede descargar el documento inmediatamente, pero sin firma electrónica avanzada",
            "Esta opción es más rápida, pero no incluye elementos de validación digital",
            "Informamos a nuestros usuarios que, por inconvenientes técnicos",
            "Iniciar sesión", "Cerrar sesión", "Mi cuenta", "Recuperar contraseña",
            "Correo electrónico", "Usuario", "Ingresar", "Salir",
            // Navegacion del sitio BCN
            "BCN︱Ley Chile", "BCN|Ley Chile", "- Biblioteca l Congreso Nacional", "Biblioteca del Congreso Nacional",
            "Búsqueda avanzada", "Navegar Norma", "Selección", "Portada",
            "Encabezado", "Tipo Versión", "Versiones", 
            "Modo oscuro", "Alto contraste", "Accesibilidad",
            // Botones y acciones
            "OK", "Entendido", "Aceptar", "Cancelar", "Cerrar",
            "Compartir", "Imprimir", "Descargar", "Exportar", "Copiar",
            "Volver arriba", "Ir al contenido", "Saltar navegación",
            "Seleccionar todo", "Deseleccionar todo", "Filtrar", "Ordenar",
            "Anterior", "Siguiente", "Primera", "Última", "Página",
            // Footer y redes sociales
            "Síguenos en:", "Políticas de privacidad", "Mapa del sitio", "Metadatos internos",
            "Facebook", "Twitter", "LinkedIn", "WhatsApp", "Instagram",
            "© Biblioteca del Congreso Nacional de Chile", "Todos los derechos reservados",
            "Contacto", "Ayuda", "FAQ", "Preguntas frecuentes",
            "Versión para imprimir", "Versión PDF", "Guardar como PDF"
        };
        foreach (string frase in frasesUI) {
            html = html.Replace(frase, "");
        }

        // 6d. Eliminar residuos de etiquetas HTML mal formadas
        html = Regex.Replace(html, @"[""]?\s*>", "", RegexOptions.None);
        html = Regex.Replace(html, @"<\s*[""]?", "", RegexOptions.None);

        // 6e. Eliminar lineas que solo contienen palabras sueltas de navegacion
        html = Regex.Replace(html, @"^\s*(Texto|Versión|Vigencia|Promulgación|Publicación|Artículo \d+)\s*$", "", RegexOptions.Multiline);
        html = Regex.Replace(html, @"^\s*(Selección|Decreto \d+|Encabezado|Tipo Versión|Desde|Hasta|Modificaciones)\s*$", "", RegexOptions.Multiline);
        html = Regex.Replace(html, @"^\s*Ley Chile\s*-?\s*Ley Chile\s*$", "", RegexOptions.Multiline);
        html = Regex.Replace(html, @"^\s*Búsqueda avanzada\s*$", "", RegexOptions.Multiline);
        html = Regex.Replace(html, @"^\s*(Acortar|Sin resultados)\s*$", "", RegexOptions.Multiline);
        // Eliminar lineas de menu de tramites (lineas cortas que empiezan con numero y guion)
        html = Regex.Replace(html, @"^\s*\d{1,2}\.-\s+[A-Z][a-záéíóúñü\s]{3,60}(contacto|electoral|salud|partido|exterior|servicio)\s*$", "", RegexOptions.Multiline | RegexOptions.IgnoreCase);
        // Eliminar la frase "Término encontrado en la siguiente parte" que quedó separada en lineas
        html = Regex.Replace(html, @"^\s*Término\s*$", "", RegexOptions.Multiline);
        html = Regex.Replace(html, @"^\s*encontrado en\s*$", "", RegexOptions.Multiline);
        html = Regex.Replace(html, @"^\s*la siguiente\s*$", "", RegexOptions.Multiline);
        html = Regex.Replace(html, @"^\s*parte\.?\s*$", "", RegexOptions.Multiline);
        // Eliminar lineas que son solo un numero seguido de guion
        html = Regex.Replace(html, @"^\s*\d+\.-\s*$", "", RegexOptions.Multiline);
        
        // 6f. Eliminar lineas que solo contienen simbolos o caracteres sueltos
        html = Regex.Replace(html, @"^\s*[\*\|\-\+]+\s*$", "", RegexOptions.Multiline);
        html = Regex.Replace(html, @"^\s*[a-zA-Z]{1,2}\s*$", "", RegexOptions.Multiline); // letras sueltas
        html = Regex.Replace(html, @"^\s*:\s*$", "", RegexOptions.Multiline); // dos puntos sueltos
        html = Regex.Replace(html, @"^\s*Única\s*-?\s*$", "", RegexOptions.Multiline);
        html = Regex.Replace(html, @"^\s*Versión:\s*$", "", RegexOptions.Multiline);

        // 7. Normalizar saltos de linea y espacios
        html = html.Replace("\r\n", "\n").Replace("\r", "\n");

        // 8. Colapsar multiples lineas vacias en una sola
        html = Regex.Replace(html, @"\n[ \t]*\n[ \t]*\n+", "\n\n");

        // 9. Limpiar espacios al inicio/fin de cada linea
        string[] lines = html.Split('\n');
        StringBuilder sb = new StringBuilder();
        bool lastEmpty = false;
        foreach (string line in lines) {
            string trimmed = line.Trim();
            if (trimmed.Length == 0) {
                if (!lastEmpty) { sb.AppendLine(""); }
                lastEmpty = true;
            } else {
                sb.AppendLine(trimmed);
                lastEmpty = false;
            }
        }

        return sb.ToString().Trim();
    }
}
"@

# Obtener archivos HTML
$archivos = Get-ChildItem -Path $dirBase -Filter "*.html" -File
$total    = $archivos.Count
$contador = 0

Write-Host ""
Write-Host "=====================================================" -ForegroundColor Yellow
Write-Host "  EXTRACCION DE TEXTO - Leyes Chile BCN" -ForegroundColor Yellow
Write-Host "=====================================================" -ForegroundColor Yellow
Write-Host "  Total archivos encontrados: $total" -ForegroundColor White
Write-Host "=====================================================" -ForegroundColor Yellow
Write-Host ""

foreach ($archivo in $archivos) {
    $contador++
    $nombreBase    = [IO.Path]::GetFileNameWithoutExtension($archivo.Name)
    $archivoSalida = Join-Path $dirSalida "$nombreBase.txt"

    Write-Host "[$contador/$total] $($archivo.Name)" -ForegroundColor Cyan -NoNewline

    try {
        $html      = [IO.File]::ReadAllText($archivo.FullName, [Text.Encoding]::UTF8)
        $texto     = [HtmlTextExtractor]::Extract($html)
        [IO.File]::WriteAllText($archivoSalida, $texto, [Text.Encoding]::UTF8)

        $tamOrig  = $archivo.Length
        $tamNuevo = (Get-Item $archivoSalida).Length
        $pct      = [math]::Round((1 - $tamNuevo / $tamOrig) * 100, 1)

        Write-Host "  OK ($pct% reduccion)" -ForegroundColor Green
    }
    catch {
        Write-Host "  ERROR: $_" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "=====================================================" -ForegroundColor Yellow
Write-Host "  COMPLETADO: $contador archivos procesados" -ForegroundColor Green
Write-Host "  Guardados en: $dirSalida" -ForegroundColor White
Write-Host "=====================================================" -ForegroundColor Yellow
