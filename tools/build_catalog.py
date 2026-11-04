import csv
import glob
import hashlib
import json
import os
import re
from collections import OrderedDict

from PIL import Image, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIGINALS = os.path.join(ROOT, "_originals")
IMG_OUT = os.path.join(ROOT, "public", "img")
DATA_OUT = os.path.join(ROOT, "data")

CATEGORY_LABELS = {
    "mens-slides": "Men's Slides",
    "mens-shoes": "Men's Shoes",
    "womens-slides": "Women's Slides",
    "womens-sandals": "Women's Sandals",
    "heels": "Heels & Wedges",
    "womens-shoes": "Women's Flats & Loafers",
    "kids": "Kids",
    "fur-slippers": "Fur Slippers",
}

# index, name, category, supplier code, visible size run
ROWS = [
    (1, "Men's Penny Loafer", "mens-shoes", "PIC-36", ""),
    (2, "Men's Double-Buckle Slide", "mens-slides", "YCY010", "37-42"),
    (3, "Men's Double-Buckle Slide", "mens-slides", "YCY237", "37-42"),
    (4, "Men's Penny Loafer", "mens-shoes", "PIC-36", ""),
    (5, "Women's Buckle Slide Sandal", "womens-slides", "", ""),
    (6, "Women's Slide Sandal", "womens-slides", "", ""),
    (7, "Men's Double-Buckle Slide", "mens-slides", "060-09", "37-42"),
    (8, "Men's Double-Buckle Slide", "mens-slides", "YCQ102", "37-42"),
    (9, "Men's Double-Buckle Slide", "mens-slides", "030-71", "37-42"),
    (10, "Men's Cross-Strap Slide", "mens-slides", "AT9159-02", "40-45"),
    (11, "Men's Cross-Strap Slide", "mens-slides", "AT9159-02", "40-45"),
    (12, "Chunky Low-Top Sneaker", "womens-shoes", "", "36-41"),
    (13, "Retro Panel Sneaker", "womens-shoes", "", ""),
    (14, "Two-Tone Court Sneaker", "womens-shoes", "", ""),
    (15, "Men's Double-Buckle Slide", "mens-slides", "030-71", "37-42"),
    (16, "Kids High-Top Sneaker", "kids", "H-03", ""),
    (17, "Women's Two-Piece Buckle Sandal", "womens-sandals", "", ""),
    (18, "Women's Pointed Flats", "womens-shoes", "", ""),
    (19, "Women's Gold-Buckle Loafer", "womens-shoes", "", ""),
    (20, "Kids Low-Top Sneaker", "kids", "TCW-807", "31-36"),
    (21, "Women's Hardware Loafer", "womens-shoes", "", ""),
    (22, "Court Sneaker", "womens-shoes", "SAF-537", "36-41"),
    (23, "Kids Printed Sandal", "kids", "", ""),
    (24, "Women's Thong Slide", "womens-slides", "XB-10", ""),
    (25, "Men's Double-Buckle Slide", "mens-slides", "0197-JY11", "36-41"),
    (26, "Women's Glitter Slide", "womens-slides", "FB-2", ""),
    (27, "Women's Criss-Cross Slide", "womens-slides", "XB-18", ""),
    (28, "Women's Printed Slide", "womens-slides", "", ""),
    (29, "Women's Floral Slide", "womens-slides", "HG-1", ""),
    (30, "Women's Glitter Slide", "womens-slides", "FB-5", ""),
    (31, "Women's Block-Heel Sandal", "heels", "MU7853", "37-42"),
    (32, "Women's Buckle Mule", "womens-shoes", "HS-5882", "37-41"),
    (33, "Women's T-Strap Slide Sandal", "womens-sandals", "", ""),
    (34, "Women's Wide-Strap Slide", "womens-slides", "LTA282A", "37-41"),
    (35, "Women's Mary-Jane Sandal", "womens-sandals", "", ""),
    (36, "Women's Woven Slide", "womens-slides", "", "36-41"),
    (37, "Women's Embellished Slide", "womens-slides", "", ""),
    (38, "Men's Logo Slide", "mens-slides", "DA176S", "40-45"),
    (39, "Women's Woven Clog", "womens-shoes", "MM-7", ""),
    (40, "Women's Slide Sandal", "womens-slides", "HS-5889", "37-41"),
    (41, "Men's Double-Buckle Slide", "mens-slides", "C-17", "36-41"),
    (42, "Men's Double-Buckle Slide", "mens-slides", "C-21", "36-41"),
    (43, "Women's Pointed Mule", "womens-shoes", "2025-A24", ""),
    (44, "Men's Low-Top Sneaker", "mens-shoes", "FB-029", "37-42"),
    (45, "Women's Heeled Sandal", "heels", "G790-4L", "31-36"),
    (46, "Men's Logo Slide", "mens-slides", "DA8758", "40-45"),
    (47, "Women's Strappy Sandal", "womens-sandals", "", ""),
    (48, "Men's Penny Loafer", "mens-shoes", "PIC-36", ""),
    (49, "Women's Pointed Mule", "womens-shoes", "B305-12305", "37-42"),
    (50, "Men's Double-Buckle Slide", "mens-slides", "", ""),
    (51, "Women's Bow Flat", "womens-shoes", "D6600-5", "37-42"),
    (52, "Kids Heeled Sandal", "kids", "G36008-1601", "31-36"),
    (53, "Women's Ankle-Strap Sandal", "womens-sandals", "", ""),
    (54, "Women's Bow Flat", "womens-shoes", "D6600-8", "37-42"),
    (55, "Women's Ankle-Strap Block Heel", "heels", "", ""),
    (56, "Kids Mary-Jane Shoe", "kids", "GA-100-5L", "31-36"),
    (57, "Kids Heeled Sandal", "kids", "G66008-1601M", "25-30"),
    (58, "Women's T-Strap Sandal", "womens-sandals", "G56791", "37-42"),
    (59, "Women's Quilted Slide", "womens-slides", "TB045-016-5", "37-42"),
    (60, "Kids Heeled Sandal", "kids", "G66008-3011M", "25-30"),
    (61, "Kids Mary-Jane Shoe", "kids", "GA749-6M", "25-30"),
    (62, "Women's Court Heel", "heels", "G5622-28", ""),
    (63, "Women's Slide Sandal", "womens-slides", "G56796", "37-42"),
    (64, "Kids Mary-Jane Shoe", "kids", "H58-1641", "31-36"),
    (65, "Women's Buckle Slide", "womens-slides", "GA961-13", "37-42"),
    (66, "Fur Slide", "fur-slippers", "Y-09C", ""),
    (67, "Fur Slide", "fur-slippers", "Y-06", ""),
    (68, "Men's Woven Clog", "mens-shoes", "MB-1A", "40-45"),
    (69, "Women's T-Strap Clog", "womens-shoes", "SM2002", "37-42"),
    (70, "Men's Loafer", "mens-shoes", "LA-N1016", ""),
    (71, "Fur Slide", "fur-slippers", "Y-16C", ""),
    (72, "Fur Cross Slide", "fur-slippers", "Y-01C", ""),
    (73, "Women's Double-Buckle Clog", "womens-shoes", "SM2001", "37-42"),
    (74, "Women's Cross-Strap Slide", "womens-slides", "M01-127", ""),
    (75, "Women's Thong Slide", "womens-slides", "P2168-0474", "37-42"),
    (76, "Fur Slide", "fur-slippers", "Y-13C", ""),
    (77, "Women's Bow Loafer", "womens-shoes", "SP-7", ""),
    (78, "Women's Mule Flat", "womens-shoes", "B8140-1364D", "37-42"),
    (79, "Women's Letter Slide", "womens-slides", "P2168-12359", "37-42"),
    (80, "Kids Heeled Sandal", "kids", "SA790-3L", "31-36"),
    (81, "Kids Heeled Sandal", "kids", "G790-1M", "25-30"),
    (82, "Kids Flat Shoe", "kids", "DA1869L-8L", "31-36"),
    (83, "Women's Loafer", "womens-shoes", "", ""),
    (84, "Women's Chunky Loafer", "womens-shoes", "1937-06", ""),
    (85, "Platform Sneaker", "womens-shoes", "", "37-42"),
    (86, "Platform Sneaker", "womens-shoes", "", "37-42"),
    (87, "Women's Quilted Slide", "womens-slides", "TB045-016D-2", "37-42"),
    (88, "Women's Heeled Sandal", "heels", "G5679-02", "37-42"),
    (89, "Women's Heeled Sandal", "heels", "GA743-23", "37-42"),
    (90, "Women's Monogram Loafer", "womens-shoes", "SY-72", ""),
    (91, "Men's Court Sneaker", "mens-shoes", "LUX-1923-13", "40-45"),
    (92, "Women's Buckle Slide", "womens-slides", "P2168-12556", "37-42"),
    (93, "Men's Court Sneaker", "mens-shoes", "LUX-1923-15", "40-45"),
    (94, "Women's Bow Slide", "womens-slides", "P2168-13052", "37-42"),
    (95, "Women's Strappy Slide", "womens-slides", "P2168-0994", "37-42"),
    (96, "Women's Buckle Slide", "womens-slides", "P2165-10049", "37-42"),
    (97, "Women's Crystal Heeled Sandal", "heels", "", "36-41"),
    (98, "Men's Horsebit Loafer", "mens-shoes", "", ""),
    (99, "Women's Slide Sandal", "womens-slides", "78-1", ""),
    (100, "Espadrille Wedge Sandal", "heels", "", ""),
    (101, "Men's Loafer", "mens-shoes", "", ""),
    (102, "Women's Ankle-Strap Heel", "heels", "", ""),
    (103, "Women's Ankle-Strap Heel", "heels", "", ""),
    (104, "Platform Wedge Sandal", "heels", "", ""),
    (105, "Women's Slide Sandal", "womens-slides", "HS-5614", "37-41"),
    (106, "Espadrille Wedge Mule", "heels", "", ""),
    (107, "Women's Monogram Slide", "womens-slides", "HS-5739", "37-41"),
    (108, "Women's Monogram Slide", "womens-slides", "HS-5706", "37-41"),
    (109, "Women's Monogram Slide", "womens-slides", "HS-5867", "37-41"),
    (110, "Women's Slide Sandal", "womens-slides", "HS-5903", "37-41"),
    (111, "Women's Monogram Slide", "womens-slides", "HS-5931", "37-41"),
]


def unique_originals():
    """Same md5-first-seen order used by contact_sheet.py, so indexes stay valid."""
    paths = sorted(glob.glob(os.path.join(ORIGINALS, "*.jpeg")))
    seen, unique = set(), []
    for path in paths:
        with open(path, "rb") as fh:
            digest = hashlib.md5(fh.read()).hexdigest()
        if digest in seen:
            continue
        seen.add(digest)
        unique.append(path)
    return unique


def slugify(value):
    value = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return value or "item"


def export_webp(src, index):
    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        for tag, longest in (("p%03d" % index, 900), ("thumb_p%03d" % index, 420)):
            work = im.copy()
            work.thumbnail((longest, longest))
            out = os.path.join(IMG_OUT, tag + ".webp")
            work.save(out, "WEBP", quality=78 if longest == 900 else 72, method=6)


def main():
    os.makedirs(IMG_OUT, exist_ok=True)
    os.makedirs(DATA_OUT, exist_ok=True)

    originals = unique_originals()
    if len(originals) < 111:
        raise SystemExit("expected at least 111 unique originals, found %d" % len(originals))

    for idx, _name, _cat, _code, _sizes in ROWS:
        export_webp(originals[idx - 1], idx)

    grouped = OrderedDict()
    for idx, name, cat, code, sizes in ROWS:
        key = code if code else "p%03d" % idx
        entry = grouped.setdefault(
            key,
            {
                "id": slugify(key),
                "name": name,
                "code": code,
                "category": cat,
                "category_label": CATEGORY_LABELS[cat],
                "sizes": sizes,
                "price": None,
                "images": [],
            },
        )
        entry["images"].append("p%03d.webp" % idx)

    catalog = {
        "site": {
            "name": "FootMart",
            "brand_lead": "Foot",
            "brand_tail": "Mart",
            "chip": "FootMart · Nairobi",
            "headline_lead": "Built for",
            "headline_tail": "every step.",
            "tagline": "Slides, sandals, heels, loafers and kids' shoes.",
            "phone": "",
            "email": "",
            "whatsapp": "",
            "location": "Nairobi, Kenya",
            "currency": "KES",
            "featured": "",
            "announce": "",
            "announce_link": "",
            "announce_link_text": "",
            "delivery_note": "",
        },
        "products": list(grouped.values()),
    }

    out_path = os.path.join(DATA_OUT, "catalog.json")
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(catalog, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    print("photos exported:", len(ROWS), "| products:", len(catalog["products"]))
    print("wrote", out_path)


if __name__ == "__main__":
    main()
