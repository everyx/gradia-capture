#!/usr/bin/env python3
import sys
import json
import os


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: ocr.py <image_path>"}))
        sys.exit(1)

    path = sys.argv[1]
    if not os.path.exists(path):
        print(json.dumps({"error": f"File not found: {path}"}))
        sys.exit(1)

    from rapidocr import RapidOCR

    engine = RapidOCR()
    result = engine(path)

    if result.txts is None:
        print(json.dumps([]))
        return

    items = []
    for i in range(len(result.txts)):
        items.append({
            "box": result.boxes[i].tolist(),
            "text": result.txts[i],
            "score": float(result.scores[i]),
        })

    print(json.dumps(items))


if __name__ == "__main__":
    main()
