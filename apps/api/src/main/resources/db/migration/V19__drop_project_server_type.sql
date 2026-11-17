-- 환경(server_type: 개발 · 테스트 · 운영) 칸 삭제(#120). 프로젝트는 상태(V16: 계획 · 실행 · 종료)로 구분한다.
-- ai_ro.projects 뷰(V7)가 이 칸을 읽어 먼저 뷰를 다시 만든다. 열 빼기는 CREATE OR REPLACE 로 안 되므로 지우고 만든다.
-- 다시 만들면서 상태 · 기간을 넣는다 (AiRoViews 와 같은 순서).
DROP VIEW ai_ro.projects;

CREATE OR REPLACE VIEW ai_ro.projects WITH (security_barrier) AS
SELECT
    p.project_id,
    p.project_name,
    p.display_order,
    p.status,
    p.start_date,
    p.end_date,
    p.description,
    p.test_purpose,
    p.manager_name,
    p.node_version,
    p.playwright_version,
    p.package_manager,
    p.install_command,
    p.test_command,
    p.working_directory,
    p.login_env_required,
    p.login_setup_spec_path,
    p.storage_state_max_age_minutes,
    p.timeout,
    p.parallel_limit,
    p.base_url,
    -- 주소에 user:token@ 가 박혀 있어도 새지 않게 계정 부분을 지운다.
    regexp_replace(p.repository_url, '^([A-Za-z][A-Za-z0-9+.-]*://)[^/@]*@', '\1') AS repository_url,
    p.repository_branch,
    regexp_replace(p.source_repository_url, '^([A-Za-z][A-Za-z0-9+.-]*://)[^/@]*@', '\1') AS source_repository_url,
    p.source_repository_branch,
    p.runner_lifecycle,
    p.docker_enabled,
    p.docker_status,
    p.ai_model_provider,
    p.ai_auto_apply_enabled,
    p.ai_auto_apply_max_changed_lines,
    p.ai_auto_apply_max_changed_files,
    p.ai_allowed_path_globs,
    p.ai_denied_path_globs,
    p.ai_max_iterations,
    p.owner_user_id,
    p.monthly_ai_budget_usd,
    p.created_at,
    p.updated_at
FROM public.projects p
WHERE (p.project_id = current_setting('app.project_id', true) OR current_setting('app.is_admin', true) = 'true');

GRANT SELECT ON ai_ro.projects TO ai_readonly;

ALTER TABLE projects DROP COLUMN server_type;
