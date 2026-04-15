"""
convert_textures.py
-------------------
Converts TGA textures under models/ to web-ready PNG files.

Usage:
    python convert_textures.py           # convert only new TGAs (no PNG yet)
    python convert_textures.py --force   # re-convert all TGAs, overwriting existing PNGs
    python convert_textures.py --clean   # delete TGA files that already have a PNG

Requires: Pillow  (pip install Pillow)
"""

import argparse
import os
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is not installed. Run:  pip install Pillow")

MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")


def convert(tga_path: str, force: bool):
    """Convert a single TGA to PNG. Returns a status string."""
    png_path = tga_path[:-4] + ".png"

    if not force and os.path.exists(png_path):
        return None  # skip — already converted

    img = Image.open(tga_path)

    # Preserve alpha channel only when present (e.g. _c textures)
    if img.mode != "RGBA":
        img = img.convert("RGB")

    img.save(png_path, "PNG", optimize=True)

    tga_kb = os.path.getsize(tga_path) // 1024
    png_kb = os.path.getsize(png_path) // 1024
    saving = 100 - (100 * png_kb // tga_kb) if tga_kb else 0
    mode   = img.mode

    return f"  {os.path.relpath(tga_path, MODELS_DIR):45s}  {mode}  {tga_kb:6d} KB -> {png_kb:5d} KB  (-{saving}%)"


def main():
    parser = argparse.ArgumentParser(description="TGA -> PNG converter for model textures.")
    parser.add_argument("--force", action="store_true", help="Re-convert even if PNG exists.")
    parser.add_argument("--clean", action="store_true", help="Delete TGAs that have a PNG.")
    args = parser.parse_args()

    if not os.path.isdir(MODELS_DIR):
        sys.exit(f"models/ directory not found at: {MODELS_DIR}")

    tga_files = [
        os.path.join(root, f)
        for root, _, files in os.walk(MODELS_DIR)
        for f in files
        if f.lower().endswith(".tga")
    ]

    if not tga_files:
        print("No TGA files found under models/")
        return

    # ── Conversion pass ──────────────────────────────────────────
    converted = 0
    skipped   = 0

    print(f"Scanning {len(tga_files)} TGA file(s)...\n")

    for tga in sorted(tga_files):
        result = convert(tga, args.force)
        if result:
            print(result)
            converted += 1
        else:
            skipped += 1

    print(f"\nDone. {converted} converted, {skipped} skipped (already had PNG).")

    # ── Optional cleanup pass ─────────────────────────────────────
    if args.clean:
        cleaned = 0
        print("\nCleaning up TGA files with existing PNGs...")
        for tga in sorted(tga_files):
            png = tga[:-4] + ".png"
            if os.path.exists(png):
                os.remove(tga)
                print(f"  Deleted {os.path.relpath(tga)}")
                cleaned += 1
        print(f"{cleaned} TGA file(s) removed.")


if __name__ == "__main__":
    main()
