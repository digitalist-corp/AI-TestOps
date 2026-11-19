-- 학습 루프(LEARNING_LOOP, E-06)가 띄운 수정 작업을 루프 작업에 잇는다. 자식이 바뀌면 Spring 이 그 루프를 재개한다.
ALTER TABLE ai_jobs ADD COLUMN IF NOT EXISTS parent_job_id BIGINT REFERENCES ai_jobs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ai_jobs_parent ON ai_jobs(parent_job_id);
-- ddl-auto 로 만든 예전 DB 에 enum 값을 고정한 제약이 남아 있으면 LEARNING_LOOP 를 막는다 (V9 와 같은 이유)
ALTER TABLE ai_jobs DROP CONSTRAINT IF EXISTS ai_jobs_job_type_check;
