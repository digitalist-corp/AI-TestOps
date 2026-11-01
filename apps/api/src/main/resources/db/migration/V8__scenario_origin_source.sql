-- 구조 탭 확인 지도: 테스트를 만든 방법(녹화 등)을 구분하고, spec 경로별 마지막 실행 결과를 빨리 찾는다.
ALTER TABLE scenario_origin ADD COLUMN IF NOT EXISTS source VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_case_results_spec_exec ON execution_case_results (spec_path, execution_id);
