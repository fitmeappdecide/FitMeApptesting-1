#!/usr/bin/env bash
set -euo pipefail

# Paths to test images (generated)
SCAN_IMG="$(dirname "$0")/scan_image.png"
GARMENT_IMG="$(dirname "$0")/garment_image.png"

# Copy scan image to garment image (for test)
cp "$SCAN_IMG" "$GARMENT_IMG"

# API base URL
BASE="http://127.0.0.1:8000"

# 1. Register a new user
EMAIL="test_$(date +%s)@example.com"
PASSWORD="TestPass123!"
FULLNAME="Test User"
REGISTER_RESP=$(curl -s -X POST "$BASE/api/v1/auth/register" -H "Content-Type: application/json" -d "{\"email\": \"$EMAIL\", \"password\": \"$PASSWORD\", \"full_name\": \"$FULLNAME\"}")
echo "REGISTER_RESP=$REGISTER_RESP"
ACCESS_TOKEN=$(echo "$REGISTER_RESP" | "$(pwd)/venv/bin/python" -c "import sys, json; print(json.load(sys.stdin)['access_token'])")
REFRESH_TOKEN=$(echo "$REGISTER_RESP" | "$(pwd)/venv/bin/python" -c "import sys, json; print(json.load(sys.stdin)['refresh_token'])")

# 2. Login (optional, we already have token)
LOGIN_RESP=$(curl -s -X POST "$BASE/api/v1/auth/login" -H "Content-Type: application/json" -d "{\"email\": \"$EMAIL\", \"password\": \"$PASSWORD\"}")
echo "LOGIN_RESP=$LOGIN_RESP"

# 3. Upload scan image
SCAN_UPLOAD_RESP=$(curl -s -X POST "$BASE/api/v1/scan/upload" -H "Authorization: Bearer $ACCESS_TOKEN" -H "X-Consent-Given: true" -F "front=@$SCAN_IMG")
echo "SCAN_UPLOAD_RESP=$SCAN_UPLOAD_RESP"
SCAN_ID=$(echo "$SCAN_UPLOAD_RESP" | "$(pwd)/venv/bin/python" -c "import sys, json; print(json.load(sys.stdin)['scan_id'])")

# 4. Upload garment image (user-upload)
GARMENT_UPLOAD_RESP=$(curl -s -X POST "$BASE/api/v1/garment/user-upload" -H "Authorization: Bearer $ACCESS_TOKEN" -F "product_name=TestGarment" -F "images=@$GARMENT_IMG")
echo "GARMENT_UPLOAD_RESP=$GARMENT_UPLOAD_RESP"
GARMENT_ID=$(echo "$GARMENT_UPLOAD_RESP" | "$(pwd)/venv/bin/python" -c "import sys, json; print(json.load(sys.stdin)['id'])")

# 5. Start try-on job
START_RESP=$(curl -s -X POST "$BASE/api/v1/tryon/start" -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" -d "{\"scan_id\": \"$SCAN_ID\", \"garment_id\": \"$GARMENT_ID\"}")
echo "START_RESP=$START_RESP"
JOB_ID=$(echo "$START_RESP" | "$(pwd)/venv/bin/python" -c "import sys, json; print(json.load(sys.stdin)['job_id'])")

# 6. Poll job status until completed (max 30 attempts)
for i in {1..30}; do
  STATUS_RESP=$(curl -s -X GET "$BASE/api/v1/tryon/$JOB_ID" -H "Authorization: Bearer $ACCESS_TOKEN")
  echo "STATUS_RESP=$STATUS_RESP"
  STATUS=$(echo "$STATUS_RESP" | python -c "import sys, json; print(json.load(sys.stdin)['status'])")
  if [[ "$STATUS" == "completed" ]]; then
    break
  fi
  sleep 2
done

# 7. Fetch final result
RESULT_RESP=$(curl -s -X GET "$BASE/api/v1/tryon/$JOB_ID/result" -H "Authorization: Bearer $ACCESS_TOKEN")
echo "RESULT_RESP=$RESULT_RESP"
IMAGE_URL=$(echo "$RESULT_RESP" | python -c "import sys, json; data=json.load(sys.stdin); print(data['result_image_urls'][0] if data.get('result_image_urls') else '')")
# Verify image reachable
if [[ -n "$IMAGE_URL" ]]; then
  curl -s -o /dev/null -w "%{http_code}" "$IMAGE_URL"
fi
