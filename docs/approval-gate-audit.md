# 승인 게이트 전수 확인 (D-03)

2026-11-06 코드 기준. 목표는 "AI가 만든 변경이 사람 승인 없이 프로젝트 파일에 반영되는 길이 0개"인지 확인하는 것이다.

## 프로젝트 파일을 바꾸는 길

| 호출 위치 | 누가 | 판정 |
|---|---|---|
| `AiJobService.approve` → `applyDiff` | 사람이 AI 검토에서 승인 | 게이트 그 자체 |
| `AiJobService` CODE_FIX·시나리오 생성 결과 처리 → `applyDiff` | 자동 적용 | `canAutoApply` 를 통과할 때만. 아래 1번 참고 |
| `AiPostApplyVerificationService` 되돌림 | 시스템 | 반영 이전 상태로 돌리는 것이라 대상 아님 |
| `ProjectWorkspaceController` 저장 | 사람이 에디터에서 저장 | 대상 아님. AI 수정 도움 결과도 사람이 저장해야 들어간다 |
| `ProjectFileController` 업로드 | 사람 | 대상 아님 |
| `RecorderService.save` | 사람이 녹화한 테스트 | 대상 아님 |
| 템플릿·스캐폴드 (`PlaywrightTemplateService`) | 사람이 프로젝트 생성 | AI 아님 |
| `AiBootstrapService` (`tests/bootstrap.spec.ts`) | 사람이 시작한 AI 첫 테스트 | **문서화된 예외.** 등록 직후 초기 소스라 스캐폴드와 같게 본다 |
| 채팅 도구 `FixTestTool`, `GenerateScenarioTool` | AI 채팅 | 작업만 만든다. 파일을 직접 쓰는 도구는 없다 |
| AI 러너 컨테이너 (`ai-runner/run.js`) | AI | 아래 2번 참고 |

## 발견하고 고친 것

1. **자동 생성 작업도 자동 적용될 수 있었다.**
   - 문제: 프로젝트에서 자동 적용(`aiAutoApplyEnabled`)을 켜 두면, 실패에서 자동으로 만든 수정 제안(FR-25)을 사람이 "진행"만 눌러도 결과 diff를 보지 않은 채 반영될 수 있었다.
   - 수정: `ai_jobs.auto_created` 를 추가했다(V10). 자동 적용 판단은 `AiJobService.canAutoApply` 하나로 모았고, 자동 생성 작업은 이 판단에서 항상 거절되어 사람 검토를 거친다.
   - 같이 바꾼 것: 수정 제안의 하루 상한도 이 표시로 센다. 진행한 제안도 상한에 계속 잡힌다.

2. **AI 러너가 실제 프로젝트 파일을 고친 뒤 되돌리고 있었다.**
   - 문제: CODE_FIX와 AI 수정 도움 검증은 공유 볼륨의 실제 파일을 고치고 테스트를 돌린 뒤 `finally` 에서 원본으로 복원했다. 컨테이너가 중간에 죽으면(메모리 부족, 강제 종료) 복원이 돌지 않아 승인 안 된 AI 수정이 그대로 남았다. 실행 중에 다른 테스트 실행이 반쯤 고친 파일을 볼 수도 있었다.
   - 수정: 러너는 이제 프로젝트를 컨테이너 안 임시 폴더로 복사해 그 사본만 고친다. `node_modules` 는 링크로 연결한다. 실제 파일은 `applyDiff` 에서만 바뀐다.

## 테스트로 지키는 것

- `ApprovalGateInventoryTest`
  - `applyDiff` 는 `AiJobService` 에서만 호출되고, 자동 적용 호출 두 곳은 모두 `canAutoApply` 안에 있다.
  - 프로젝트 파일을 쓰는 호출자는 위 표의 네 곳뿐이다. 새로 생기면 테스트가 깨지므로, 확인한 뒤 목록에 넣는다.
- `AiJobAutoApplyTest`
  - 자동 생성 작업은 자동 적용되지 않는다.
  - 사람이 요청한 작업도 자동 적용이 켜져 있고 위험 표시가 없을 때만 자동 적용된다.
  - 자동 적용은 기본으로 꺼져 있다.
- `AiJobProposalTest`
  - 제안을 진행해도 PENDING이 되어 기존 수정 흐름을 탈 뿐, 반영되지 않는다.
  - 이미 진행했거나 닫은 제안은 다시 처리할 수 없다(409).

## 남은 것 (이번 범위 밖)

- `GitCommitService` 는 반영할 때 현재 브랜치에 바로 커밋하고 push한다. "main 직접 반영 금지"는 6주차 E-08(`ai/{jobId}` 브랜치 + PR)에서 다룬다.
- `AiBootstrapService` 는 `tests/bootstrap.spec.ts` 가 이미 있으면 덮어쓴다. 사람이 고친 파일일 수 있으니, 덮어쓰기 전에 확인을 받는 방안을 따로 검토한다.
