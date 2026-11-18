# 자체 리뷰 — 웹사이트 전체 개선안 (2026-11-18)

관점 4개(QA 실무 · AI 차별화 · 화면 구조 · 신뢰 통제) 제안 → 관점별 비판자 반박 → 종합. 방향: AI 로 QA 를 획기적으로 바꾼다.

추가로 브랜치 리뷰 중 범위 밖으로 나온 기존 결함: 러너 컨테이너가 docker.sock 과 --volumes-from playops-api 를 받고 testCommand 를 root 로 실행 — 어느 프로젝트든 PM 이면 서버 비밀값 · 호스트 root 에 닿을 수 있음 (docker-compose.yml:49-52, DockerRunnerService.java:506-516, TestExecutionService docker exec --user 0).

1. **한 줄 총평**: 지금 제품은 "AI가 테스트를 만들고 고쳐 주는 실행기" 단계입니다. 생성·수정 제안·승인 같은 뼈대는 있습니다. 하지만 실패가 테스트 문제인지 앱 결함인지 가리는 판단, 사람에게 넘기기 전에 실제로 돌려 보는 확인, 검토자가 믿고 승인할 수 있는 장치(바뀐 줄 비교·충돌 검사·감사 기록)가 비어 있습니다. 그래서 아직 "AI로 QA 혁신"의 문턱 앞에 있습니다. 화면 문구와 사용 설명서가 실제 동작보다 앞서 있는 곳도 여러 군데입니다.

2. **개선안 순위**

| 순위 | 개선안 | 무엇이 바뀌나(AI 관점) | 근거 파일 | 영향 | 노력 | 언제 | 기존 계획과 관계 |
|---|---|---|---|---|---|---|---|
| 1 | 게스트 계정의 쓰기를 서버에서 막기: 실행·취소·다시 실행·채팅 POST에 403. 로그아웃·비밀번호·알림 읽음은 예외 | 공개 주소에서 아무나 시연 실행을 취소하거나 LLM 비용을 쓰는 일을 막아, 시연과 AI 비용을 보호한다 | AuthService.java:97, DataLoader.java:116, ProjectAccessInterceptor.java(MEMBER_WRITES), 시연-순서.md:23 | 높음 | S | 시연 전. 11/20 리허설 전에 main 반영 권장 | 신규 |
| 2 | 'AI로 만들기' 경로 검사: tests/ 아래로 강제, validatePaths, startsWith 확인, 이미 있는 파일은 거절. 사용 설명서 FAQ 문구도 정정 | PM 권한으로 API 컨테이너 안 아무 파일이나 쓸 수 있는 구멍을 닫는다. 기존 spec을 덮어쓸 때 위험 평가가 '새 파일'로 잘못 나오는 문제도 함께 사라진다 | AiJobService.java:188(`..`만 검사, 확인함), :252, :507-512, guide/index.html:2506 | 높음 | S | 시연 전 dev 안전 | 신규 |
| 3 | 자가 치유 연결: CODE_FIX의 job.json에 healingContext(검증된 셀렉터)를 넣고, 결과에 siteMapPromptService.check riskFlag를 남긴다. AI 없이 바로 반영하는 경로는 만들지 않는다 | AI가 로그만 보고 셀렉터를 짐작하던 것을, 사이트 지도의 검증된 셀렉터로 고치게 된다. 수정 제안 카드의 "구조 지도에서 찾은 이름표로" 약속이 실제 동작과 맞게 된다 | AiRunnerDockerService.java:52-57, run.js:134-157, AiBootstrapService.java:647, FixProposalRules.java | 높음 | S | 시연 전 dev 안전. 리허설 통과 뒤 main | 계획 보강(E-06) |
| 4 | 기대값만 바꾼 수정을 하드 게이트로 막기: toHaveText 같은 matcher 인자가 바뀌면 assertion_expectation_changed. locator 인자는 비교하지 않는다 | AI가 테스트를 통과시키려고 실제 앱 결함을 조용히 덮는 일을 구조적으로 막는다 | AiDiffRiskEvaluatorService.java, FixProposalRules.PLAN_VALUE, run.js:200-203 | 높음 | S | 시연 전 dev 안전 | 신규 |
| 5 | 실패 원인 추정 배지(테스트 문제/앱 버그/환경/미확정)와 근거 한 줄. 1차는 규칙으로 매핑하고, run.js 응답에 verdict(APP_BUG) 필드를 허용한다. 사람이 고친 값은 ai_classify_feedback에 저장. 결함 수 기준은 시연 뒤에 바꾼다 | AI가 "빨간불 끄는 도구"에서 "실패를 분류하는 QA 동료"로 바뀐다. 사람이 고친 분류는 그대로 학습 데이터가 된다 | DefectService.java:32-35, DefectsTab.tsx:128-129, FixProposalRules, run.js | 높음 | M | 배지와 verdict는 시연 전 dev. 심각도·결함 수 기준·보고서 초안은 시연 후 | 계획 보강(E-05) |
| 6 | 승인 시점 충돌 검사와 진짜 diff. 1단계: base/ 저장, 해시가 다르면 409, approve에 expectedVersion·riskAcknowledged 전달. 2단계: Monaco DiffEditor로 비교, 위험 항목은 체크박스 | 검토자가 몇 초 만에 "맞다"고 판단할 수 있고, 사람이 고친 내용을 AI가 덮어쓰지 않는다. 서버에 있지만 쓰이지 않던 잠금이 실제로 동작한다 | AiReviewTab.tsx:97-148, AiActionCard.tsx:237-248, client.ts:764, AiJobService.java:500-516·585-588, AiJobController.java:139 | 높음 | M | 1단계는 시연 전 dev 안전, 2단계는 시연 후 | 신규 |
| 7 | 생성 직후 실행 확인: runVerifyJob을 한 번 돌려 '실행 확인 통과/실패/못 함' 플래그를 단다. 실패하면 자동 반영을 막는다. 자동 heal 루프는 만들지 않는다 | "한 번도 돌지 않은 AI 코드"가 승인되는 일이 사라진다. 무수정 통과율의 기준선이 riskFlags로 쌓인다 | AiJobService.java:214-293, AiEditAssistService.java:76, AiBootstrapService(heal) | 높음 | S~M | 시연 후 dev(러너 메모리·채팅 지연 확인이 필요) | 계획 보강(2-5, E-06) |
| 8 | 불안정 배지: 최근 10회 안에 통과와 실패가 2번 이상 바뀌면 표시한다. spec이 수정된 시각 이후 결과만 센다. 이렇게 세면 신호가 있을 때 수정 제안 대신 '불안정 의심'을 낸다. '해결 대기'(연속 2회 통과)는 시연 뒤 | 자동화 결과를 믿지 못하게 만드는 1순위 원인을 드러낸다. 불안정한 테스트에 AI 수정이 남발되는 것도 막는다 | DefectService.defectOf(149-180행), TestExecutionService.java:42, PlanService.tracked, demo-reset.sh | 높음 | S | 배지는 시연 전 dev(시연 데이터에서 잘못 뜨지 않는지 확인), 판정 강화와 AI 비교 진단은 시연 후 | 계획 보강(D-05) |
| 9 | 사이트 분석이 문제도 수집: goto 응답이 400 이상이면 노드를 만들지 않고, 같은 origin의 console·pageerror·4xx/5xx를 화면당 최대 20건 기록. URL 쿼리는 지운다 | 테스트를 하나도 쓰기 전에 AI 탐색이 "이미 깨진 것"을 찾아낸다. 404 화면이 지도에 들어가는 문제도 같이 고친다 | analyze.js:304-319, :687 | 중~높음 | S~M | 시연 후. 결과 표시는 warnings 재사용, 배지는 마이그레이션 번호를 정한 뒤 | 신규 |
| 10 | 결함 행 펼침에 기존 FixProposals를 넣고, 수정 제안 카드의 "AI 검토 탭에서 승인" 문구를 해당 작업으로 가는 링크로 바꾼다 | 결함 목록이 그대로 AI 작업 대기열이 된다. 흩어진 AI 진입점이 결함 화면에서 이어진다 | DefectsTab.tsx:13, ResultsTab.tsx:175, FixProposalCard.tsx:76, shellNav.ts:62 | 중 | S | 시연 후(결함 탭은 시연 5·9단계 화면) | 계획 보강(2-4) |
| 11 | AI 승인·거부·진행·닫기·자동 되돌림, 로그인, AI 키 저장, 접근 거부를 감사 로그에 남긴다. 이미 있는 recordAuditEvent 호출만 추가하면 된다 | AI가 파일을 바꾼 이력을 누가·언제·무엇을 기준으로 조회할 수 있게 된다. 학습 저장소의 '사람이 검증한 정답' 근거가 된다 | UserAuditAction.java, UserService(호출처 0곳), AiJobService.java:570-658, AiPostApplyVerificationService.java:215 | 중 | S | 시연 전 dev 안전 | 신규 |
| 12 | AI 검토 대기·자동 되돌림·push 실패를 앱 안 알림으로 보내고, 검토 카드에 사후 검증 배지를 단다. 수동 되돌리기 버튼은 시연 뒤 | 지금은 Slack으로만 가는 조용한 자동화가 앱 안에서 보이게 된다. 되돌려진 변경이 '적용됨'으로 보이는 문제가 사라진다 | NotificationService.java:57-98, AiJobService.java:293·439, AiAnalysisTab(배지 재사용) | 중 | S | 시연 전 dev 안전 | 계획 보강(E-10, E-11) |
| 13 | 이번 차수 결과 보고서 초안 버튼: 숫자는 코드가 계산하고, AI는 해석 3~5줄과 Go/조건부/No-Go 권고를 쓴다. 복사와 브라우저 인쇄로 낸다. 사이클 개념은 넣지 않는다 | QA의 최종 산출물을 AI가 초안으로 쓰고 사람은 검토만 한다. 엑셀·워드로 돌아가는 일이 줄어든다 | ResultsTab.tsx:194, TestRoundService.java:20-25 | 높음 | M | 시연 후. 사이클과 xlsx는 3-2와 함께 | 신규(xlsx는 3-2 보강) |
| 14 | 채팅이 QA 관리 데이터를 보게 하기: list_defects 도구(DefectService 감싸기), ai_ro.plan_items 뷰(AiRoViews.ALL과 테스트 함께 수정), 탭별 예시 질문 칩. 인수인계서의 V21을 V22 이후로 정정 | "기한 지난 항목을 담당자별로", "미해결 결함을 원인별로" 같은 질문에 답하는 QA 관리 동료가 된다 | V7__ai_readonly_views.sql, chat/tools, AiPanel.tsx:904, V21__user_password_change_required.sql | 중~높음 | S~M | 문서 정정은 지금, 나머지는 시연 후 dev | 신규 + 계획 보강(번호 정정) |
| 15 | 주 데이터 오류를 빈 상태나 끝없는 로딩으로 감추지 않기: 작은 ErrorState를 홈·대시보드·계획 탭 3곳에 적용 | 서버 오류인데 "소속 프로젝트 없음"으로 잘못 안내하는 일이 사라진다. 'AI에게 묻기' 버튼은 나중에 붙인다 | HomePage.tsx:97·323, ProjectDashboardTab.tsx:79·100, PlanTab.tsx:64·68·84 | 중 | S | 시연 후(홈·대시보드는 시연 2·3단계 화면) | 신규 |
| 16 | 케이스 ID를 고정 키로. 시연 전에는 승인 diff가 test 제목·경로를 바꾸면 경고하고 AI 프롬프트에 금지 한 줄을 넣는다. 태그 키 매칭은 3-2에서 | AI 수정이 케이스 제목을 바꿔 이력·담당자·미해결 결함 연결을 끊는 일을 막는다 | PlanService.java:29-30·220~, DefectService.defectOf | 중 | S(경고) / M(키) | 경고는 시연 전 dev, 키 설계는 시연 후 | 계획 보강(3-2 TC ID) |

3. **시연(11/24) 전에 할 만한 것 3개**
- **1위 게스트 쓰기 차단**: 시연 1단계에서 청중에게 '게스트로 시작'을 직접 가리키는데, 지금은 그 계정으로 PM의 시연 실행을 취소할 수 있습니다. 서버 한 줄과 통합 테스트 1개로 끝나므로 11/20 리허설 전에 main에 넣어야 합니다.
- **2위 'AI로 만들기' 경로 검사**: `AiJobService.java:188`이 `..`만 검사하는 것을 직접 확인했습니다. 절대 경로를 넣으면 승인할 때 프로젝트 밖 파일을 씁니다. 수정은 몇 줄이고 시연 동선과 겹치지 않습니다. 사용 설명서 FAQ의 "적용 뒤 확인 실행" 문구도 같은 날 고칩니다.
- **3위 자가 치유 연결(healingContext)**: 이미 있는 함수를 CODE_FIX에 넘기기만 하면 됩니다. 수정 제안 카드 문구가 거짓이 아니게 되고, 발표에서 "AI가 사이트 지도를 보고 고친다"고 말할 근거가 생깁니다. 시연 대본은 바꾸지 않고, 리허설이 통과한 뒤에만 main에 반영합니다.
- 함께 하면 좋은 것: 인수인계서의 `V21` 두 곳을 `V22 이후`로 정정하는 일(비용 0). 4위 기대값 게이트도 S라서 여유가 있으면 dev에 넣어도 됩니다.

4. **버린 제안과 이유**
- **변경 기반 회귀 범위 추천**(QA 실무 관점): 사이트맵 전후 차이와 커밋 diff를 화면에 대응시키는 재료가 실제로 없습니다. 노력은 L 이상이고, 시연 프로젝트(example.com, 케이스 5건)에서는 효과를 보여 줄 수 없습니다. 시연 뒤 D-06을 할 때 '영향 케이스 목록'으로 다시 올립니다.
- **변경 영향 기반 선택 실행·선제 치유**(AI 차별화 관점): 해시 비교는 소스 분석 경로에만 있고, 손으로 쓴 spec에는 ScenarioOrigin이 없습니다. 영향 받는 테스트만 돌리면 이런 spec이 소리 없이 빠져서 거짓 안심을 줍니다. 기반으로 삼은 결정적 치유도 기각됐습니다.
- **홈 'AI 브리핑·다음 할 일' 카드**(화면 구조 관점): 3-1 역할별 홈과 거의 겹칩니다. LLM 브리핑은 채울 분류 데이터(E-05)가 아직 없고, 비용·환각 위험을 첫 화면에 들입니다. 대신 3-1 체크리스트에 'AiTaskQueue를 채팅 패널 밖에서 재사용', '/sitemap/coverage로 테스트 없는 화면 N곳 표시' 두 줄만 덧붙입니다.
- **프로젝트 AI 예산 집행·비용 표시·LLM 전송 마스킹**(신뢰·통제 관점): 예산은 설정할 경로가 없고, AiUsage의 jobId·costUsd는 어디서도 채워지지 않습니다. 비밀 값 표시 필드도 없어 과장된 항목입니다. LlmGatewayService.record에 jobId를 넘기는 한 줄만 E-09 안에서 처리합니다.

참고: 근거 파일은 모두 `/Users/junho/Developer/AI-TestOps` 아래에 있습니다. 2위의 경로 검사 구멍은 `/Users/junho/Developer/AI-TestOps/apps/api/src/main/java/com/playops/api/service/AiJobService.java` 188행에서 직접 확인했고, 나머지 근거는 각 관점 비판자의 코드 확인 결과를 따랐습니다.