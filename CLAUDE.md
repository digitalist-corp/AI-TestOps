@AGENTS.md

# Claude Code 설정

## 스킬

스킬은 전부 사용자 전역(`~/.claude/skills`, 플러그인)에 있고 원본은 `~/Developer/claude-skills`다. 프로젝트에 복사하지 않는다.

| 작업 | 쓸 스킬 |
|------|---------|
| 모든 코드 작성·수정 | `ponytail` (full 모드, 가장 단순한 해법 우선) |
| 새 기능 설계 | `superpowers:brainstorming` → `superpowers:writing-plans` → `superpowers:executing-plans` |
| 버그·실패 테스트 | `superpowers:systematic-debugging` |
| 구현 | `superpowers:test-driven-development` |
| 완료 선언 전 | `superpowers:verification-before-completion` |
| 병합·PR | `superpowers:requesting-code-review`, `superpowers:finishing-a-development-branch` |
| 웹 UI 디자인 | `taste-skill`, `redesign-skill`, `soft-skill`, `minimalist-skill`, `output-skill` |
| 브라우저 확인·E2E | `agent-browser` 또는 내장 브라우저 |
| 스킬 탐색 | `find-skills` |

`omni-*` / `cli-*`(OmniRoute) 스킬은 이 프로젝트와 무관하다. 요청이 없으면 쓰지 않는다.

## 작업 방식

- 문서(PRD·차터·개선사항 v2.0)가 기준이다. 현재 스프린트는 Sprint-1(~2026-10-09): api 도구화, ai-service 뼈대, 채팅 tool calling, 지식 그래프 스키마(SiteMap/Node/Edge), 분석 에이전트 뼈대.
- 지식 그래프 스키마가 분석·그래프 UI·LangGraph가 공유하는 계약이므로 가장 먼저 확정한다.
- 서버 실행은 `npm run dev`(Docker). 개별 `docker run`/`gradle` 호출은 AGENTS.md의 검증 절차만 쓴다.
