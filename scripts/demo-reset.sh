#!/usr/bin/env bash
# 시연 리허설 뒤 원래 상태(실패하는 시연 spec, 미해결 결함 1건)로 되돌린다.  (#88)
#
#   scripts/demo-reset.sh                      # 저장소 루트에서. 테스트 서버에서는 /home/playops/playops
#   BASE_URL=http://localhost:8080 scripts/demo-reset.sh
#
# 하는 일 — 시연용 PM 계정(.env 의 DEMO_PM_USERNAME · DEMO_PM_PASSWORD)으로:
#   1. tests/demo.spec.ts 를 저장소 원본(링크 이름 '문의하기')으로 덮어쓴다
#   2. 계획 표를 되돌린다 — 시연 중 연결한 계획 행은 연결 해제, 시드 3건 밖의 계획 행은 삭제, 모든 항목 '사용'
#   3. 시연 프로젝트를 한 번 실행하고(실행 중이면 끝날 때까지 기다림) 끝나기를 기다린다
#   4. 미해결 결함이 1건('문의하기 링크가 보인다')인지 확인한다 — 아니면 실패로 끝낸다
#   그 밖에 프로젝트 상태를 '실행'으로 두고, 끝나면 게스트 계정의 알림을 비운다 (3-1)
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

echo "0/4 프로젝트 상태 '실행'"
curl -sf -X PUT "$API" -H "$AUTH" -H 'Content-Type: application/json' -d '{"status":"RUNNING"}' >/dev/null

echo "1/4 시연 spec 되돌리기"
jq -n --rawfile c "$SPEC_SOURCE" '{content:$c}' \
  | curl -sf -X PUT "$API/files/content?path=$SPEC_PATH" -H "$AUTH" -H 'Content-Type: application/json' -d @- >/dev/null

echo "2/4 계획 표 되돌리기"
# 시연 시드(DemoDataSeeder)가 넣는 미작성 계획 3건. 시연 중 붙여넣은 계획 · 연결은 지운다.
SEED_TITLES='["첫 화면 제목이 보인다","안내 페이지가 열린다","첫 화면 설명 문구가 보인다"]'
for id in $(curl -sf "$API/plan" -H "$AUTH" | jq -r '.items[] | select(.planId != null and .stage == "WRITTEN") | .planId'); do
  curl -sf -X DELETE "$API/plan/entries/$id/link" -H "$AUTH" >/dev/null
done
for id in $(curl -sf "$API/plan" -H "$AUTH" | jq -r --argjson seed "$SEED_TITLES" \
    '.items[] | select(.planId != null) | select(.title as $t | $seed | index($t) | not) | .planId'); do
  curl -sf -X DELETE "$API/plan/entries/$id" -H "$AUTH" >/dev/null
done
# 미작성 행은 planId 로, 테스트 행은 파일 · grep 으로 '사용'
curl -sf "$API/plan" -H "$AUTH" \
  | jq '{items: [.items[] | if .stage == "UNWRITTEN" then {planId, specPath: "", grep: ""} else {specPath, grep} end], enabled: true}' \
  | curl -sf -X PATCH "$API/plan/items/enabled" -H "$AUTH" -H 'Content-Type: application/json' -d @- >/dev/null
echo "   계획 $(curl -sf "$API/plan" -H "$AUTH" | jq -r '"\(.summary.total)건 · 미작성 \(.summary.unwritten)건"')"

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
# 게스트로 들어가 게스트 알림을 비운다 (시연 · 리허설 실행마다 쌓여 9+ 로 보이던 것)
GUEST_TOKEN=$(curl -sf -X POST "$BASE_URL/api/auth/guest" | jq -r '.token // empty' || true)
if [ -n "$GUEST_TOKEN" ]; then
  curl -sf -X DELETE "$BASE_URL/api/notifications" -H "Authorization: Bearer $GUEST_TOKEN" >/dev/null && echo "   게스트 알림 비움"
  curl -sf -X POST "$BASE_URL/api/auth/logout" -H "Authorization: Bearer $GUEST_TOKEN" >/dev/null || true
else
  echo "   게스트 계정이 없어 알림 정리를 건너뜀"
fi
echo "되돌림 완료"
