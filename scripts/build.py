"""Read every Sentences/*.csv and prepare the static site and sentence audio."""

import argparse
import csv
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
VOICE = "Samantha"
RATE = 175


def catalog(source=ROOT / "Sentences", voice=VOICE, rate=RATE):
    sections, seen = {}, set()
    files = sorted(source.glob("*.csv"))
    if not files:
        raise ValueError(f"No CSV files found in {source}")
    required = {"id", "section", "section_title", "japanese", "english"}
    for path in files:
        with path.open(encoding="utf-8-sig", newline="") as stream:
            reader = csv.DictReader(stream)
            if not required.issubset(reader.fieldnames or []):
                raise ValueError(f"{path.name}: required columns: {sorted(required)}")
            for line, raw in enumerate(reader, 2):
                if not any(raw.values()):
                    continue
                if None in raw or any(raw.get(key) is None for key in required):
                    raise ValueError(f"{path.name}:{line}: invalid CSV column count")
                row = {key: (value or "").strip() for key, value in raw.items()}
                if any(not row[key] for key in required):
                    raise ValueError(f"{path.name}:{line}: required value is empty")
                item_id = row["id"]
                if not re.fullmatch(r"[A-Za-z0-9_-]+", item_id) or item_id in seen:
                    raise ValueError(f"{path.name}:{line}: invalid or duplicate id: {item_id}")
                seen.add(item_id)
                key = row["section"]
                section = sections.setdefault(key, {
                    "id": key, "title": row["section_title"], "sentences": []
                })
                if section["title"] != row["section_title"]:
                    raise ValueError(f"{path.name}:{line}: conflicting section title: {key}")
                digest = hashlib.sha256(
                    f"{voice}\n{rate}\n{row['english']}".encode()
                ).hexdigest()[:12]
                section["sentences"].append({
                    "id": item_id, "japanese": row["japanese"],
                    "english": row["english"], "note": row.get("note", ""),
                    "audio": f"audio/{item_id}-{digest}.mp3",
                })
    if not seen:
        raise ValueError("The CSV files contain no sentences")
    # Numeric section IDs sort as numbers; other IDs sort lexically.
    order = lambda key: (0, int(key), key) if key.isdigit() else (1, 0, key)
    return {"voice": voice, "rate": rate,
            "sections": [sections[key] for key in sorted(sections, key=order)]}


def generate(data, output):
    missing = [item for section in data["sections"] for item in section["sentences"]
               if not (output / item["audio"]).is_file()
               or (output / item["audio"]).stat().st_size <= 1024]
    if missing and (not shutil.which("say") or not shutil.which("ffmpeg")):
        raise SystemExit("Audio generation requires macOS 'say' and ffmpeg. Existing audio can be checked on any OS.")
    for item in missing:
        path = output / item["audio"]
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".part")
        try:
            with tempfile.TemporaryDirectory() as directory:
                speech = str(Path(directory) / "speech.aiff")
                subprocess.run(["say", "-v", data["voice"], "-r", str(data["rate"]),
                                "-o", speech], input=item["english"], text=True,
                               check=True, timeout=60)
                subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
                                "-y", "-i", speech, "-ac", "1", "-ar", "24000",
                                "-codec:a", "libmp3lame", "-b:a", "64k", "-f", "mp3",
                                str(temporary)], check=True, timeout=60)
            if temporary.stat().st_size <= 1024:
                raise ValueError(f"Empty generated audio: {item['id']}")
            temporary.replace(path)
            print(f"Generated {item['id']}", flush=True)
        finally:
            temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Validate existing data/audio without network")
    parser.add_argument("--voice", default=VOICE)
    parser.add_argument("--rate", type=int, default=RATE, help="Words per minute")
    args = parser.parse_args()
    data = catalog(voice=args.voice, rate=args.rate)
    output = ROOT / "docs"
    path = output / "data.json"
    rendered = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if not path.is_file() or path.read_text(encoding="utf-8") != rendered:
            raise SystemExit("data.json is out of date. Run: python scripts/build.py")
        for section in data["sections"]:
            for item in section["sentences"]:
                audio = output / item["audio"]
                if not audio.is_file() or audio.stat().st_size <= 1024:
                    raise SystemExit(f"Missing or empty audio: {audio}")
    else:
        generate(data, output)
        temporary = path.with_suffix(".part")
        temporary.write_text(rendered, encoding="utf-8")
        temporary.replace(path)
    count = sum(len(section["sentences"]) for section in data["sections"])
    print(f"OK: {len(data['sections'])} sections, {count} sentences and audio files")


if __name__ == "__main__":
    main()
