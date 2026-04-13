import argparse
import json
from typing import Any
from urllib.request import Request, urlopen

from sentence_transformers import SentenceTransformer

QDRANT_URL = "http://127.0.0.1:6333"
COLECCION = "normativas_chile"
MODELO_EMBEDDINGS = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"


def buscar_en_qdrant(query: str, limit: int = 5, with_payload: bool = True) -> dict[str, Any]:
    modelo = SentenceTransformer(MODELO_EMBEDDINGS)
    vector = modelo.encode(query).tolist()

    body = json.dumps({
        "vector": vector,
        "limit": limit,
        "with_payload": with_payload,
    }).encode("utf-8")

    req = Request(
        f"{QDRANT_URL}/collections/{COLECCION}/points/search",
        data=body,
        headers={"Content-Type": "application/json"},
    )

    with urlopen(req) as response:
        return json.loads(response.read().decode("utf-8"))


def formatear_resultado(item: dict[str, Any], index: int) -> str:
    payload = item.get("payload") or {}
    texto = (payload.get("texto") or payload.get("chunk") or "")
    texto = texto.replace("\n", " ").strip()
    preview = texto[:500] + ("..." if len(texto) > 500 else "")

    partes = [
        f"Resultado {index}",
        f"score: {item.get('score')}",
    ]

    if payload.get("titulo"):
        partes.append(f"titulo: {payload['titulo']}")
    if payload.get("fuente"):
        partes.append(f"fuente: {payload['fuente']}")
    if payload.get("archivo"):
        partes.append(f"archivo: {payload['archivo']}")

    partes.append(f"texto: {preview or '[sin texto en payload]'}")
    return "\n".join(partes)


def main() -> None:
    parser = argparse.ArgumentParser(description="Consulta semántica simple sobre Qdrant")
    parser.add_argument("query", help="Consulta jurídica en lenguaje natural")
    parser.add_argument("--limit", type=int, default=5, help="Cantidad de resultados")
    args = parser.parse_args()

    data = buscar_en_qdrant(args.query, limit=args.limit)
    resultados = data.get("result", [])

    print(f"Consulta: {args.query}")
    print(f"Colección: {COLECCION}")
    print(f"Resultados: {len(resultados)}")
    print("=" * 80)

    for i, item in enumerate(resultados, 1):
        print(formatear_resultado(item, i))
        print("-" * 80)


if __name__ == "__main__":
    main()
