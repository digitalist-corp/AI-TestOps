-- =====================================================================
-- V7__ai_readonly_views.sql
-- AI 채팅의 sql_query 도구가 읽을 "안전한 뷰" 모음.
--
-- 원칙
--  1. AI 는 ai_ro 스키마의 뷰만 읽는다. public 의 실제 테이블에는 손도 못 댄다.
--  2. 뷰에는 비밀(비밀번호 · 토큰 · 키 · 암호화 값 · 해시 · 개인 연락처)이 든 열을 넣지 않는다.
--  3. 모든 뷰는 app.project_id (대화 중인 프로젝트) 의 행만 보여준다. 관리자(app.is_admin = 'true')만 전부 본다.
--  4. 이 설정(app.*)은 앱이 AI 쿼리를 돌리기 전에 set_config 로 넣는다.
--     AI 쿼리 안에서 설정을 바꾸면 범위가 뚫리므로, ai_readonly 가 된 뒤에는 set_config 를 못 쓰게 막는다.
--
-- 뷰의 열 목록은 코드의 AiRoViews 상수와 같아야 한다 (AiRoViewsMigrationTest 가 확인한다).
-- 뷰를 바꿀 때는 이 파일이 아니라 새 마이그레이션(V8~)에서 CREATE OR REPLACE 로 바꾼다.
-- =====================================================================

-- 1. 읽기 전용 역할 (로그인 불가). 역할은 DB 서버 전체에서 하나라 이미 있으면 넘어간다.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_readonly') THEN
        CREATE ROLE ai_readonly NOLOGIN;
    END IF;
END
$$;

-- 앱 계정이 SET LOCAL ROLE ai_readonly 로 이 역할이 될 수 있어야 한다.
GRANT ai_readonly TO CURRENT_USER;

CREATE SCHEMA IF NOT EXISTS ai_ro;

-- 2. 뷰. 뷰는 만든 사람(앱 계정)의 권한으로 public 테이블을 읽으므로 ai_readonly 에는 테이블 권한이 필요 없다.
--    security_barrier: AI 가 쓴 함수나 조건이 프로젝트 필터보다 먼저 행을 만지지 못하게 한다.

CREATE OR REPLACE VIEW ai_ro.projects WITH (security_barrier) AS
SELECT
    p.project_id,
    p.project_name,
    p.display_order,
    p.server_type,
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

CREATE OR REPLACE VIEW ai_ro.executions WITH (security_barrier) AS
SELECT
    e.id,
    e.project_id,
    e.status,
    e.grep_filter,
    e.spec_path,
    e.case_title,
    e.total_tests,
    e.passed_tests,
    e.failed_tests,
    e.skipped_tests,
    e.duration_ms,
    e.source,
    e.sequential,
    e.error_message,
    e.started_at,
    e.finished_at,
    e.created_at,
    e.schedule_id,
    e.scheduled_for
FROM public.executions e
WHERE (e.project_id = current_setting('app.project_id', true) OR current_setting('app.is_admin', true) = 'true');

-- execution_case_results 에는 project_id 가 없어서 부모 실행과 이어 프로젝트를 거른다.
CREATE OR REPLACE VIEW ai_ro.execution_case_results WITH (security_barrier) AS
SELECT
    r.id,
    e.project_id,
    r.execution_id,
    r.spec_path,
    r.case_title,
    r.status,
    r.duration_ms,
    r.error_message,
    r.attempt_index,
    r.case_index,
    r.created_at
FROM public.execution_case_results r
JOIN public.executions e ON e.id = r.execution_id
WHERE (e.project_id = current_setting('app.project_id', true) OR current_setting('app.is_admin', true) = 'true');

CREATE OR REPLACE VIEW ai_ro.test_suites WITH (security_barrier) AS
SELECT
    s.id,
    s.project_id,
    s.name,
    s.spec_paths,
    s.grep,
    s.case_count,
    s.sequential,
    s.created_by,
    s.created_at,
    s.updated_at
FROM public.test_suites s
WHERE (s.project_id = current_setting('app.project_id', true) OR current_setting('app.is_admin', true) = 'true');

CREATE OR REPLACE VIEW ai_ro.execution_schedules WITH (security_barrier) AS
SELECT
    s.id,
    s.project_id,
    s.name,
    s.suite_id,
    s.spec_path,
    s.case_title,
    s.hour,
    s.minute,
    s.days_of_week,
    s.cron_expression,
    s.timezone,
    s.run_at,
    s.next_run_at,
    s.enabled,
    s.misfire_policy,
    s.last_triggered_at,
    s.created_by,
    s.created_at,
    s.updated_at
FROM public.execution_schedules s
WHERE (s.project_id = current_setting('app.project_id', true) OR current_setting('app.is_admin', true) = 'true');

CREATE OR REPLACE VIEW ai_ro.ai_jobs WITH (security_barrier) AS
SELECT
    j.id,
    j.project_id,
    j.job_type,
    j.status,
    j.ai_model_provider,
    j.instruction,
    j.target_spec_path,
    j.route_keys,
    j.failed_execution_id,
    j.iterations_used,
    j.changed_files,
    j.summary,
    j.risk_flags,
    j.error_message,
    j.requested_by,
    j.reviewed_by,
    j.rejection_reason,
    j.applied_commit_sha,
    j.post_apply_verification_status,
    j.post_apply_verification_execution_id,
    j.reverted_at,
    j.revert_commit,
    j.created_at,
    j.updated_at
FROM public.ai_jobs j
WHERE (j.project_id = current_setting('app.project_id', true) OR current_setting('app.is_admin', true) = 'true');

-- project_id 가 비어 있는 사용량(프로젝트와 무관한 호출)은 관리자만 본다.
CREATE OR REPLACE VIEW ai_ro.ai_usage WITH (security_barrier) AS
SELECT
    u.id,
    u.provider,
    u.feature,
    u.project_id,
    u.job_id,
    u.request_id,
    u.model,
    u.input_tokens,
    u.output_tokens,
    u.input_unit_price,
    u.output_unit_price,
    u.cost_usd,
    u.reserved_usd,
    u.status,
    u.usage_estimated,
    u.succeeded,
    u.duration_ms,
    u.created_at,
    u.settled_at
FROM public.ai_usage u
WHERE (u.project_id = current_setting('app.project_id', true) OR current_setting('app.is_admin', true) = 'true');

-- 화면 요소 · 링크 · 접근성 트리 같은 큰 본문(elements, links, forms, aria_snapshot)은 get_sitemap 도구로 본다.
CREATE OR REPLACE VIEW ai_ro.site_node WITH (security_barrier) AS
SELECT
    n.id,
    n.project_id,
    n.route_key,
    n.title,
    n.source_file,
    n.origin,
    n.auth_required,
    n.first_seen_commit,
    n.last_seen_commit,
    n.stale,
    n.url
FROM public.site_node n
WHERE (n.project_id = current_setting('app.project_id', true) OR current_setting('app.is_admin', true) = 'true');

CREATE OR REPLACE VIEW ai_ro.site_edge WITH (security_barrier) AS
SELECT
    g.id,
    g.project_id,
    g.from_route_key,
    g.to_route_key,
    g.kind,
    g.label,
    g.selector,
    g.source_file,
    g.source_line
FROM public.site_edge g
WHERE (g.project_id = current_setting('app.project_id', true) OR current_setting('app.is_admin', true) = 'true');

-- 알림은 사용자마다 한 줄씩이지만 프로젝트 기준으로만 거른다. project_id 가 없는 알림은 관리자만 본다.
CREATE OR REPLACE VIEW ai_ro.notifications WITH (security_barrier) AS
SELECT
    t.id,
    t.user_id,
    t.kind,
    t.level,
    t.title,
    t.message,
    t.link,
    t.project_id,
    t.created_at
FROM public.notifications t
WHERE (t.project_id = current_setting('app.project_id', true) OR current_setting('app.is_admin', true) = 'true');

-- 3. 권한: 스키마를 쓰고 뷰를 읽는 것만 허용한다.
GRANT USAGE ON SCHEMA ai_ro TO ai_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA ai_ro TO ai_readonly;

-- 4. 범위 설정을 AI 쿼리가 바꾸지 못하게 한다.
--    set_config 는 기본으로 모두(PUBLIC)가 쓸 수 있다. AI 가 SELECT set_config('app.is_admin','true',true) 를
--    부르면 다른 프로젝트까지 보이고, set_config('role', ...) 로는 아예 역할을 되돌릴 수도 있다.
--    앱 코드는 AI 쿼리 전에 앱 계정으로 set_config 를 쓰므로 앱 계정에는 남겨 둔다.
REVOKE EXECUTE ON FUNCTION pg_catalog.set_config(text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pg_catalog.set_config(text, text, boolean) TO CURRENT_USER;

-- 5. 위 방어가 실제로 먹혔는지 확인한다.
--    set_config 는 DB 의 기본 계정(슈퍼유저)이 만든 함수라, 앱 계정이 슈퍼유저가 아니면 REVOKE 가 조용히 무시될 수 있다.
--    그래도 마이그레이션이 멈추면 서비스 전체가 못 뜨므로 경고만 남긴다.
--    (sql_query 도구도 실행 때마다 같은 확인을 하고, 막히지 않았으면 쿼리를 돌리지 않는다.)
DO $$
DECLARE
    protected_table text;
BEGIN
    IF has_function_privilege('ai_readonly', 'pg_catalog.set_config(text, text, boolean)', 'EXECUTE') THEN
        RAISE WARNING 'ai_readonly 가 아직 set_config 를 쓸 수 있습니다. 앱 계정이 pg_catalog.set_config 의 소유자(슈퍼유저)인지 확인하세요. sql_query 도구는 이 상태에서 쿼리를 거절합니다.';
    END IF;

    FOREACH protected_table IN ARRAY ARRAY['users', 'user_sessions', 'ai_provider_settings', 'slack_settings']
    LOOP
        IF has_table_privilege('ai_readonly', 'public.' || protected_table, 'SELECT') THEN
            RAISE WARNING 'ai_readonly 가 public.% 를 읽을 수 있습니다. 권한을 확인하세요.', protected_table;
        END IF;
    END LOOP;
END
$$;
