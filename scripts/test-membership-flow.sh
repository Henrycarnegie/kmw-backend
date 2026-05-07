#!/usr/bin/env bash
# End-to-end test: register a new user, submit a Google Form-style application,
# verify it via /me, then create a Stripe Checkout session for membership.
# Usage:
#   ./scripts/test-membership-flow.sh           # uses Low Fee plan id=1
#   ./scripts/test-membership-flow.sh 2         # uses plan id=2 (Premium)

set -euo pipefail

PLAN_ID="${1:-1}"
BACKEND="http://localhost:1337"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$HERE/.env"

SECRET=$(grep '^FORM_INTAKE_SECRET=' "$ENV_FILE" | cut -d= -f2-)
if [ -z "$SECRET" ]; then
  echo "FORM_INTAKE_SECRET not found in $ENV_FILE" >&2
  exit 1
fi

STAMP=$(date +%s)
EMAIL="tester${STAMP}@test.local"
USERNAME="tester${STAMP}"

echo
echo "===================================================================="
echo "STEP 1: register $EMAIL"
echo "===================================================================="
REG=$(curl -s -X POST "$BACKEND/api/auth/local/register" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$USERNAME\",\"email\":\"$EMAIL\",\"password\":\"testpass123\"}")
JWT=$(printf '%s' "$REG" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("jwt",""))')
if [ -z "$JWT" ]; then
  echo "Register failed:"
  echo "$REG"
  exit 1
fi
echo "  JWT length: ${#JWT}  (ok)"

echo
echo "===================================================================="
echo "STEP 2: submit Google-form-style intake (HMAC signed)"
echo "===================================================================="
BODY_FILE=$(mktemp); trap 'rm -f "$BODY_FILE"' EXIT
cat > "$BODY_FILE" <<JSON
{
  "email": "$EMAIL",
  "googleFormResponseId": "manual_test_$STAMP",
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
INTAKE_RES=$(curl -s -X POST "$BACKEND/api/membership-applications/intake" \
  -H 'Content-Type: application/json' \
  -H "X-Form-Signature: $SIG" \
  --data-binary "@$BODY_FILE")
echo "  $INTAKE_RES"

echo
echo "===================================================================="
echo "STEP 3: GET /membership-applications/me with the JWT"
echo "===================================================================="
ME=$(curl -s -H "Authorization: Bearer $JWT" "$BACKEND/api/membership-applications/me")
echo "  $ME"

echo
echo "===================================================================="
echo "STEP 4: POST /payments/checkout/membership (planId=$PLAN_ID)"
echo "===================================================================="
CHECKOUT=$(curl -s -X POST "$BACKEND/api/payments/checkout/membership" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $JWT" \
  -d "{\"planId\":$PLAN_ID}")
echo "  $CHECKOUT"

URL=$(printf '%s' "$CHECKOUT" | python3 -c 'import sys,json
try: d=json.load(sys.stdin); print(d.get("url",""))
except: print("")')
if [ -n "$URL" ]; then
  echo
  echo "===================================================================="
  echo "OPEN THIS URL in your browser to pay:"
  echo "  $URL"
  echo "===================================================================="
  echo
  echo "Use card 4242 4242 4242 4242, any future expiry, any CVC."
  echo "After paying, watch your 'stripe listen' window for the webhook,"
  echo "then verify with:"
  echo
  echo "  PGPASSWORD=postgres psql -h localhost -U postgres -d kmw_cms -c \\"
  echo "    \"SELECT id, access_level, subscription_status FROM memberships ORDER BY id DESC LIMIT 1;\""
fi

echo
echo "Test user email: $EMAIL"
echo "JWT (export if you need it):  export JWT=$JWT"
