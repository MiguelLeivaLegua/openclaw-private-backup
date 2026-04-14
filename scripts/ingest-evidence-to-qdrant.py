import argparse
import hashlib
import json
import os
import re
from pathlib import Path
from typing import List
from urllib.request import Request, urlopen

from sentence_transformers import SentenceTransformer

QDRANT_URL = "http://127.0.0.1:6333"
MODEL_NAME = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
VECTOR_SIZE = 384
DISTANCE = "Cosine"
CHUNK_SIZE = 1500
OVERLAP = 200


SEPARADORES = [
    r'(?=LIBRO\s+[IVXLCDM]+)',
    r'(?=T[ÍI]TULO\s+[IVXLCDM]+)',
    r'(?=CAP[ÍI]TULO\s+[IVXLCDM]+)',
    r'(?=P[ÁA]RRAFO\s+\d+[°º]?)',
    r'(?=Art[íi]culo\s+\d+[°º]?)',
    r'\n\s*\n+',
    r'(?<=[.;:!?])\s+',
    r'\n',
    r'\s+',
]


def slugify(value: str) -> str:
    value = value.lower().strip()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-") or "sin-nombre"


def normalize(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[^\S\n]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def final_split(text: str, max_chars: int, overlap: int) -> List[str]:
    words = text.split()
    chunks = []
    current = []
    length = 0
    for word in words:
        if length + len(word) + 1 <= max_chars:
            current.append(word)
            length += len(word) + 1
        else:
            if current:
                chunks.append(" ".join(current))
            overlap_words = current[-max(1, overlap // 10):] if current else []
            current = overlap_words + [word]
            length = sum(len(w) + 1 for w in current)
    if current:
        chunks.append(" ".join(current))
    return chunks


def apply_overlap(chunks: List[str], overlap: int) -> List[str]:
    if len(chunks) <= 1:
        return chunks
    out = [chunks[0]]
    for i in range(1, len(chunks)):
        prev_words = chunks[i - 1].split()
        keep = min(len(prev_words), overlap // 8)
        context = " ".join(prev_words[-keep:]) if keep else ""
        out.append(f"[...] {context} {chunks[i]}".strip())
    return out


def split_recursive(text: str, level: int = 0) -> List[str]:
    if len(text) <= CHUNK_SIZE:
        return [text] if text.strip() else []
    if level >= len(SEPARADORES):
        return final_split(text, CHUNK_SIZE, OVERLAP)
    parts = [p.strip() for p in re.split(SEPARADORES[level], text, flags=re.IGNORECASE) if p.strip()]
    if len(parts) <= 1:
        return split_recursive(text, level + 1)
    chunks = []
    buffer = ""
    for part in parts:
        if len(buffer) + len(part) + 1 <= CHUNK_SIZE:
            buffer = (buffer + " " + part).strip()
        else:
            if buffer:
                chunks.append(buffer)
            if len(part) > CHUNK_SIZE:
                chunks.extend(split_recursive(part, level + 1))
                buffer = ""
            else:
                buffer = part
    if buffer:
        chunks.append(buffer)
    return apply_overlap(chunks, OVERLAP)


def qdrant_request(method: str, path: str, payload=None):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = Request(QDRANT_URL + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    with urlopen(req) as response:
        raw = response.read().decode("utf-8")
        return json.loads(raw) if raw else {}


def ensure_collection(collection: str):
    try:
        qdrant_request("GET", f"/collections/{collection}")
    except Exception:
        qdrant_request(
            "PUT",
            f"/collections/{collection}",
            {"vectors": {"size": VECTOR_SIZE, "distance": DISTANCE}, "on_disk_payload": True},
        )


def make_point_id(collection: str, source: str, idx: int) -> int:
    digest = hashlib.sha256(f"{collection}|{source}|{idx}".encode()).hexdigest()[:16]
    return int(digest, 16)


def main():
    parser = argparse.ArgumentParser(description="Ingesta texto limpio a Qdrant por usuario")
    parser.add_argument("user", help="Nombre de usuario")
    parser.add_argument("case_name", help="Causa o asunto")
    parser.add_argument("txt_file", help="Ruta al txt limpio a indexar")
    parser.add_argument("--collection", help="Colección Qdrant explícita")
    args = parser.parse_args()

    txt_path = Path(args.txt_file).resolve()
    text = normalize(txt_path.read_text(encoding="utf-8"))
    if not text:
        raise SystemExit("El txt está vacío")

    collection = args.collection or f"user_{slugify(args.user)}"
    ensure_collection(collection)

    model = SentenceTransformer(MODEL_NAME)
    chunks = split_recursive(text)
    vectors = model.encode(chunks).tolist()

    points = []
    for i, (chunk, vector) in enumerate(zip(chunks, vectors), 1):
        points.append(
            {
                "id": make_point_id(collection, str(txt_path), i),
                "vector": vector,
                "payload": {
                    "texto": chunk,
                    "archivo": txt_path.name,
                    "ruta_txt": str(txt_path),
                    "usuario": args.user,
                    "causa": args.case_name,
                    "coleccion": collection,
                    "chunk_index": i,
                    "total_chunks": len(chunks),
                },
            }
        )

    qdrant_request("PUT", f"/collections/{collection}/points?wait=true", {"points": points})
    print(json.dumps({"ok": True, "collection": collection, "chunks": len(chunks), "txt_file": str(txt_path)}, indent=2))


if __name__ == "__main__":
    main()
