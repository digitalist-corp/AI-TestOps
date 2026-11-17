-- 수정자 · 수정일 공통 기록(#118). 새 칸은 모두 사용자 id(BIGINT), 기존 행은 비워 둔다.
-- 사람이 고치는 테이블은 created_* · updated_* 를, 한 번 쓰고 결과만 채우는 실행(executions)은 created_by 만 둔다.
-- 값은 JPA 감사(CurrentUserAuditor)가 요청한 사용자로 채우고, 스케줄러 · 러너 콜백처럼 사용자가 없으면 비운다.
-- board_posts 의 VARCHAR created_by · updated_by 는 그대로 둔다.
ALTER TABLE projects ADD COLUMN created_by BIGINT;
ALTER TABLE projects ADD COLUMN updated_by BIGINT;

ALTER TABLE scenario_case_settings ADD COLUMN created_by BIGINT;
ALTER TABLE scenario_case_settings ADD COLUMN created_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE scenario_case_settings ADD COLUMN updated_by BIGINT;

ALTER TABLE test_suites ADD COLUMN updated_by BIGINT;
ALTER TABLE execution_schedules ADD COLUMN updated_by BIGINT;

ALTER TABLE site_node_edit ADD COLUMN created_by BIGINT;
ALTER TABLE site_node_edit ADD COLUMN created_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE site_node_edit ADD COLUMN updated_by BIGINT;
ALTER TABLE site_node_edit ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE ai_provider_settings ADD COLUMN updated_by BIGINT;
ALTER TABLE slack_settings ADD COLUMN updated_by BIGINT;

ALTER TABLE executions ADD COLUMN created_by BIGINT;
