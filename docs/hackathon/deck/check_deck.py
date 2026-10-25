"""Quality gates for the deck, modeled on addispublisher's copy and asset checks.

Copy gate: banned stock words, no dashes or semicolons, every number in facts.json, headline and
body limits. Output gate: five pages at 1920 by 1080 and no visually blank page.
"""

import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

from PIL import Image, ImageStat

HERE = Path(__file__).parent
BANNED = (
    "revolutionary", "magic", "ai powered", "ai-powered", "game changing", "seamlessly",
    "effortlessly", "unlock", "supercharge", "10x", "guaranteed", "best in class",
    "pivotal", "testament", "landscape", "delve", "leverage", "empower", "cutting edge",
    "robust", "seamless", "harness", "elevate", "journey",
)
NUMBER = re.compile(r"\b[vV]?\d+(?:[.,]\d+)?\b")


class Text(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.skip = 0
        self.tag = ""
        self.parts: list[tuple[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list) -> None:
        if tag in ("style", "script", "template"):
            self.skip += 1
        self.tag = "lede" if ("class", "lede") in attrs else tag
        for name, value in attrs:
            if name == "alt" and value:
                self.parts.append(("alt", value))

    def handle_endtag(self, tag: str) -> None:
        if tag in ("style", "script", "template"):
            self.skip -= 1

    def handle_data(self, data: str) -> None:
        if not self.skip and data.strip():
            self.parts.append((self.tag, " ".join(data.split())))


def copy_errors() -> list[str]:
    parser = Text()
    parser.feed((HERE / "slides.html").read_text())
    facts = json.loads((HERE / "facts.json").read_text())["numbers"]
    errors = []
    for tag, text in parser.parts:
        lowered = text.casefold()
        errors += [f'stock word "{word}" in: {text}' for word in BANNED if word in lowered]
        if re.search(r"[;–—]| - ", text):
            errors.append(f"dash or semicolon in: {text}")
        errors += [
            f'number "{n}" is not in facts.json: {text}'
            for n in NUMBER.findall(text)
            if n not in facts
        ]
        if tag == "h1" and len(text.split()) > 10:
            errors.append(f"headline over 10 words: {text}")
        if tag == "li" and len(text.split()) > 24:
            errors.append(f"point over 24 words: {text}")
        if "lede" in tag and len(text.split()) > 34:
            errors.append(f"lede over 34 words: {text}")
    return errors


def output_errors() -> list[str]:
    errors = []
    pdf = HERE / "growthreceipt-deck.pdf"
    if not pdf.is_file():
        return ["growthreceipt-deck.pdf was not written"]
    data = pdf.read_bytes()
    pages = len(re.findall(rb"/Type\s*/Page[^s]", data))
    if pages != 5:
        errors.append(f"PDF has {pages} pages, expected 5")
    for box in re.findall(rb"/MediaBox\s*\[([^\]]+)\]", data):
        width, height = [float(v) for v in box.split()[2:4]]
        if round(width / height, 3) != round(16 / 9, 3):
            errors.append(f"page is {width} by {height}, expected 16:9")
            break
    for index in range(1, 6):
        path = HERE / "previews" / f"slide-{index}.png"
        if not path.is_file():
            errors.append(f"slide {index} preview missing")
            continue
        with Image.open(path) as image:
            if image.size != (1920, 1080):
                errors.append(f"slide {index} is {image.size}, expected 1920 by 1080")
            if max(ImageStat.Stat(image.convert("L")).stddev) < 8:
                errors.append(f"slide {index} is visually blank")
    return errors


if __name__ == "__main__":
    found = copy_errors() + output_errors()
    print("\n".join(found) if found else "All deck gates passed.")
    sys.exit(1 if found else 0)
