"""Genera las vistas previas SVG, los archivos descargables de ejemplo y las imágenes PNG del sitio.

Uso: python scripts/generate-assets.py
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

BASE = Path(__file__).resolve().parents[1]
PREVIEWS = BASE / "public" / "uploads" / "resources"
DOWNLOADS = BASE / "public" / "descargas"

RESOURCES = [
    ("verso-diseno-divino", "Verso: Diseño Divino", "#2900ff", "#2563eb", "Salmo 139:14"),
    ("fondo-noche-estrellada", "Fondo Noche Estrellada", "#0f172a", "#4338ca", "Dios es luz"),
    ("letra-corazon-alabanza", "Letra: Corazón de Alabanza", "#7c3aed", "#db2777", "Te alabo, Señor"),
    ("titulo-celebracion", "Título: Celebración", "#f97316", "#db2777", "Hoy hay alegría"),
    ("loop-de-luz", "Loop de Luz", "#0d9488", "#3b82f6", "Luz para el camino"),
    ("iconos-adoracion", "Pack Iconos de Adoración", "#059669", "#84cc16", "Adoración"),
    ("fondo-avivamiento", "Fondo Avivamiento", "#b91c1c", "#f97316", "Aviva tu obra"),
    ("plantilla-anuncios", "Plantilla de Anuncios", "#1d4ed8", "#0ea5e9", "Anuncios"),
    ("letra-gracia-sobrepasante", "Letra: Gracia Sobrepasante", "#4338ca", "#7c3aed", "Gracia sobre gracia"),
    ("verso-fundamento", "Verso: Fundamento", "#334155", "#0f766e", "Sobre roca firme"),
    ("fondo-navidad", "Fondo Navidad", "#166534", "#ca8a04", "Emmanuel"),
    ("loop-particulas", "Loop Partículas", "#6d28d9", "#2563eb", "Espíritu y vida"),
]


def esc(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def svg_preview(slug: str, title: str, c1: str, c2: str, verse: str) -> str:
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720" role="img" aria-label="{esc(title)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{c1}"/><stop offset="1" stop-color="{c2}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.75" cy="0.2" r="0.7">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.35"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#bg)"/>
  <rect width="1280" height="720" fill="url(#glow)"/>
  <circle cx="1080" cy="130" r="220" fill="#ffffff" opacity="0.06"/>
  <circle cx="180" cy="640" r="260" fill="#000000" opacity="0.10"/>
  <text x="70" y="90" font-family="Arial, sans-serif" font-size="22" font-weight="bold" letter-spacing="4" fill="#ffffff" opacity="0.75">PROLYRICS PRO</text>
  <text x="70" y="390" font-family="Arial, sans-serif" font-size="72" font-weight="bold" fill="#ffffff">{esc(title)}</text>
  <text x="70" y="455" font-family="Arial, sans-serif" font-size="32" fill="#ffffff" opacity="0.8">{esc(verse)}</text>
  <rect x="70" y="510" width="140" height="6" rx="3" fill="#ffffff" opacity="0.7"/>
  <text x="70" y="660" font-family="Arial, sans-serif" font-size="18" letter-spacing="3" fill="#ffffff" opacity="0.55">VISTA PREVIA · 16:9</text>
</svg>
'''


def svg_download(title: str, c1: str, c2: str, verse: str) -> str:
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="1920" height="1080" role="img" aria-label="{esc(title)}">
  <defs>
    <linearGradient id="slide" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{c1}"/><stop offset="1" stop-color="{c2}"/>
    </linearGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#slide)"/>
  <circle cx="1560" cy="220" r="320" fill="#ffffff" opacity="0.06"/>
  <circle cx="260" cy="940" r="380" fill="#000000" opacity="0.08"/>
  <text x="120" y="150" font-family="Arial, sans-serif" font-size="30" font-weight="bold" letter-spacing="5" fill="#ffffff" opacity="0.7">PROLYRICS PRO</text>
  <text x="120" y="560" font-family="Arial, sans-serif" font-size="110" font-weight="bold" fill="#ffffff">{esc(title)}</text>
  <text x="120" y="660" font-family="Arial, sans-serif" font-size="46" fill="#ffffff" opacity="0.85">{esc(verse)}</text>
  <rect x="120" y="730" width="220" height="8" rx="4" fill="#ffffff" opacity="0.6"/>
</svg>
'''


def font(size: int, bold: bool = False):
    candidates = [
        "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def make_pngs():
    BASE.joinpath("public").mkdir(exist_ok=True)

    # OG image 1200x630
    img = Image.new("RGB", (1200, 630))
    px = img.load()
    for y in range(630):
        for x in range(1200):
            t = (x / 1200 + y / 630) / 2
            px[x, y] = (int(41 + 30 * t), int(0 + 20 * t), int(255 - 120 * t))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle((70, 70, 130, 130), radius=18, fill=(139, 92, 246))
    draw.text((86, 82), "P", font=font(34, True), fill="white")
    draw.text((160, 78), "PROLYRICS", font=font(38, True), fill="white")
    draw.text((160, 124), "PRO", font=font(22, True), fill=(196, 181, 253))
    draw.text((70, 250), "Proyección para", font=font(66, True), fill="white")
    draw.text((70, 340), "iglesias modernas", font=font(66, True), fill=(196, 181, 253))
    draw.text((72, 470), "Plantillas · Fondos · Canciones · Videos", font=font(28), fill=(203, 213, 225))
    img.save(BASE / "public" / "og-image.png", optimize=True)

    # Iconos PNG
    icon = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    d = ImageDraw.Draw(icon)
    d.rounded_rectangle((0, 0, 511, 511), radius=110, fill=(124, 58, 237, 255))
    d.line((170, 370, 170, 140, 350, 110, 350, 340), fill="white", width=26, joint="curve")
    d.ellipse((125, 340, 215, 430), fill="white")
    d.ellipse((305, 310, 395, 400), fill="white")
    for size, name in [(180, "apple-touch-icon.png"), (32, "favicon-32x32.png"), (16, "favicon-16x16.png")]:
        icon.resize((size, size), Image.LANCZOS).save(BASE / "public" / name, optimize=True)


def main():
    PREVIEWS.mkdir(parents=True, exist_ok=True)
    DOWNLOADS.mkdir(parents=True, exist_ok=True)

    for slug, title, c1, c2, verse in RESOURCES:
        (PREVIEWS / f"{slug}.svg").write_text(svg_preview(slug, title, c1, c2, verse), encoding="utf-8")
        (DOWNLOADS / f"{slug}.svg").write_text(svg_download(title, c1, c2, verse), encoding="utf-8")

    make_pngs()
    print(f"Generados {len(RESOURCES)} recursos y las imágenes del sitio.")


if __name__ == "__main__":
    main()
