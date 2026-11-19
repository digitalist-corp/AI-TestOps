# 평가셋

## failure-classify.json — 실패 원인 분류 (E-05)

원인을 아는 Playwright 실패 20건. `expected` 는 원인 5종(`PRODUCT_DEFECT` 제품 결함 · `SCRIPT_ERROR` 스크립트 오류 · `ENVIRONMENT` 환경 · `FLAKY` 불안정 · `UNCLASSIFIED` 미분류), `history` 는 같은 케이스의 이전 상태(최신 먼저).

`FailureClassifyEvalTest` 가 `FailureRules.classify` 로 정확도를 재고 **0.70 미만이면 실패**한다. 틀린 건은 id 와 함께 출력한다.

```bash
# 저장소 루트를 마운트해야 docs/eval 이 보인다 (apps/api 만 마운트하면 이 테스트는 '건너뜀'으로 나온다)
docker run --rm -v "$PWD":/repo -v api-gradle-cache:/home/gradle/.gradle -w /repo/apps/api \
  gradle:8.10.2-jdk21 ./gradlew test --tests '*FailureClassifyEvalTest' --no-daemon --console=plain -i | grep 'eval'
```

주의: 평가셋과 규칙을 같은 사람이 썼다. P5 · F3 처럼 메시지만으로 구분이 어려운 건을 일부러 넣었지만, 실제 프로젝트 실패로 다시 재야 한다.
