#!/usr/bin/env bash
# 가이드 사진을 Docker(playops-ai-runner 이미지의 Playwright)로 찍는다. WSL 에서 실행.
#
#   docs/user-guide/scripts/run.sh                 # 모든 장면
#   docs/user-guide/scripts/run.sh 01 02           # 이름이 01, 02 로 시작하는 장면만
#   docs/user-guide/scripts/run.sh --peek /projects # 화면 하나만 찍고 버튼 목록 출력(셀렉터 찾기용)
#
# 환경변수
#   ENV_FILE     관리자 계정을 읽을 .env (기본: 저장소 루트의 .env, 없으면 본 저장소의 .env). LOGIN_USERNAME / LOGIN_PASSWORD 두 줄만 읽는다.
#   APP_URL      컨테이너 안에서 본 AI-TestOps 주소 (기본 http://host.docker.internal:3000)
#   SHOP_URL     데모 쇼핑몰 주소 (기본 http://host.docker.internal:4173)
#   GUIDE_FORMAT png | jpg (기본 jpg), GUIDE_QUALITY jpg 품질 (기본 82)
#   GUIDE_RECREATE=1  02 장면에서 기존 "데모샵" 프로젝트를 지우고 다시 등록
#   GUIDE_PHOTOS_ONLY=1  02 장면에서 등록 창 사진만 다시 찍고 닫기(프로젝트를 만들지 않음)
#   DOCKER       docker 실행 파일 (기본: Windows Docker Desktop 의 docker.exe)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
GUIDE_DIR="$(cd "$HERE/.." && pwd)"
REPO_ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"
DOCKER="${DOCKER:-}"
if [ -z "$DOCKER" ]; then
  if command -v docker >/dev/null 2>&1; then
    DOCKER="docker"
  else
    DOCKER="/mnt/c/Program Files/Docker/Docker/resources/bin/docker.exe"
  fi
fi
# worktree 에는 .env 가 없을 수 있어 본 저장소(공용 .git 의 부모)의 .env 도 찾아본다.
MAIN_ROOT="$(cd "$(git -C "$HERE" rev-parse --git-common-dir)/.." && pwd)"
if [ -z "${ENV_FILE:-}" ]; then
  if [ -f "$REPO_ROOT/.env" ]; then ENV_FILE="$REPO_ROOT/.env"; else ENV_FILE="$MAIN_ROOT/.env"; fi
fi

read_env() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"; }
if [ -z "${LOGIN_USERNAME:-}" ]; then LOGIN_USERNAME="$(read_env LOGIN_USERNAME)"; fi
if [ -z "${LOGIN_PASSWORD:-}" ]; then LOGIN_PASSWORD="$(read_env LOGIN_PASSWORD)"; fi
if [ -z "$LOGIN_USERNAME" ] || [ -z "$LOGIN_PASSWORD" ]; then
  echo "관리자 계정을 찾지 못했습니다. ENV_FILE=<.env 경로> 로 알려 주세요." >&2
  exit 1
fi
export LOGIN_USERNAME LOGIN_PASSWORD
export APP_URL="${APP_URL:-http://host.docker.internal:3000}"
export SHOP_URL="${SHOP_URL:-http://host.docker.internal:4173}"
export GUIDE_FORMAT="${GUIDE_FORMAT:-jpg}" GUIDE_QUALITY="${GUIDE_QUALITY:-82}"
# docker.exe(Windows 프로세스)에 값을 넘기려면 WSLENV 에 이름을 올린다. 값은 명령줄에 나타나지 않는다.
export WSLENV="LOGIN_USERNAME:LOGIN_PASSWORD:APP_URL:SHOP_URL:GUIDE_FORMAT:GUIDE_QUALITY:GUIDE_PROJECT:GUIDE_RECREATE:GUIDE_PHOTOS_ONLY${WSLENV:+:$WSLENV}"

FONTS=()
for f in malgun.ttf malgunbd.ttf; do
  if [ -f "/mnt/c/Windows/Fonts/$f" ]; then
    if [[ "$DOCKER" == *.exe ]]; then
      FONTS+=(-v "C:\\Windows\\Fonts\\$f:/usr/share/fonts/truetype/guide/$f:ro")
    else
      FONTS+=(-v "/mnt/c/Windows/Fonts/$f:/usr/share/fonts/truetype/guide/$f:ro")
    fi
  fi
done

if [ "${1:-}" = "--peek" ]; then
  shift
  CMD=(node scripts/peek.js "$@")
else
  CMD=(node scripts/capture.js "$@")
fi

if [[ "$DOCKER" == *.exe ]]; then
  WORK_MOUNT="$(wslpath -w "$GUIDE_DIR"):/work"
else
  WORK_MOUNT="$GUIDE_DIR:/work"
fi

exec "$DOCKER" run --rm \
  -v "$WORK_MOUNT" -w /work \
  "${FONTS[@]}" \
  -e LOGIN_USERNAME -e LOGIN_PASSWORD -e APP_URL -e SHOP_URL -e GUIDE_FORMAT -e GUIDE_QUALITY -e GUIDE_PROJECT -e GUIDE_RECREATE -e GUIDE_PHOTOS_ONLY \
  -e NODE_PATH=/opt/node/lib/node_modules \
  playops-ai-runner:latest "${CMD[@]}"
