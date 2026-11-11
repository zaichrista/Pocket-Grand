from pathlib import Path

root = Path(__file__).resolve().parent
source = root / "src"
page = (source / "index.html").read_text()
style = (source / "style.css").read_text()
page = page.replace('<link rel="stylesheet" href="style.css">', f'<style>{style}</style>')
for name in ("qr", "grand"):
    script = (source / f"{name}.js").read_text()
    page = page.replace(f'<script src="{name}.js"></script>', f'<script>{script}</script>')
(root / "index.html").write_text(page)
