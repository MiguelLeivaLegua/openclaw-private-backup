#!/bin/sh
set -eu

if [ "$#" -lt 3 ]; then
  echo "Uso: sh scripts/evidence-to-qdrant.sh \"Usuario\" \"Causa o Asunto\" /ruta/al/archivo [YYYY-MM-DD]"
  exit 1
fi

USER_NAME="$1"
CASE_NAME="$2"
SOURCE_FILE="$3"
DATE_VALUE="${4:-}"

WORKDIR="$(pwd)"
if [ -z "$DATE_VALUE" ]; then
  DATE_VALUE="$(date +%F)"
fi

node "$WORKDIR/scripts/create-evidence-case.js" "$USER_NAME" "$CASE_NAME" "$DATE_VALUE" >/tmp/create-evidence-case.json
CASE_BASE="$(python3 - <<'PY'
import json
print(json.load(open('/tmp/create-evidence-case.json'))['base'])
PY
)"

node "$WORKDIR/scripts/ingest-evidence-file.js" "$USER_NAME" "$CASE_NAME" "$SOURCE_FILE" "$DATE_VALUE" >/tmp/ingest-evidence-file.json
ORIGINAL_TARGET="$(python3 - <<'PY'
import json
print(json.load(open('/tmp/ingest-evidence-file.json'))['originalTarget'])
PY
)"
EXTRACTED_TARGET="$(python3 - <<'PY'
import json
print(json.load(open('/tmp/ingest-evidence-file.json'))['extractedTarget'])
PY
)"
STAGING_TARGET="$(python3 - <<'PY'
import json
print(json.load(open('/tmp/ingest-evidence-file.json'))['stagingTarget'])
PY
)"

node "$WORKDIR/scripts/extract-evidence-text.js" "$ORIGINAL_TARGET" "$(dirname "$EXTRACTED_TARGET")" >/tmp/extract-evidence-text.json
GENERATED_TXT="$(python3 - <<'PY'
import json
print(json.load(open('/tmp/extract-evidence-text.json'))['outPath'])
PY
)"
cp "$GENERATED_TXT" "$STAGING_TARGET"

STAGING_IN_CONTAINER="/workspace/${STAGING_TARGET#$WORKDIR/}"

docker run --rm --network host -v "$WORKDIR:/workspace" python:3.11-slim sh -lc "pip install -q sentence-transformers qdrant-client torch --extra-index-url https://download.pytorch.org/whl/cpu >/dev/null 2>&1 && python /workspace/scripts/ingest-evidence-to-qdrant.py \"$USER_NAME\" \"$CASE_NAME\" \"$STAGING_IN_CONTAINER\"" >/tmp/ingest-evidence-to-qdrant.json

python3 - <<'PY'
import json
result = {
    'caseBase': json.load(open('/tmp/create-evidence-case.json'))['base'],
    'ingest': json.load(open('/tmp/ingest-evidence-file.json')),
    'extract': json.load(open('/tmp/extract-evidence-text.json')),
    'qdrant': json.load(open('/tmp/ingest-evidence-to-qdrant.json')),
}
print(json.dumps(result, indent=2, ensure_ascii=False))
PY
