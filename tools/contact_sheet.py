import csv
import glob
import hashlib
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.path.join(ROOT, "_work")
PER_SHEET = 25
TILE = 190
LABEL_H = 26
COLS = 5

os.makedirs(WORK, exist_ok=True)

files = sorted(glob.glob(os.path.join(ROOT, "*.jpeg")))

seen = {}
unique = []
dupes = []
for path in files:
    with open(path, "rb") as fh:
        digest = hashlib.md5(fh.read()).hexdigest()
    if digest in seen:
        dupes.append((os.path.basename(path), seen[digest]))
    else:
        seen[digest] = os.path.basename(path)
        unique.append(path)

with open(os.path.join(WORK, "index_map.csv"), "w", newline="", encoding="utf-8") as fh:
    writer = csv.writer(fh)
    writer.writerow(["index", "filename", "bytes"])
    for i, path in enumerate(unique, 1):
        writer.writerow([i, os.path.basename(path), os.path.getsize(path)])

for sheet_no in range(0, (len(unique) + PER_SHEET - 1) // PER_SHEET):
    batch = unique[sheet_no * PER_SHEET:(sheet_no + 1) * PER_SHEET]
    rows = (len(batch) + COLS - 1) // COLS
    width = COLS * TILE
    height = rows * (TILE + LABEL_H)
    canvas = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(canvas)
    for offset, path in enumerate(batch):
        index = sheet_no * PER_SHEET + offset + 1
        col, row = offset % COLS, offset // COLS
        x, y = col * TILE, row * (TILE + LABEL_H)
        try:
            im = Image.open(path)
            im.thumbnail((TILE - 8, TILE - 8))
            canvas.paste(im, (x + 4, y + 4))
        except Exception as exc:
            draw.text((x + 6, y + 6), "ERR " + str(exc)[:40])
        short = str(index) + " " + os.path.basename(path).replace("WhatsApp Image 2026-11-02 at ", "")[:22]
        draw.text((x + 4, y + TILE - 2), short, fill="black")
    out = os.path.join(WORK, "sheet_%02d.png" % (sheet_no + 1))
    canvas.save(out, optimize=True)
    print("wrote", out, len(batch), "tiles", canvas.size)

print("total files", len(files), "| unique", len(unique), "| duplicates", len(dupes))
for name, kept in dupes:
    print("  dup:", name, "== kept:", kept)
