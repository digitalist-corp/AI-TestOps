#!/usr/bin/env bash
# 시연 리허설 뒤 원래 상태(실패하는 시연 spec, 미해결 결함 1건)로 되돌린다.  (#88)
#
#   scripts/demo-reset.sh                      # 저장소 루트에서. 테스트 서버에서는 /home/playops/playops
#   BASE_URL=http://localhost:8080 scripts/demo-reset.sh
#
# 하는 일 — 시연용 PM 계정(.env 의 DEMO_PM_USERNAME · DEMO_PM_PASSWORD)으로:
#   1. tests/demo.spec.ts 를 저장소 원본(링크 이름 '문의하기')으로 덮어쓴다
#   2. 계획 표의 모든 항목을 '사용'으로 되돌린다
#   3. 시연 프로젝트를 한 번 실행하고(실행 중이면 끝날 때까지 기다림) 끝나기를 기다린다
#   4. 미해결 결함이 1건('문의하기 링크가 보인다')인지 확인한다 — 아니면 실패로 끝낸다
# 비밀번호는 화면 · 로그에 찍지 않는다.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
BASE_URL=${BASE_URL:-http://localhost:8080}
PROJECT=example.com
SPEC_PATH=tests/demo.spec.ts
SPEC_SOURCE="$ROOT/apps/api/src/main/resources/demo/example.com/demo.spec.ts"

# 키가 없으면 빈 값 (set -e 로 조용히 끝나지 않게)
envval() { { grep -E "^$1=" "$ROOT/.env" 2>/dev/null || true; } | head -1 | cut -d= -f2- | tr -d '\r'; }
USERNAME=${DEMO_PM_USERNAME:-$(envval DEMO_PM_USERNAME)}
USERNAME=${USERNAME:-demo-pm}
PASSWORD=${DEMO_PM_PASSWORD:-$(envval DEMO_PM_PASSWORD)}
[ -n "$PASSWORD" ] || { echo "시연 PM 비밀번호(DEMO_PM_PASSWORD)가 .env 에 없습니다." >&2; exit 1; }

TOKEN=$(jq -n --arg u "$USERNAME" --arg p "$PASSWORD" '{username:$u,password:$p}' \
  | curl -sf -X POST "$BASE_URL/api/auth/login" -H 'Content-Type: application/json' -d @- | jq -r '.token // empty')
[ -n "$TOKEN" ] || { echo "시연 PM 로그인 실패 ($USERNAME)" >&2; exit 1; }
AUTH="Authorization: Bearer $TOKEN"
API="$BASE_URL/api/projects/$PROJECT"

echo "1/4 시연 spec 되돌리기"
jq -n --rawfile c "$SPEC_SOURCE" '{content:$c}' \
  | curl -sf -X PUT "$API/files/content?path=$SPEC_PATH" -H "$AUTH" -H 'Content-Type: application/json' -d @- >/dev/null

echo "2/4 계획 표 모두 '사용'으로"
curl -sf "$API/plan" -H "$AUTH" | jq '{items: [.items[] | {specPath, grep}], enabled: true}' \
  | curl -sf -X PATCH "$API/plan/items/enabled" -H "$AUTH" -H 'Content-Type: application/json' -d @- >/dev/null

echo "3/4 시연 프로젝트 실행"
EXEC_ID=""
for _ in $(seq 1 30); do
  RES=$(curl -s -w '\n%{http_code}' -X POST "$API/executions" -H "$AUTH" -H 'Content-Type: application/json' -d '{}')
  CODE=$(tail -1 <<<"$RES")
  if [ "$CODE" = 200 ]; then EXEC_ID=$(head -1 <<<"$RES" | jq -r '.id'); break; fi
  if [ "$CODE" = 409 ]; then echo "   이미 실행 중 — 10초 뒤 다시"; sleep 10; continue; fi
  echo "실행 요청 실패 (HTTP $CODE): $(head -1 <<<"$RES" | jq -r '.message // .')" >&2; exit 1
done
[ -n "$EXEC_ID" ] || { echo "실행을 시작하지 못했습니다 (계속 실행 중)" >&2; exit 1; }
STATUS=""
for _ in $(seq 1 60); do
  STATUS=$(curl -sf "$BASE_URL/api/executions/$EXEC_ID" -H "$AUTH" | jq -r '.execution.status')
  case "$STATUS" in PASSED|FAILED|ERROR|CANCELLED) break ;; esac
  sleep 5
done
echo "   실행 #$EXEC_ID: $STATUS"

echo "4/4 결함 확인"
DEFECTS=$(curl -sf "$API/defects?status=OPEN" -H "$AUTH")
OPEN=$(jq '.open' <<<"$DEFECTS")
echo "   미해결 결함 ${OPEN}건: $(jq -r '[.defects[].title] | join(", ")' <<<"$DEFECTS")"
[ "$OPEN" = 1 ] && [ "$(jq -r '.defects[0].title' <<<"$DEFECTS")" = "문의하기 링크가 보인다" ] \
  || { echo "원래 상태(미해결 결함 1건)가 아닙니다." >&2; exit 1; }
echo "되돌림 완료"
