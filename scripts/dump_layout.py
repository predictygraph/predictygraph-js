"""Dump node/group boxes and edge paths for every example with a fixed-advance measurer.

Run from the repo root: uv run python web/scripts/dump_layout.py
"""

import json
from pathlib import Path

from predictygraph import build_scene, parse_file
from predictygraph import styleutil, text
from predictygraph.model import Group


def fixed_measure(txt, family, size, bold=False):
    lines = txt.split("\n") if txt else []
    if not lines:
        return 0.0, 0.0, []
    size = min(text.MAX_FONT, max(1.0, size)) if size == size else 14.0
    return max(0.6 * size * len(line) for line in lines), size * 1.25 * len(lines), lines


text.measure = styleutil.measure = fixed_measure

ROOT = Path(__file__).resolve().parents[1] / "test"
OUT = Path(__file__).resolve().parent.parent / "test" / "fixtures"


def edge_paths(scene):
    edges = next(layer for layer in scene.layers if layer.cls == "pdg-edges")
    out = {}
    for el in edges.children:
        line = next((c for c in el.children if c.kind == "path"), None)
        out[el.id] = [[s[-2], s[-1]] for s in line.geom["segs"]] if line else []
    return out


def dump(path):
    doc = parse_file(path)
    scene = build_scene(doc)
    items = [
        {"id": i.id, "group": isinstance(i, Group), "x": i.ax, "y": i.ay, "w": i.w, "h": i.h}
        for i in doc.walk()
    ]
    return {"width": scene.width, "height": scene.height, "items": items, "edges": edge_paths(scene)}


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for p in sorted((ROOT / "examples").rglob("*.pdg")):
        name = p.relative_to(ROOT / "examples").with_suffix("").as_posix().replace("/", "__")
        (OUT / f"{name}.json").write_text(json.dumps(dump(p), indent=1) + "\n")
        print(name)
