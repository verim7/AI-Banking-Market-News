"""Square each fetched logo onto a 128px transparent canvas, like the others.

Trims transparent borders, scales the logo to fit 128x128 without changing
its proportions, and centres it. Run by .github/workflows/fetch-logos.yml
between `logos.ts --plan` and `logos.ts --apply`.
"""
import json
import sys
from pathlib import Path

from PIL import Image

SIZE = 128

def square(path: Path) -> None:
    img = Image.open(path).convert("RGBA")
    box = img.getchannel("A").getbbox()
    if box:
        img = img.crop(box)
    img.thumbnail((SIZE, SIZE), Image.LANCZOS)
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    canvas.paste(img, ((SIZE - img.width) // 2, (SIZE - img.height) // 2), img)
    canvas.save(path, "PNG", optimize=True)

def main(plan_dir: str) -> None:
    manifest = json.loads((Path(plan_dir) / "manifest.json").read_text())
    for found in manifest["found"]:
        square(Path(found["png"]))
        print(f"Squared {found['slug']}")

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "logo-plan")
