-- 수정 제안(FR-25)으로 ai_jobs.status 에 PROPOSED 가 생겼다.
-- hibernate ddl-auto=update 로 만든 기존 DB 에는 enum 값을 고정한 ai_jobs_status_check 가 남아 있어 새 값을 막는다.
-- Flyway 기준선(V1)에는 이 제약이 없으므로 지워서 두 DB 를 같게 맞춘다. 허용 값은 AiJobStatus enum 이 정한다.
ALTER TABLE ai_jobs DROP CONSTRAINT IF EXISTS ai_jobs_status_check;
