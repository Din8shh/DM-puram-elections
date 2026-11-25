"""Turn raw OCR output into clean voters.json + hamlets.json for import.

Usage: python build_voters.py <ocr_out_dir> <data_dir>
  <ocr_out_dir> holds raw_*.json and photos/ from extract.py
  <data_dir> receives voters.json, hamlets.json, photos/<serial>.jpg, review.csv

Voter data is personal: keep <data_dir> out of git (data/ is in .gitignore).
"""
import csv, glob, json, os, re, shutil, sys

# From the cover page of the 2026 roll (గ్రామము / నివాస ప్రాంతముల వివరాలు)
HAMLETS = [
    (1, "కరవాటికండ్రిగ", "Karavati Kandriga", 1, 60),
    (2, "మూల కండ్రిగ", "Moola Kandriga", 61, 302),
    (3, "సూరప్ప నాయుడు కండ్రిగ", "Surappa Naidu Kandriga", 303, 624),
    (4, "నాయుడు ఇల్లు", "Naidu Illu", 625, 671),
    (5, "డి.యం.పురం", "D.M. Puram", 672, 1165),
    (6, "డి.యం.పురం తెలుగు హరిజనవాడ", "D.M. Puram Telugu Harijanawada", 1166, 1191),
    (7, "డి.యం.పురం తమిళ హరిజన వాడ", "D.M. Puram Tamil Harijanawada", 1192, 1554),
    (8, "మిట్టఇండ్లు", "Mitta Indlu", 1555, 1710),
    (9, "కొత్తదేరాకండ్రిగ", "Kotha Dera Kandriga", 1711, 1882),
    (10, "పాతదేరాకండ్రిగ", "Patha Dera Kandriga", 1883, 2127),
]
# From the summary page: ward -> serial range
WARDS = [(1, 1, 212), (2, 213, 424), (3, 425, 636), (4, 637, 848), (5, 849, 1060),
         (6, 1061, 1272), (7, 1273, 1484), (8, 1485, 1696), (9, 1697, 1908), (10, 1909, 2127)]

# Characters that never appear in a printed name; their presence means OCR stumbled.
SUSPECT = re.compile(r"[\[\]()!|+{}<>0-9\u0C66-\u0C7F]")


def clean_te(s):
    s = (s or "").strip()
    # Tesseract often reads the ్ర conjunct as "[" or "(" before the consonant: చం[దయ్య → చంద్రయ్య
    s = re.sub(r"[\[(]([క-హ])", "\\1్ర", s)
    s = re.sub(r"^[\s:;'\"(\[|.,\-]+", "", s)
    s = re.sub(r"[\s:;'\"|\-]+$", "", s)
    # stray single Telugu letters OCR picks up at the line end (e.g. " క", " గ")
    s = re.sub(r"\s+[క-హ]$", "", s)
    s = re.sub(r"\s+", " ", s)
    return s


def clean_house(s):
    s = (s or "").strip()
    s = re.sub(r"^[\s:;.]+", "", s)
    s = re.sub(r"(\s+[A-Za-z|!:.\-]{1,2})+$", "", s)  # trailing junk like " l", " I"
    return s.strip()


def clean_epic(s):
    s = re.sub(r"\s", "", s or "")
    m = re.search(r"([A-Z]{3})I?(\d{7})", s)
    return (m.group(1) + m.group(2)) if m else s[:10]


def rel_type(label):
    if "భర్త" in label: return "husband"
    if "తల్లి" in label: return "mother"
    if "తండ" in label: return "father"
    return "other"


def gender(raw, width):
    # The printed glyph is the most reliable signal: పు is narrow (11-12px), స్త్రీ is wide (15px).
    # On this roll this gives exactly the official 1070 men / 1057 women.
    if width:
        return "F" if width >= 14 else "M"
    return "M" if "పు" in raw else "F"


def main(src, dst):
    raws = []
    for f in glob.glob(os.path.join(src, "raw_*.json")):
        raws += json.load(open(f, encoding="utf-8"))
    raws.sort(key=lambda r: (r["page"], r["idx"]))
    os.makedirs(os.path.join(dst, "photos"), exist_ok=True)
    voters, review = [], []
    # Cards are numbered continuously; each ward ends on a part-filled page,
    # so the serial is the card's position across the whole roll.
    for serial, r in enumerate(raws, start=1):
        issues = []
        age = re.sub(r"\D", "", r["age_raw"])
        age = int(age[-3:]) if age else None
        if age is not None and age > 110: age = int(str(age)[-2:])
        if age is None or age < 18: issues.append("age")
        name = clean_te(r["name_raw"])
        if len(name) < 2: issues.append("name")
        rel = clean_te(r["rel_raw"])
        if SUSPECT.search(name) or SUSPECT.search(rel): issues.append("text")
        house = clean_house(r["house_raw"])
        if not house or not re.search(r"\d", house): issues.append("house")
        epic = clean_epic(r["epic_raw"])
        if not re.fullmatch(r"[A-Z]{3}\d{7}", epic): issues.append("epic")
        part = re.sub(r"\s+", "", r.get("part_raw", ""))
        m = re.search(r"171-?\d{2,3}-?\d+", part)
        hamlet = next(h[0] for h in HAMLETS if h[3] <= serial <= h[4])
        ward = next(w[0] for w in WARDS if w[1] <= serial <= w[2])
        photo = f"{serial}.jpg"
        shutil.copy(os.path.join(src, "photos", r["photo"]), os.path.join(dst, "photos", photo))
        v = dict(serial=serial, ward=ward, hamlet_id=hamlet, part_ref=m.group(0) if m else part,
                 name=name, relation_type=rel_type(r["rel_label"]),
                 relation_name=rel, age=age,
                 gender=gender(r["gender_raw"], r.get("g_w")), house_no=house, epic=epic,
                 photo_path=photo, needs_review=bool(issues))
        voters.append(v)
        if issues:
            review.append([serial, r["page"], ";".join(issues), name, age, house, epic])
    # Hand corrections, checked against the printed roll: {"<serial>": {field: value}}
    corr_path = os.path.join(src, "corrections.json")
    if os.path.exists(corr_path):
        corr = json.load(open(corr_path, encoding="utf-8"))
        for v in voters:
            fix = corr.get(str(v["serial"]))
            if fix:
                v.update(fix); v["needs_review"] = False
        review = [r for r in review if str(r[0]) not in corr]
        print(f"applied {len(corr)} hand corrections")
    json.dump(voters, open(os.path.join(dst, "voters.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    json.dump([dict(id=h[0], name_te=h[1], name_en=h[2], serial_from=h[3], serial_to=h[4]) for h in HAMLETS],
              open(os.path.join(dst, "hamlets.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    with open(os.path.join(dst, "review.csv"), "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f); w.writerow(["serial", "pdf_page", "issues", "name", "age", "house", "epic"]); w.writerows(review)
    g = {"M": 0, "F": 0}
    for v in voters: g[v["gender"]] = g.get(v["gender"], 0) + 1
    print(f"{len(voters)} voters, {len(review)} flagged for review, gender {g}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
