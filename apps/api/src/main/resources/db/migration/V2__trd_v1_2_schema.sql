-- =====================================================================
-- V2__trd_v1_2_schema.sql
-- TRD v1.2 Supplemental Columns, Indexes, and Operational Tables
-- =====================================================================

-- 1. users supplemental columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- 2. projects supplemental columns (owner, monthly AI budget, optimistic lock version)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_user_id BIGINT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS monthly_ai_budget_usd NUMERIC(18, 8) NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0;

-- 3. executions supplemental columns & indexes
ALTER TABLE executions ADD COLUMN IF NOT EXISTS schedule_id BIGINT;
ALTER TABLE executions ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMP WITH TIME ZONE;
CREATE INDEX IF NOT EXISTS idx_executions_project_created ON executions (project_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_executions_schedule_time ON executions (schedule_id, scheduled_for);

-- 4. execution_case_results supplemental columns
ALTER TABLE execution_case_results ADD COLUMN IF NOT EXISTS attempt_index INTEGER NOT NULL DEFAULT 0;
ALTER TABLE execution_case_results ADD COLUMN IF NOT EXISTS case_index INTEGER NOT NULL DEFAULT 0;

-- 5. test_suites supplemental columns
ALTER TABLE test_suites ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0;

-- 6. execution_schedules supplemental columns
ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS suite_id BIGINT;
ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS case_title VARCHAR(500);
ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS cron_expression VARCHAR(100);
ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Seoul';
ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS run_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS misfire_policy VARCHAR(20) NOT NULL DEFAULT 'FIRE_ONCE';
ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0;

-- 7. ai_jobs supplemental columns & indexes
ALTER TABLE ai_jobs ADD COLUMN IF NOT EXISTS rejection_reason VARCHAR(500);
ALTER TABLE ai_jobs ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_ai_jobs_project_status_created ON ai_jobs (project_id, status, created_at);

-- 8. ai_usage supplemental columns (budget reservation & settlement)
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS job_id BIGINT;
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS request_id VARCHAR(100);
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS input_unit_price NUMERIC(18, 8);
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS output_unit_price NUMERIC(18, 8);
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(18, 8);
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS reserved_usd NUMERIC(18, 8);
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'SUCCEEDED';
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS usage_estimated BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS settled_at TIMESTAMP WITH TIME ZONE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_usage_request_id ON ai_usage (request_id);

-- 9. ai_provider_settings supplemental columns (Bedrock support & optimistic lock)
ALTER TABLE ai_provider_settings ADD COLUMN IF NOT EXISTS claude_transport VARCHAR(30) DEFAULT 'ANTHROPIC';
ALTER TABLE ai_provider_settings ADD COLUMN IF NOT EXISTS bedrock_region VARCHAR(50);
ALTER TABLE ai_provider_settings ADD COLUMN IF NOT EXISTS bedrock_model VARCHAR(200);
ALTER TABLE ai_provider_settings ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0;

-- 10. site_node_edit supplemental columns
ALTER TABLE site_node_edit ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0;

-- 11. board_posts & board_post_comments supplemental columns
ALTER TABLE board_posts ADD COLUMN IF NOT EXISTS deleted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE board_post_comments ADD COLUMN IF NOT EXISTS deleted BOOLEAN NOT NULL DEFAULT FALSE;

-- 12. user_sessions supplemental columns (SHA-256 token_hash, revocation, user_agent)
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS token_hash VARCHAR(64);
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS user_agent VARCHAR(500);
ALTER TABLE user_sessions ALTER COLUMN token DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_sessions_token_hash ON user_sessions (token_hash);

-- 13. user_audit_logs supplemental columns
ALTER TABLE user_audit_logs ADD COLUMN IF NOT EXISTS project_id VARCHAR(100);
ALTER TABLE user_audit_logs ADD COLUMN IF NOT EXISTS resource_type VARCHAR(100);
ALTER TABLE user_audit_logs ADD COLUMN IF NOT EXISTS resource_id VARCHAR(100);
ALTER TABLE user_audit_logs ADD COLUMN IF NOT EXISTS request_id VARCHAR(100);
ALTER TABLE user_audit_logs ADD COLUMN IF NOT EXISTS outcome VARCHAR(20) NOT NULL DEFAULT 'SUCCESS';
ALTER TABLE user_audit_logs ALTER COLUMN action TYPE VARCHAR(50);

-- 14. slack_settings supplemental columns
ALTER TABLE slack_settings ADD COLUMN IF NOT EXISTS project_id VARCHAR(100);
ALTER TABLE slack_settings ADD COLUMN IF NOT EXISTS event_types TEXT;
ALTER TABLE slack_settings ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE slack_settings ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0;

-- 15. Operational Auxiliary Tables (Idempotency-Key & Slack Notification Outbox)
CREATE TABLE IF NOT EXISTS idempotency_records (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    project_id VARCHAR(100) NOT NULL,
    operation_type VARCHAR(50) NOT NULL,
    idempotency_key VARCHAR(120) NOT NULL,
    request_hash VARCHAR(64) NOT NULL,
    response_status INTEGER NOT NULL,
    response_body TEXT,
    resource_id VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT uk_idempotency_scope_key UNIQUE (project_id, operation_type, idempotency_key)
);

CREATE TABLE IF NOT EXISTS notification_outbox (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    dedup_key VARCHAR(200) NOT NULL UNIQUE,
    project_id VARCHAR(100),
    event_type VARCHAR(50) NOT NULL,
    resource_id VARCHAR(100) NOT NULL,
    final_status VARCHAR(30) NOT NULL,
    message TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    retry_count INTEGER NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL
);
