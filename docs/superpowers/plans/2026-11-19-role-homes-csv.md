# 역할별 홈 3개 + CSV 내보내기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 설계 문서 시연 전 P0(A3 · A6~A10)를 지금 API 로 만든다.

**Architecture:** 계산은 `lib/plan.ts` · `lib/csv.ts` 순수 함수(테스트 대상), 화면은 `components/home/` 의 역할별 구역 컴포넌트로 나누고 `HomePage` 는 데이터를 불러 나눠 준다.

**Tech Stack:** React 19, Vitest, 기존 `api` 클라이언트

**Spec:** `docs/superpowers/specs/2026-11-19-role-dashboards-design.md` 2절(용어 · 판정 · 계산식) · 4절(홈) · 7절 A3 · A6~A10

## Global Constraints

- 시연이 보는 글자 유지: `내가 맡은 프로젝트`, `전체 현황`, `미해결 결함 n`, `{프로젝트} 실패 n건 다시 실행`, '진척률' 낱말과 **지금 산식(통과 ÷ 사용 중)** — 산식 변경은 시연 뒤
- 판정 표기: 통과 · 실패 · 미수행 (지금 데이터는 3값). 판정 옆 `자동` 꼬리표
- 홈은 보기 · 이동 · 실행/다시 실행만. 승인 · 판정 덮어쓰기는 각 탭에서
- CSV: UTF-8 BOM(`﻿`), 셀이 `=` `+` `-` `@` 로 시작하면 앞에 `'`, 쉼표 · 따옴표 · 줄바꿈이 있으면 `"` 로 감싸고 `"` 는 `""`
- 새 API · 마이그레이션 없음. 테스트 실행: `docker exec playops-web npx vitest run <파일>`, PR 직전 전체 1회 + tsc

## Review Focus

1. 프로젝트 0개 · 계획 항목 0개 · API 실패 → 빈 상태 문구, 화면이 깨지지 않음 (Task 3 테스트)
2. 실행 중인 프로젝트에서 [실행] · [다시 실행] 잠김 (Task 3 테스트)
3. 셀 값이 숫자 · null → 빈 칸/숫자 그대로 (Task 1 테스트)
4. 승인 대기 0건이면 칩이 0 으로 보이고 링크 동작 (Task 3)
5. 관리자이면서 PM 인 사람 — 관리자 구역만(지금 동작 유지)

---

### Task 1: CSV (A3)
- Create `apps/web/src/lib/csv.ts`: `toCsv(rows: (string | number | null | undefined)[][]): string`, `downloadCsv(fileName: string, rows): void`(Blob `text/csv;charset=utf-8`)
- Test `lib/csv.test.ts`: `startsWithBom`, `guardsFormulaCells`(`=1+1`→`'=1+1`, `+`·`-`·`@` 동일, 숫자 `-3` 은 그대로 문자열화하지 않음 — 숫자 타입은 가드 안 함), `quotesCommaQuoteNewline`, `nullIsEmpty`
- PlanTab 에 `[CSV 내보내기]` 버튼: 칸 = TC ID(행 번호 TC-001) · 대분류(spec 경로) · 케이스명 · 사용 · 담당자 · 마감일 · 우선순위 · 판정 · 최근 실행. 파일명 `{projectId}-계획-YYYYMMDD.csv`. PlanTab 테스트에 버튼이 `downloadCsv` 를 부르는지 1개

### Task 2: 계산 함수 (lib/plan.ts)
- `byAssignee` 행에 `notRun`, `rate`(진척률 = 통과 ÷ 배정, 지금 산식) 추가
- `myTodo(items, userId, today)`: 사용 중 · 내 배정만, 정렬 = 기한 지남 → 오늘 마감 → 실패 → 미수행 → 우선순위(높음>보통>낮음>없음) → 통과
- `todoSummary(todo, today)`: `{ assigned, remaining(통과 아닌 것), dueToday, overdue, failed }`
- 테스트: 정렬 순서, 요약 숫자

### Task 3: 홈 화면
- Create `components/home/NoticeStrip.tsx`(A9: 고정 공지 우선 제목 하나 + `외 n건 →` → /notices), `AdminHome.tsx`(A6), `PmHome.tsx`(A7), `MemberHome.tsx`(A8). `HomePage.tsx` 는 데이터 로드 + 구역 배치
- 관리자: KPI 6칸(프로젝트 · 미수행 · 미해결 결함 · 승인 대기 · 최장 · 러너 실행/전체 · 오류 · AI 비용 30일), 확인 필요(러너 오류 · 고아 러너 · 실행 오류 · 상태 불일치 · 승인 정체 72h · 예약 실패 · AI 단가 미설정, 최대 5줄), 프로젝트 표(상태 · 기간 · 판정 분포 막대 · 진척률 · 결함 · 승인 대기 · 최근 실행, 위험순), 사용자 표(이름 · 역할 · 최근 로그인, 30일 넘으면 ▲) · 러너 표. ag-grid 대신 일반 표(보기 전용, 행 수 적음)
- PM: 확인할 것 칩(승인 대기 n · 최장 n일 → ai-review 탭, 기한 지남 n, 담당자 없음 n), 담당자별 표 칸 배정 · 통과 · 실패 · 미수행 · 진척률, AI 줄(승인 대기 · 치유됨 n · 되돌림 n), 위험순
- 팀원: `내 할 일` 표(프로젝트 · 케이스명 · 판정 · 자동 · 마감(지남/오늘) · 우선순위 · 최근 실행 · 동작), [실행]=`runTests(pid,{specPath, caseTitle:grep})`, [다시 실행]=`defects.rerun(pid,[{specPath,grep}])`, 실행 중이면 잠금, 통과는 접기. 그 아래 `내 프로젝트` 한 줄(기존 다시 실행 버튼 유지)
- A10: `AiJob.reviewedBy?: number | null`
- 테스트: 기존 5개를 새 문구로 고치고(공지 띠, 관리자 KPI, '통과 1 · 실패 1 · 미수행 1'), 추가 — 팀원 정렬 · [실행] 호출 인자 · 실행 중 잠금, PM 승인 대기 칩, 관리자 확인 필요 규칙(러너 오류 · 상태 불일치), 빈 상태

### Task 4: 확인
- vitest 전체 · tsc · vite build, 1280 · 1440 · 1920 스크린샷(`docs/screenshots/`), demo-rehearsal 문구 유지 확인
