package com.playops.api.chat.tools;

import java.util.List;

/**
 * sql_query 도구가 읽을 수 있는 ai_ro 뷰와 열 목록.
 *
 * 모델이 스키마를 추측하지 않도록 도구 설명에 이 목록을 그대로 넣는다.
 * V7__ai_readonly_views.sql 의 뷰와 반드시 같아야 하고, AiRoViewsMigrationTest 가 둘을 맞춰 본다.
 * 뷰를 바꾸면 새 마이그레이션(V8~)과 이 목록을 함께 고친다.
 */
public final class AiRoViews {

    public static final String SCHEMA = "ai_ro";

    /** @param note 뷰가 무엇인지 한 줄 설명 (도구 설명에 같이 실린다) */
    public record View(String name, String note, List<String> columns) {
        public String qualifiedName() {
            return SCHEMA + "." + name;
        }
    }

    public static final List<View> ALL = List.of(
            new View("projects", "프로젝트 설정", List.of(
                    "project_id", "project_name", "display_order", "server_type", "description", "test_purpose",
                    "manager_name", "node_version", "playwright_version", "package_manager", "install_command",
                    "test_command", "working_directory", "login_env_required", "login_setup_spec_path",
                    "storage_state_max_age_minutes", "timeout", "parallel_limit", "base_url", "repository_url",
                    "repository_branch", "source_repository_url", "source_repository_branch", "runner_lifecycle",
                    "docker_enabled", "docker_status", "ai_model_provider", "ai_auto_apply_enabled",
                    "ai_auto_apply_max_changed_lines", "ai_auto_apply_max_changed_files", "ai_allowed_path_globs",
                    "ai_denied_path_globs", "ai_max_iterations", "owner_user_id", "monthly_ai_budget_usd",
                    "created_at", "updated_at")),
            new View("executions", "테스트 실행 기록", List.of(
                    "id", "project_id", "status", "grep_filter", "spec_path", "case_title", "total_tests",
                    "passed_tests", "failed_tests", "skipped_tests", "duration_ms", "source", "sequential",
                    "error_message", "started_at", "finished_at", "created_at", "schedule_id", "scheduled_for")),
            new View("execution_case_results", "실행 안의 케이스별 결과", List.of(
                    "id", "project_id", "execution_id", "spec_path", "case_title", "status", "duration_ms",
                    "error_message", "attempt_index", "case_index", "created_at")),
            new View("test_suites", "테스트 묶음", List.of(
                    "id", "project_id", "name", "spec_paths", "grep", "case_count", "sequential", "created_by",
                    "created_at", "updated_at")),
            new View("execution_schedules", "예약 실행", List.of(
                    "id", "project_id", "name", "suite_id", "spec_path", "case_title", "hour", "minute",
                    "days_of_week", "cron_expression", "timezone", "run_at", "next_run_at", "enabled",
                    "misfire_policy", "last_triggered_at", "created_by", "created_at", "updated_at")),
            new View("ai_jobs", "AI 작업(수정 · 생성 요청)", List.of(
                    "id", "project_id", "job_type", "status", "ai_model_provider", "instruction",
                    "target_spec_path", "route_keys", "failed_execution_id", "iterations_used", "changed_files",
                    "summary", "risk_flags", "error_message", "requested_by", "reviewed_by", "rejection_reason",
                    "applied_commit_sha", "post_apply_verification_status", "post_apply_verification_execution_id",
                    "reverted_at", "revert_commit", "created_at", "updated_at")),
            new View("ai_usage", "AI 호출 사용량과 비용", List.of(
                    "id", "provider", "feature", "project_id", "job_id", "request_id", "model", "input_tokens",
                    "output_tokens", "input_unit_price", "output_unit_price", "cost_usd", "reserved_usd", "status",
                    "usage_estimated", "succeeded", "duration_ms", "created_at", "settled_at")),
            new View("site_node", "분석으로 찾은 화면(경로)", List.of(
                    "id", "project_id", "route_key", "title", "source_file", "origin", "auth_required",
                    "first_seen_commit", "last_seen_commit", "stale", "url")),
            new View("site_edge", "화면 사이의 이동 연결", List.of(
                    "id", "project_id", "from_route_key", "to_route_key", "kind", "label", "selector",
                    "source_file", "source_line")),
            new View("notifications", "알림", List.of(
                    "id", "user_id", "kind", "level", "title", "message", "link", "project_id", "created_at"))
    );

    private AiRoViews() {
    }

    /** 도구 설명에 붙일 뷰 · 열 목록. */
    public static String describe() {
        StringBuilder sb = new StringBuilder();
        for (View view : ALL) {
            sb.append("- ").append(view.qualifiedName()).append(" (").append(view.note()).append("): ")
              .append(String.join(", ", view.columns())).append('\n');
        }
        return sb.toString().stripTrailing();
    }
}
