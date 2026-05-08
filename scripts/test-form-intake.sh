#!/usr/bin/env bash
# Submit a membership-application as if Apps Script forwarded a Google Form response.
# Usage:  ./scripts/test-form-intake.sh <email>
# Example: ./scripts/test-form-intake.sh buyer1@test.local

set -euo pipefail

EMAIL="${1:-}"
if [ -z "$EMAIL" ]; then
  echo "usage: $0 <email>" >&2
  exit 1
fi

ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"
SECRET=$(grep '^FORM_INTAKE_SECRET=' "$ENV_FILE" | cut -d= -f2-)
if [ -z "$SECRET" ]; then
  echo "FORM_INTAKE_SECRET not found in $ENV_FILE" >&2
  exit 1
fi

BODY_FILE=$(mktemp)
trap 'rm -f "$BODY_FILE"' EXIT

cat > "$BODY_FILE" <<JSON
{
  "email": "$EMAIL",
  "googleFormResponseId": "manual_test_$(date +%s)",
  "submittedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "answers": {
    "本名": "Test User",
    "出生年月日": "1990-01-01",
    "身分證字號": "A123456789",
    "性別": "Other",
    "現職、服務單位與職稱": "Engineer",
    "Are you a university student?": "No",
    "戶籍地址": "Taipei",
    "聯絡電話": "0912345678",
    "Line 帳號": "testline",
    "匯款銀行與帳號後五碼": "00000",
    "你是否有任何問題或需求?": "None"
  }
}
JSON

SIG=$(openssl dgst -sha256 -hmac "$SECRET" -hex < "$BODY_FILE" | awk '{print $NF}')

echo "POSTing intake for $EMAIL ..."
curl -s -X POST http://localhost:1337/api/membership-applications/intake \
  -H 'Content-Type: application/json' \
  -H "X-Form-Signature: $SIG" \
  --data-binary "@$BODY_FILE"
echo
