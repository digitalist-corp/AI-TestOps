# Architecture

## 핵심 개념

- Project: 관리 솔루션에 등록되는 테스트 프로젝트
- Scenario: Playwright spec 파일 또는 spec 그룹
- Execution: 실행 요청 단위
- Worker: Playwright 테스트를 실제 수행하는 컨테이너
- Report: 실행 결과, 스크린샷, trace, video, 로그

## 권장 확장

1. API에서 실행 요청 생성
2. Worker가 큐 또는 DB polling으로 작업 획득
3. Worker가 `/playwright-projects/{projectKey}`에서 소스 확인
4. 의존성 설치 후 `npx playwright test` 실행
5. 결과를 `/storage/reports/{executionId}`에 저장
6. API에 상태/결과 업로드

상세 To-Be 설계는 [tobe-architecture.md](./tobe-architecture.md)를 참고합니다.

AI 기능 연동(자동 코드 수정, 예약 실행, GitHub 연동 등)에 대한 아키텍처는 [ai-integration-architecture.md](./ai-integration-architecture.md)를 참고합니다.

AI 개선 방향(중앙 ai-service · LangGraph AI 루프 · 승인 3곳 · 브랜치 + PR)은 [ai-improvement-plan.md](./ai-improvement-plan.md)를 참고합니다.
