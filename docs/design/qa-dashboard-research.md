# QA 대시보드 조사 (2026-11-19)

> 공개 제품 페이지 · 도움말을 Playwright 로 직접 열어 확인. 공급사 캡처는 저장소에 넣지 않음(로컬 scratchpad).

# AI-TestOps 화면 표준 비교 조사

> 확인 메모
> - 작업 지시에 적힌 `apps/web/src/lib/shellNav.ts`는 없다. 실제 파일은 `apps/web/src/config/shellNav.ts`이고, 탭 정의는 `apps/web/src/config/projectWorkspace.ts`에 있다.
> - 작업 지시는 탭을 15개로 셌다. 코드의 `ProjectTabId`는 16개다: input, plan, dashboard, source, structure, scenarios, recorder, runs, defects, results, ai-generate, ai-analysis, ai-review, schedules, settings, members. 이 문서는 16개를 기준으로 쓴다.
> - 캡처 파일은 조사용 임시 폴더 `/private/tmp/claude-501/-Users-junho-Developer-AI-TestOps/2340baec-e843-444f-b35d-ce3a7e0b4083/scratchpad/`(pwleak/shots, xlshots)에만 있다. 저장소에는 넣지 않는다.

---

## 1. 한 줄 결론

우리 화면은 이미 "자동 실행 → 결과"까지 돌아간다. 다만 QA 업계가 공통으로 쓰는 틀을 아직 따르지 않는다. 그 틀은 케이스 저장소, 계획(마일스톤·런), 수행·판정(미수행/통과/실패/차단/재시험), 결함(심각도·상태), 보고(Go/No-Go), 그리고 관리자 체계다. 그래서 먼저 판정 값·칸·탭 묶음을 표준에 맞춘다. 그다음 AI 생성·자가 치유·원인 분류·실제 브라우저 증거를 별도 AI 메뉴가 아니라 표의 칸·배지·버튼으로 옮긴다. 이 순서가 가장 싸고 효과가 크다.

---

## 2. 역할별 "첫 화면에서 보는 것" 비교표

| 역할 | TestRail | Qase | Testmo | Xray / Zephyr (Jira 앱) | PractiTest | Allure TestOps | 엑셀 양식 | **공통 패턴** | **지금 우리 화면** (`pages/HomePage.tsx`) |
|---|---|---|---|---|---|---|---|---|---|
| **관리자** | Dashboard: 프로젝트 목록, 최근 활동, 나의 To-Do. 교차 프로젝트 Activity 선 그래프. CROSS-PROJECT REPORTS에서 프로젝트별 Passed/Blocked/Untested/Retest/Failed 100% 누적 막대를 본다. 사용자·역할은 Administration > Users & Roles | 상단 Workspace 메뉴에 Users·Roles(엔티티별 CRUD 권한 표)·Fields·Tags·Billing이 있다. 'All projects' 범위의 Get Started Dashboard가 자동으로 생긴다. AI 토글 하나 | 상단 전역 탭 Projects / My work / Admin. Admin에서 Users·Subscription·MCP 토큰 회수·AI 끄기 | 별도 홈 없음. Jira 앱 설정의 기능 토글, AI Hub(전체/그룹 허용), 상태·우선순위 사용자 정의(이름·색) | 계정 설정에서 프로젝트를 관리한다. 상태 흐름(Draft/Ready/To repair/Obsolete)과 전이 권한을 정한다 | Administration에 Users and access, Global configuration(오류 분류·워크플로·역할). 인스턴스 역할(Admin/User/Guest)과 프로젝트 접근(Read/Write/Owner) 두 겹 | 관리자 개념이 없고 시트 단위로 제품을 나눈다. 첫 시트에 작성 규칙을 적는다 | 전 프로젝트 상태 분포(누적 막대) + 사용자·역할·필드·AI 정책 관리. 역할은 '전역 + 프로젝트별' 두 겹 | 공지 3개 → 타일 3개(프로젝트 N개 / 사용자 N명 / 러너 실행 중 N/N, 글자 한 줄) → 프로젝트 목록(상태 배지·기간·미해결 결함·진척 막대 %). 상태 분포 차트와 미수행 수가 없다 |
| **QA 리드·PM** | Project Overview. 좌측 고정 메뉴 6개(Overview/To-Do/Test Cases/Test Runs & Results/Milestones/Reports). To-Do에서 사용자별 워크로드 막대, 런마다 'N unassigned'·진행 막대·% | Single Value 카드(큰 숫자 + 30일 대비 ±% + 필터 칩). 런 대시보드는 상태 도넛·완료율·Team stats·Defects 탭 | Runs 첫 화면 KPI 카드 3개(진행 중 런·예상 작업량 / 성공률 / 닫힌 런 추세). 마일스톤별 런 표에 'Past due' 배지. 번다운 + 완료 예측 | Xray: Test Plan 'Overall Execution Status'(PASSED 6 / TO DO 1 + 색 막대). Zephyr: 사이클 목록 Progress 막대·%·상태 배지, 툴팁에 effort와 결함 수 | 대시보드 탭 + Tab-Level Filter(Version/Assignee/Milestone). 마일스톤 카드에 Release Readiness 게이지(0~1)와 'Off Track/Ready' 배지 | 질문별 대시보드 템플릿(Launch health 등). Low Performing Tests. Launch의 'Unresolved test results' 분류 대기열 | 결과 보고서 '개요': 총 TC, Pass/Fail/Block/Not Run, 성공률, Critical 결함 수, 릴리즈 가능 / 조건부 / 불가 | 진척률·통과율·담당자별 진행·기한 지남·마일스톤 마감 대비 예측·출시 판단 한 줄 | '내가 맡은 프로젝트' 카드: 진척률 %(= 성공 ÷ 계획), 담당자별 '성공/계획 · 실패' 표, 기한 지남 5건. 마일스톤, 차단/미수행 분포, 출시 판단이 없다 |
| **테스터** | Dashboard의 나의 To-Do(Active/Upcoming). 런 클릭 시 '내게 배정된 것만' 필터. 3분할 수행 화면에 Pass & Next와 일괄 Add Results | 벨·이메일 알림(배정됨, 런 시작). 런 위저드에 Fast Pass, 제출 후 다음 미수행으로 이동 | My work: 배정된 런 수 / 세션 수 / 읽지 않은 알림 카드, 배정 목록(진행 막대 %), 오늘 내가 남긴 결과 타임라인 | Xray 'Only My Test Runs' 토글, 수행 화면 'Test 1 of 2', 타이머. Zephyr Test Player에 '내 배정만' 체크와 'Set all below to' | 랜딩에 프로젝트 전체의 'Assigned to me' / 'Last actions'. 실행 화면 'Fail & Issue', 'Run Next Test', Fast Run | 전용 홈은 확인 못 함. Launch Tree의 [Failed] [Passed] 버튼 | TC 시트의 행을 채운다(실제 결과·판정·결함 ID). 실행 로그 양식 | 내 배정 목록(마감·진행률) → 클릭 한 번으로 수행 화면 → 판정 1클릭 + 다음으로 | 공지 → '내 프로젝트'(성공·실패·미수행, '실패 N건 다시 실행') → 맨 아래 '나에게 배정된 항목'(마감·최근 결과, 계획 탭 링크만). 수행·판정 버튼이 없다 |

---

## 3. 테스트 케이스 표 · 테스트 런 표의 표준 칸

### 3-1. 테스트 케이스(저장소) 표

| 칸 | 공통? | TestRail | Qase | Zephyr | PractiTest | Allure | 엑셀 양식 | 우리 (`ScenarioTab.tsx` 596~601행, `PlanTab.tsx` 칸 정의) |
|---|---|---|---|---|---|---|---|---|
| ID | 공통 | C번호 | 코드-번호(DEMO-42, 이동해도 고정) | Key | ID | AllureID | TC ID(SIGNUP-AUTH-001) / No. | 없음(specPath + 제목이 키) |
| 제목 | 공통 | Title* | Title | Name* | Name | 이름 | 소분류/테스트 목표 | '시나리오 / 케이스', '계획 항목' |
| 위치(섹션·폴더) | 공통 | Section* | Suite | Folder | (필터 트리) | 커스텀 필드 트리 | 대·중·소분류 | 파일 경로(소스), '화면'(계획 표) |
| 사전조건 | 공통 | Preconditions | Pre-conditions | Precondition | Preconditions | Precondition | 사전조건 | 없음 |
| 단계 / 기대 결과 | 공통 | Steps + Expected | Action·Data·Expected | Step·Expected | Description·Expected | 스텝 + Expected | 절차·기대 결과 | 없음(코드 안에만 있음) |
| 우선순위 | 공통 | Critical~Low | Low~High (+Severity 6단계) | Priority | 커스텀 | 커스텀 | P1~P3 | '우선순위'(높음/보통/낮음, 계획 표) |
| 유형 | 대부분 | Type | Type·Layer·Behavior | — | 테스트 타입 | Layer | 분류(기능/경계값/예외…) | 없음 |
| 작성 상태 | 대부분 | Draft/Review/Approved | Active/Draft/Deprecated | Draft/Approved | Draft/Ready/To Repair | Draft→Review→Active→Outdated | — | 없음('사용' 체크만) |
| 근거(요구사항) | 대부분 | References | 요구사항 링크 | Coverage(이슈 키) | Linked Requirements | Links | 근거(R-07, POL-…) | 없음(화면 지도 Node가 대신할 수 있음) |
| 자동화 여부 | 대부분 | Is Automated | Automation Status | (수동/자동 보고서) | Automated 타입 | 수동/자동 아이콘 | — | 모두 자동(Playwright) |
| 작성자·담당 | 대부분 | Assigned To(설계) | Author | Owner | Author | Members(Lead/Owner) | — | 계획 표 '담당자'(수행 담당) |
| 추정 시간 | 일부 | Estimate | — | Estimated Time | Duration Estimate | — | — | 없음 |
| 태그 | 일부 | — | Tags | Labels | 커스텀 | Tags | — | 없음 |

### 3-2. 테스트 런(수행) 표

| 칸 | 공통? | 출처 예 | 우리 |
|---|---|---|---|
| 테스트 ID · 제목 | 공통 | TestRail T번호, Xray Key·Summary | 실행 이력 '케이스'(`ExecutionsTab.tsx` 68행) |
| 담당자(배정) | 공통 | TestRail Assigned To, Xray Assignee | 계획 표에만 있음 |
| 판정 | 공통 | 모든 도구 | 계획 '최근 결과', 실행 '상태'·'결과' |
| 실행자 · 실행 일시 | 공통 | Xray Executed By·Started/Finished, 엑셀 실행 로그 | '시작'만 있음(실행자 없음) |
| 소요 시간 | 대부분 | TestRail Elapsed, Zephyr 타이머, PractiTest Last Run Duration | '소요' 있음 |
| 환경(브라우저·OS) | 대부분 | TestRail Configurations, Qase 구성, Zephyr Environment | 없음 |
| 결함 링크 · 결함 수 | 공통 | Xray #Defects, PractiTest Linked Issues | 결함 탭에 따로 있음 |
| 코멘트 · 첨부(증거) | 공통 | TestRail Comment·Attachments | 결과 탭 아티팩트(스크린샷·영상) |
| 버전·빌드 | 일부 | TestRail Version, Zephyr Release version | 없음 |
| 재시험 이력 | 일부 | Qase Retries 탭, Allure job run | 'N차 테스트', '#N 다시 실행' 표시 |

### 3-3. 판정 값과 한글 표기

| 도구 | 판정 값 |
|---|---|
| TestRail | Untested · Passed · Failed · Retest · Blocked (사용자 정의 가능, 한 번 입력하면 Untested로 되돌릴 수 없음) |
| Qase | (Untested) · Passed · Failed · Blocked · Skipped · Invalid (+retest) |
| Testmo | Untested · Passed · Failed · Retest · Skipped |
| Xray | TO DO · EXECUTING · PASSED · FAILED (+BLOCKED 등 사용자 정의) |
| Zephyr | Not Executed · In Progress · Pass · Fail · Blocked |
| PractiTest | NO RUN · NOT COMPLETED · PASSED · FAILED · BLOCKED · N/A (집계 규칙: FAILED > BLOCKED > NOT COMPLETED > PASSED) |
| Allure | Passed · Failed · Broken(테스트 자체 결함) · Skipped · Unknown (고정 5개) |
| 엑셀 | PASS · FAIL (보고서 요약은 Pass · Fail · Block · Not Run) |

**표준 한글 표기 제안** (모든 화면에서 같은 낱말을 쓴다)

| 코드 | 한글 | 색 | 비고 |
|---|---|---|---|
| UNTESTED | 미수행 | 회색 | 초기값 |
| PASSED | 통과 | 초록 | 엑셀 'PASS'와 블로그 번역 모두 '통과' |
| FAILED | 실패 | 빨강 | 제품 결함 의심 |
| BLOCKED | 차단 | 주황 | 환경·선행 결함 때문에 수행 불가 |
| RETEST | 재시험 | 보라 | 수정 후 다시 확인 필요 |
| SKIPPED | 건너뜀 | 연회색 | 범위 제외(N/A) |
| (우리 확장) BROKEN | 스크립트 오류 | 노랑 | Allure Broken에 해당한다. 셀렉터·스크립트 문제로, 자가 치유 대상 |

실행 상태(대기·실행 중·중단·완료)는 판정과 다른 칸으로 둔다.

**우리 강점을 칸으로 녹이는 방법**

| 강점 | 들어갈 자리 |
|---|---|
| AI 생성 | 케이스 표 '출처' 칸에 `AI 생성` 배지와 원 요구사항 링크(Qase AI 라벨, Testmo AI-generated 태그) |
| 자가 치유 | 런 판정 옆 `자동 교정 1/2` 배지, 교정 diff는 '검토 대기'로 |
| 실패 원인 분류 | 결함 표 '원인' 칸: 제품 버그 / 스크립트 오류 / 환경 / 불안정 |
| 학습 루프 | 같은 원인 실패에 '기존 결함에 자동 연결됨' 표시 |
| 실제 브라우저 | '증거' 칸에 스크린샷·영상·trace 아이콘 |

---

## 4. 계획 → 수행 → 판정 → 결함 → 보고 동선

### 4-1. 업계 표준 동선

```
케이스 저장소(요구사항 근거)
  → 계획: 마일스톤(릴리스·기한) → 테스트 플랜 / 런 생성(케이스 범위, 환경, 담당자 배정)
  → 수행: 내 배정 목록 → 수행 화면(판정 1클릭, Pass & Next, 일괄 판정, 타이머)
  → 판정: 미수행/통과/실패/차단/재시험, 스텝 → 케이스 → 런 집계
  → 결함: 실패 판정 대화상자에서 결함 생성·기존 결함 연결(심각도·상태·외부 이슈 키)
  → 재시험: 실패·차단만 골라 새 런(Rerun / Create Execution With status / Clone failed)
  → 런 종료(Close, 결과 잠금)
  → 보고: 런·마일스톤 요약, 추적성, 출시 판단(Go / 조건부 / No-Go)
```

### 4-2. 지금 우리 탭 묶음 (`config/shellNav.ts` `WORKSPACE_GROUPS`)

| 그룹 | 탭 |
|---|---|
| 입력 | input |
| 계획 | plan, scenarios, recorder, structure |
| 실행 | runs, defects, results, schedules |
| 대시보드 | dashboard |
| 설정 | settings, members, source |
| AI (AI 켤 때만) | ai-generate, ai-analysis, ai-review |

### 4-3. 표준 동선에 맞춘 묶음 제안 (TestRail 좌측 6메뉴 구조)

| 표준 단계 | 메뉴 | 들어갈 우리 탭 | AI 강점이 붙는 자리 |
|---|---|---|---|
| 개요 | **개요** | dashboard(기본 탭) | 진척·통과율 카드 옆에 '검토 대기 N건' |
| 저장소 | **테스트 케이스** | scenarios(케이스 표), structure(화면 지도 = 커버리지 보기), recorder · ai-generate(→ '케이스 추가' 버튼의 선택지), ai-review(→ 작성 상태 '검토 대기' 필터) | 'AI로 만들기'를 추가 버튼에 넣고, AI 생성 배지, 승인 전 Draft |
| 계획 | **계획** | plan(→ 마일스톤 + 런 계획), schedules(→ 반복 런) | 실패 이력 기반 우선순위 제안 |
| 수행·판정 | **실행** | runs + results(→ 런 상세 한 화면: 표 + 증거) | 자동 교정 배지, 실제 브라우저 증거 |
| 결함 | **결함** | defects + ai-analysis(→ 결함 행의 '원인 분석' 패널) | 원인 분류 칸, 같은 원인 자동 연결 |
| 보고 | **보고서** | (새로 만듦) 런·마일스톤 요약, Go/No-Go, 엑셀/PDF 내보내기 | AI 요약 한 줄(사람 확인 후 확정) |
| 관리 | **설정** | settings, members, input(저장소 연결), source(PM 이상) | AI 정책 |

---

## 5. 표준 보고서 · 차트 목록

| 보고서 / 차트 | 내용 | 출처 | 우리 현황 |
|---|---|---|---|
| 런 요약 | 상태 파이(개수·%) + 큰 숫자 '53% 통과, 77/219 미수행' | TestRail Run, Qase 런 대시보드 | 대시보드 '차수별 결과'(파이·미수행 없음) |
| 마일스톤 / 플랜 요약 | 마감일, 활성 런 수, 상태색 막대, % | TestRail Milestones, Xray Test Plan | 없음 |
| 진척(번다운·번업) | 남은 테스트·남은 공수·이상선, 마감 대비 예측일 | TestRail Progress, Testmo, Zephyr burn up/down | 없음 |
| 계획 대비 실제 | 계획 TC 수 vs 실행 TC 수 추이 | PractiTest Planned vs Executed, 엑셀 진척도 | 없음 |
| 담당자별 작업량 | 사용자별 배정·완료·남음 막대 | TestRail Workload, Zephyr by tester, Qase Team stats | 홈의 PM 카드에만 표로 있음 |
| 결함 요약 | 심각도별·상태별 분포, Top N, 결함 수명 | TestRail Defects Summary, PractiTest Defect age, 엑셀 | 결함 목록만 있음(심각도 없음) |
| 요구사항 추적성 | 요구사항 → 케이스 → 런 → 결함 4열, OK/NOK/NOTRUN/UNCOVERED | Xray, Zephyr Traceability, 엑셀 커버리지 시트 | 화면 지도가 비슷함(화면 → 케이스) |
| 런 비교(회귀 히트맵) | 런마다 열 하나, 결과 색 칸 | Allure Compare launches, TestRail Comparison | '지난번과 비교' 한 쌍만 |
| 추세 | 통과율·자동화율·flaky 수 추이 | Qase Time Series, Allure Launch Trend | '최근 차수 흐름' 막대 |
| 저성과·불안정 테스트 | 통과율 최저·가장 느린·flaky | Allure Low Performing, Qase flaky | 없음 |
| 출시 판단 | 숫자 + 한 줄(가능 / 조건부 / 불가), 사전 등록한 출시 기준 자동 판정 | 엑셀 실무(genycho, dev_blueprint, logossoft), PractiTest Release Readiness | 없음 |
| 결과 보고서 문서 | 개요·범위·정량·결함·잔존 리스크·커버리지·결론 | 엑셀 실무, PractiTest Report Center | Playwright HTML 리포트만 |
| 공통 기능 | 차트 PNG/CSV/XLS 다운로드, 드릴다운, 기간 필터, 예약 생성, 공유 링크, Excel/PDF | TestRail, Qase, PractiTest | 없음 |

---

## 6. 경쟁 도구의 AI 기능과 우리가 앞서는 지점

| 도구 | AI 기능 | 범위 |
|---|---|---|
| TestRail | 요구사항 → 제목·설명 먼저 제안 → 사람이 고름 → 상세 케이스 생성. 케이스 텍스트로 자동화 코드 초안. AI Hub에서 역할별로 켜기 | 생성(문서·코드 초안). 실행은 안 함 |
| Qase | AI Test Designer(Jira·GitHub 이슈와 파일 첨부 → 케이스, AI 라벨), 자연어 → QQL, 외부 플러그인 Quality Supervisor(실패를 오류 서명으로 묶어 제품 버그/자동화/환경/flaky 분류, Go/No-Go). AIDEN 자동화는 2026-11 종료 | 생성 + 외부 분석(MCP) |
| Testmo | AI 케이스 생성 3단계 마법사(Beta), AI-generated 태그, 공식 MCP | 생성 |
| Xray | 케이스·자동화 스크립트 생성, AI Test Prioritization(실패율·flaky 기반) | 생성 + 우선순위 |
| Zephyr | Rovo 에이전트(생성·수행 요약·Release Risk), 노코드 클라우드 레코더 + 실행 엔진 + 'AI 스텝 실패 시 고치기' | 생성 + 녹화 실행 + 일부 치유. **가장 가까운 경쟁자** |
| PractiTest | SmartFox(스텝 생성·문장 다듬기, Accept/Reject), Project Assistant 채팅, Test Value Score | 작성 보조 + 점수 |
| Allure TestOps | MCP 서버(도구 13개), 정규식 automation rule로 같은 실패 자동 연결, flaky 탐지 | 분류(규칙 기반) |

**우리가 앞서는 지점** (코드 근거)

1. **생성에서 끝나지 않고 실제 브라우저로 돌린다.** AI가 만든 Playwright 테스트를 러너가 바로 실행하고 스크린샷·영상을 증거로 남긴다(`ResultsTab.tsx` 아티팩트). TestRail·Qase·Testmo·Xray의 AI 생성은 문서나 코드 초안에서 멈춘다.
2. **자가 치유 + 회귀 검증 + 자동 되돌림.** 실패하면 로그를 보고 셀렉터를 최대 2회 고친다(`AiBootstrapProgressDialog.tsx` healAttempt). 적용 후 회귀가 보이면 자동으로 되돌린다(`AiAnalysisTab.tsx` `REGRESSED: '회귀 감지됨 → 자동 되돌림'`). 경쟁 도구 중에는 Zephyr의 'AI 스텝 실패 시 고치기'만 비슷하다.
3. **사람 승인 후 반영이 제품 안에 있다.** `AiReviewTab.tsx`의 NEEDS_REVIEW → 승인/거부 흐름이다. TestRail 2단계 검토, PractiTest Accept/Reject와 같은 원칙이고, 코드 변경까지 다룬다.
4. **화면 지도(지식 그래프)가 커버리지 근거가 된다.** `StructureTab.tsx`, `lib/coverage.ts`의 화면별 통과/막힘 표시는 Xray·Zephyr 추적성 표의 '요구사항' 자리를 화면 Node로 대신할 수 있다.
5. **실패 원인 분류의 씨앗이 있다.** `lib/coverage.ts`에 OPEN_FAILED('화면이 열리지 않았어요'), SELECTOR_FAILED('버튼이나 입력칸을 찾지 못했어요')가 있다. Qase는 이 분류를 외부 플러그인으로, Allure는 사람이 만든 정규식으로 한다. 우리는 이것을 결함 표의 '원인' 칸으로 내장하면 앞선다.
6. **아직 앞서지 못한 곳.** 학습 루프는 화면에서 확인하지 못했다. 실패 우선순위(Xray), flaky 탐지(Allure·Qase), 출시 위험 판단(Zephyr·Qase)도 우리에게 없다.

---

## 7. 따라 할 화면 패턴 상위 10개

| # | 패턴 | 출처 도구 | 근거 URL (캡처) |
|---|---|---|---|
| 1 | 좌측 고정 메뉴 6개(개요/할 일/케이스/런·결과/마일스톤/보고서). 역할 차이는 메뉴가 아니라 보이는 데이터 범위로 둔다 | TestRail | https://support.testrail.com/hc/en-us/articles/7076810203028-Introduction-to-TestRail (testrail-product) |
| 2 | 테스터 첫 화면 'My work': 배정 수·알림 카드 3개 + 배정 목록(진행 막대 %) + 오늘 내 결과 타임라인 | Testmo | https://www.testmo.com/qa-productivity (testmo-my-todos) |
| 3 | 런 상단 2카드: 상태 파이(개수·%) + 큰 숫자 '53% 통과 / 77건 미수행(35%)'. 카드 모서리에 다운로드 | TestRail | https://support.testrail.com/hc/en-us/articles/7101753582996-Charts-and-dashboards (testrail-run) |
| 4 | 3단 수행 화면(트리 / 목록+상태 배지 / 상세+이력)과 'Pass & Next', 일괄 판정 | TestRail · Testmo | https://support.testrail.com/hc/en-us/articles/15813183376148-Submitting-test-results , https://www.testmo.com/test-case-management (testmo-run-results) |
| 5 | Runs 목록 KPI 카드 3개 + 마일스톤별 그룹 표 + 'Past due' 배지 + 번다운의 마감 대비 예측일 | Testmo | https://www.testmo.com/qa-metrics-reporting (testmo-runs-index), https://www.testmo.com/qa-project-milestones (testmo-milestone-burndown) |
| 6 | 실패 판정 대화상자 안의 '결함 만들기/기존 결함 연결' 체크. 코멘트를 실제 결과로 자동 복사 | Qase | https://docs.qase.io/en/articles/5563710-defects (qase-defects) |
| 7 | '실패·차단만 골라 재수행 런 만들기' 버튼 | Xray · Qase | https://docs.getxray.app/space/XRAYCLOUD/44565153 (xray-testplan), https://docs.qase.io/en/articles/5563702-test-runs |
| 8 | 'Unresolved test results' 분류 대기열. 실행 상태와 사람의 판단(resolution)을 분리하고 Failed와 Broken을 나눈다 | Allure TestOps | https://docs.qameta.io/allure-testops/use-testops/test-plans-and-launches/launches-overview/ (allure-launch-overview) |
| 9 | 추적성 4열 표(요구사항 → 케이스 → 실행 → 결함) + OK/NOK/NOTRUN/UNCOVERED 칩. 근거별 TC가 0개면 '빠짐' | Xray · 엑셀(dev_blueprint) | https://docs.getxray.app/space/XRAYCLOUD/44565208 (xray-traceability), https://m.blog.naver.com/dev_blueprint/224454543237 (xl-devblueprint) |
| 10 | 보고서 첫 블록 = 숫자 + 한 줄 판단(가능 / 조건부 / 불가). 출시 기준은 테스트 전에 등록하고 맨 아래에서 자동 판정 | 엑셀 실무 · PractiTest | https://m.blog.naver.com/genycho/224178050321 (xl-genycho-report), https://www.practitest.com/help/test-planning-and-execution/milestones/ (practitest-milestones) |

---

## 8. 우리 화면이 지금 표준과 다른 점 상위 10개

| # | 문제 | 표준 | 근거 파일 |
|---|---|---|---|
| 1 | **판정 값이 통과·실패 2개뿐이다.** 차단·재시험·건너뜀이 없어 '환경 때문에 못 함'과 '제품 결함'을 구분할 수 없다 | 미수행/통과/실패/차단/재시험(+건너뜀) | `apps/web/src/types/index.ts` `PlanItem.lastStatus: 'PASSED' \| 'FAILED' \| null`, `components/project/PlanTab.tsx` 20~23행 `RESULT_VIEW` |
| 2 | **같은 판정을 화면마다 다르게 부른다.** 성공(계획·실행 이력), 통과(결과·화면 지도), 스킵(결과), FAILED를 '막힘'으로 쓰는 곳도 있고 BLOCKED도 '막힘'이다 | 한 낱말, 한 색 | `PlanTab.tsx` 21행, `lib/utils.ts` 16행 `PASSED: '성공'`, `ResultsTab.tsx` 145~147행, `lib/coverage.ts` 39·66·67행 |
| 3 | **실행 상태와 판정이 한 칸에 섞여 있다.** 대기·실행 중·중단과 성공·실패·오류가 한 enum의 '상태' 칸에 들어간다 | 실행 상태와 판정을 다른 칸으로 | `lib/utils.ts` 10~18행 `executionStatusLabel`, `ExecutionsTab.tsx` 57행 '상태' |
| 4 | **결함에 심각도·우선순위·외부 이슈 키가 없다.** 상태도 미해결/해결 둘뿐이다(저장소 전체를 `심각도`·`severity`로 검색해도 0건) | 심각도(심각/보통/경미), 상태(Open/Fixed/Re-test/Closed), Jira 키 | `components/project/DefectsTab.tsx` 128~129행, 203~210행 |
| 5 | **진척률 산식이 표준과 다르다.** '진척률 = 성공 ÷ 계획'이라 실패가 많으면 다 돌렸어도 진척이 낮게 나온다 | 진척도 = 실행 ÷ 계획, 합격률 = 통과 ÷ 실행(분모가 다름) | `pages/HomePage.tsx` 16~20행 `progressOf` |
| 6 | **탭 묶음이 표준 동선과 다르다.** '계획'에 케이스 저장소(scenarios·recorder·structure)가 섞이고, 결함이 '실행' 아래 숨고, 코드 편집기가 '설정'에 있다. AI는 따로 떨어진 그룹이라 강점이 표 안에 보이지 않는다 | 케이스 / 계획 / 실행 / 결함 / 보고서 / 설정 | `apps/web/src/config/shellNav.ts` `WORKSPACE_GROUPS`, `aiOnly` |
| 7 | **케이스 표에 표준 칸이 없다.** 지금 칸은 시나리오/케이스·소스·사용·최종 상태·최종 실행시간·액션이다. ID·사전조건·단계·기대 결과·근거·유형·작성 상태가 없어 엑셀 TC 양식과 대조할 수 없다 | 3-1 표의 공통 칸 | `components/project/ScenarioTab.tsx` 594~601행, `PlanTab.tsx` 칸 정의(129~237행) |
| 8 | **마일스톤과 런 단위가 없다.** 계획 표는 항목마다 '최근 결과' 하나만 갖고, '차수'는 실행 이력에서 계산할 뿐 계획된 런이 아니다. 런 종료·결과 잠금, 마감 대비 진척도 없다 | 마일스톤 → 런(범위·담당·환경) → 종료 | `types/index.ts` `PlanItem.lastStatus/lastRunAt`, 330행 'N차 테스트 … 실행 이력에서 계산', `ProjectDashboardTab.tsx` '차수별 결과' |
| 9 | **보고서와 엑셀 입출력이 없다.** 계획·케이스·결함을 Excel/CSV/PDF로 내보내거나 가져올 수 없다. 결과 탭은 Playwright HTML 리포트와 아티팩트만 보여 주고 Go/No-Go 판단도 없다 | 내보내기(XLSX/CSV/PDF), 가져오기 마법사(열 매핑), 결과 보고서 | `components/project/ResultsTab.tsx` 194~213행, `PlanTab.tsx`(내보내기 버튼 없음) |
| 10 | **역할별 첫 화면이 '할 일' 중심이 아니다.** 모두에게 공지가 맨 위에 오고, 테스터의 '나에게 배정된 항목'은 맨 아래에 계획 탭 링크로만 있다(수행·판정 버튼 없음). 관리자 타일은 글자 한 줄이고 상태 분포·미수행·차단이 보이지 않는다 | 테스터는 내 배정 → 1클릭 수행. 관리자는 프로젝트별 상태 누적 막대 | `pages/HomePage.tsx` 'Tile'(31~33행), '전체 현황'·'나에게 배정된 항목' 구역 |

---

## 9. 출처 URL 목록

캡처는 위 '확인 메모'에 적은 임시 폴더에만 있다. 저장소에는 넣지 않는다. 괄호 안이 캡처 이름이다.

**TestRail** — support.testrail.com은 Cloudflare가 브라우저 접근을 막아 Zendesk 공개 API(`/api/v2/help_center/en-us/articles/<id>.json`)로 본문과 원본 스크린샷을 받았다.
- https://www.testrail.com/test-management/ (testrail-product)
- https://support.testrail.com/hc/en-us/articles/7076810203028-Introduction-to-TestRail
- https://support.testrail.com/hc/en-us/articles/7101753582996-Charts-and-dashboards (testrail-run)
- https://support.testrail.com/hc/en-us/articles/9368344240404-Customizing-charts
- https://support.testrail.com/hc/en-us/articles/16501050634260-Assigning-tests-for-execution (testrail-todo)
- https://support.testrail.com/hc/en-us/articles/15813183376148-Submitting-test-results
- https://support.testrail.com/hc/en-us/articles/7076838639892-Creating-new-test-runs
- https://support.testrail.com/hc/en-us/articles/15545364561044-Milestones (testrail-milestones)
- https://support.testrail.com/hc/en-us/articles/9285210470420-Reports-overview (testrail-report)
- https://support.testrail.com/hc/en-us/articles/34887408278036-Projects-Test-Execution-Summary (testrail-crossproject)
- https://support.testrail.com/hc/en-us/articles/14940939006740-Test-case-fields
- https://support.testrail.com/hc/en-us/articles/7101779988372-Import-test-cases-from-CSV-or-Excel
- https://support.testrail.com/hc/en-us/articles/15144643126932-Export-test-cases
- https://support.testrail.com/hc/en-us/articles/7610049585684-Managing-user-permissions-and-roles
- https://support.testrail.com/hc/en-us/articles/37119835854484-Quick-Start-Generate-Test-Cases-with-AI
- https://support.testrail.com/hc/en-us/articles/46901632532244-Getting-the-most-out-of-AI-Powered-Automation-in-TestRail
- https://support.testrail.com/hc/en-us/articles/7077792415124-Projects
- https://support.testrail.com/hc/en-us/articles/7077723976084-Milestones

**Qase**
- https://docs.qase.io/en/articles/5563698-dashboards (qase-dashboards)
- https://docs.qase.io/en/articles/5563702-test-runs
- https://docs.qase.io/en/articles/5563710-defects (qase-defects)
- https://docs.qase.io/en/articles/5563704-test-cases
- https://docs.qase.io/en/articles/5563703-test-plans
- https://docs.qase.io/en/articles/5563741-roles-permissions
- https://docs.qase.io/en/articles/8870484-notifications
- https://docs.qase.io/en/articles/5563688-getting-started
- https://docs.qase.io/en/articles/5563717-export-test-cases
- https://docs.qase.io/en/articles/5563719-import-test-cases
- https://docs.qase.io/en/articles/14442830-ai-in-qase
- https://docs.qase.io/en/articles/9653096-ai-test-designer (qase-ai-test-designer)
- https://docs.qase.io/en/articles/16630482-qase-quality-supervisor
- https://www.qase.io/product/test-intelligence/ (qase-test-intelligence)

**Testmo** — docs.testmo.com은 Cloudflare 확인 페이지에 막혀 공개 제품 페이지만 확인했다.
- https://www.testmo.com/
- https://www.testmo.com/qa-metrics-reporting (testmo-runs-index, testmo-run-issues)
- https://www.testmo.com/test-case-management (testmo-run-results)
- https://www.testmo.com/qa-project-milestones (testmo-milestone-burndown)
- https://www.testmo.com/qa-productivity (testmo-my-todos)
- https://www.testmo.com/features
- https://www.testmo.com/ai
- https://www.testmo.com/pricing
- https://www.testmo.com/blog/introducing-ai-test-case-generation-in-testmo-beta/ (testmo-ai-generate)
- https://www.testmo.com/blog/the-official-testmo-mcp/

**Xray (Jira Cloud)**
- https://docs.getxray.app/space/XRAYCLOUD/44566476/About+Xray
- https://docs.getxray.app/space/XRAYCLOUD/44565153 (xray-testplan)
- https://docs.getxray.app/space/XRAYCLOUD/44565117 (xray-testexec)
- https://docs.getxray.app/space/XRAYCLOUD/44565122 (xray-execscreen)
- https://docs.getxray.app/space/XRAYCLOUD/44579147 (xray-testingboard)
- https://docs.getxray.app/space/XRAYCLOUD/44566291/Reports+&+Analysis
- https://docs.getxray.app/space/XRAYCLOUD/338526916 (xray-repcenter)
- https://docs.getxray.app/space/XRAYCLOUD/44565208 (xray-traceability)
- https://docs.getxray.app/space/XRAYCLOUD/44566250
- https://docs.getxray.app/space/XRAYCLOUD/44566384
- https://docs.getxray.app/space/XRAYCLOUD/44565062
- https://docs.getxray.app/space/XRAYCLOUD/1701117953
- https://docs.getxray.app/space/XRAYCLOUD/1241974430

**Zephyr (SmartBear)**
- https://smartbear.com/test-management/
- https://support.smartbear.com/zephyr/docs/
- https://support.smartbear.com/zephyr/docs/en/test-cycles/test-cycles--overview-.html (zephyr-cycles)
- https://support.smartbear.com/zephyr/docs/en/test-cycles/running-a-test-cycle.html (zephyr-testplayer)
- https://support.smartbear.com/zephyr/docs/en/test-cycles/track-progress.html (zephyr-cycleprogress)
- https://support.smartbear.com/zephyr/docs/en/test-cycles/traceability-in-test-executions.html
- https://support.smartbear.com/zephyr/docs/en/test-cases/test-cases-overview.html
- https://support.smartbear.com/zephyr/docs/en/test-cases/creating-a-test-case.html
- https://support.smartbear.com/zephyr/docs/en/test-cases/import-test-cases.html
- https://support.smartbear.com/zephyr/docs/en/test-plans.html
- https://support.smartbear.com/zephyr/docs/en/reports-and-analysis/overview.html (zephyr-report)
- https://support.smartbear.com/zephyr/docs/en/reports-and-analysis/generating-reports.html
- https://support.smartbear.com/zephyr/docs/en/reports-and-analysis/using-gadgets.html
- https://support.smartbear.com/zephyr/docs/en/configuration/advanced-customization-options/priorities-and-statuses.html (zephyr-statuses)
- https://support.smartbear.com/zephyr/docs/en/zephyr-agent-for-rovo.html
- https://support.smartbear.com/zephyr/docs/en/zephyr-agent-for-rovo/test-execution-summary-skill.html
- https://support.smartbear.com/zephyr/docs/en/run-automated-test-with-zephyr.html

**PractiTest** — `https://www.practitest.com/qa-dashboard/`는 404라 쓰지 않았다.
- https://www.practitest.com/help/
- https://www.practitest.com/help/getting-started/testers/
- https://www.practitest.com/help/getting-started/admins/
- https://www.practitest.com/help/getting-started/practitest-methodology/
- https://www.practitest.com/help/data-management-and-analysis/dashboards/ (practitest-dashboards)
- https://www.practitest.com/help/test-planning-and-execution/test-sets-and-runs/ (practitest-testset-instances, practitest-run-screen)
- https://www.practitest.com/help/test-planning-and-execution/tests/ (practitest-test-library)
- https://www.practitest.com/help/data-management-and-analysis/reports/
- https://www.practitest.com/help/test-planning-and-execution/milestones/ (practitest-milestones)
- https://www.practitest.com/help/test-planning-and-execution/requirements/
- https://www.practitest.com/help/test-planning-and-execution/smart-fox-ai-assistant/
- https://www.practitest.com/help/using-ai-in-practitest/project-assistant/
- https://www.practitest.com/help/data-management-and-analysis/test-value-score/

**Allure TestOps**
- https://docs.qameta.io/allure-testops/
- https://qameta.io/
- https://docs.qameta.io/allure-testops/use-testops/results-and-analytics/dashboards/ (allure-dashboards)
- https://docs.qameta.io/allure-testops/use-testops/test-plans-and-launches/launches-overview/ (allure-launch-overview)
- https://docs.qameta.io/allure-testops/use-testops/test-plans-and-launches/run-manual-tests/ (allure-manual-run)
- https://docs.qameta.io/allure-testops/getting-started/first-evaluation/run-a-manual-test/
- https://docs.qameta.io/allure-testops/use-testops/results-and-analytics/test-results/
- https://docs.qameta.io/allure-testops/use-testops/test-plans-and-launches/test-plans/
- https://docs.qameta.io/allure-testops/use-testops/test-cases/
- https://docs.qameta.io/allure-testops/use-testops/test-cases/import-test-cases/
- https://docs.qameta.io/allure-testops/use-testops/results-and-analytics/defects/
- https://docs.qameta.io/allure-testops/reference/ecosystem/mcp-server/
- https://docs.qameta.io/allure-testops/use-testops/test-plans-and-launches/release-information/
- https://docs.qameta.io/allure-testops/administer/
- https://docs.qameta.io/allure-testops/administer/users-and-access/project-access-model/
- https://docs.qameta.io/allure-testops/use-testops/projects/
- https://docs.qameta.io/allure-testops/use-testops/test-cases/workflows-and-statuses/
- https://docs.qameta.io/allure-testops/use-testops/test-management/project-trees/ (allure-testcase-tree)
- https://docs.qameta.io/allure-testops/use-testops/test-cases/members-and-ownership/
- https://docs.qameta.io/allure-testops/use-testops/test-plans-and-launches/compare-launches/

**엑셀 기반 QA 양식 (한국 실무)**
- https://search.naver.com/search.naver?where=blog&query=테스트+케이스+양식+엑셀
- https://search.naver.com/search.naver?where=blog&query=테스트+결과+보고서+양식
- https://www.hanseo.ac.kr/boardCnts/fileDown.do?fileSeq=3870f5ad16e06cb38989e530a24713be (붙임2.SW제품 테스트 결과보고서.xlsx)
- https://www.cku.ac.kr/bbs/cku_kr/1202/146153/download.do (같은 파일)
- https://m.blog.naver.com/dev_blueprint/224454543237 (xl-devblueprint)
- https://m.blog.naver.com/it_brand/224424857631 (xl-itbrand-tc)
- https://m.blog.naver.com/jerrys_knowledge/224094211013 (xl-jerrys)
- https://m.blog.naver.com/genycho/224178050321 (xl-genycho-report)
- https://m.blog.naver.com/genycho/224254204233
- https://m.blog.naver.com/wntkgo/224330598162 (xl-wntkgo)
- https://m.blog.naver.com/logossoft1210/224470263927 (xl-logos-report)
- https://m.blog.naver.com/tbell2015/224412135370

**우리 코드 (비교 근거)**
- `apps/web/src/pages/HomePage.tsx`
- `apps/web/src/config/shellNav.ts`
- `apps/web/src/config/projectWorkspace.ts`
- `apps/web/src/components/project/` (PlanTab, ScenarioTab, ExecutionsTab, ResultsTab, DefectsTab, ProjectDashboardTab, StructureTab, AiAnalysisTab, AiReviewTab, RecorderTab, SchedulesTab, MembersTab, SourceExplorerTab)
- `apps/web/src/lib/utils.ts`, `lib/plan.ts`, `lib/coverage.ts`, `types/index.ts`, `components/AiBootstrapProgressDialog.tsx`