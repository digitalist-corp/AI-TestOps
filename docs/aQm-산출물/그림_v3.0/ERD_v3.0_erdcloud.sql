-- AI-TestOps 데이터베이스 (ERDCloud 가져오기용, MySQL 문법)
-- 기준: 개발 DB 스키마 (Flyway V1 ~ V11, 2026-11-17). 실제 DB는 PostgreSQL 16 이다.
-- 게시판 FK 2건을 뺀 FOREIGN KEY 는 코드에서 지키는 논리 관계이며, 관계선을 그리기 위해 적었다.
-- 화면(site_node)과 전환 · 편집 · 출처는 (project_id, route_key) 로 이어지며 여기서는 프로젝트 관계만 표시한다.
-- V12(재실행 연결)는 아직 적용 전이라 포함하지 않았다.

CREATE TABLE `projects` (
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `ai_allowed_path_globs` TEXT COMMENT 'AI 수정 허용 경로',
  `ai_auto_apply_enabled` BOOLEAN COMMENT 'AI 자동 반영',
  `ai_auto_apply_max_changed_files` INT COMMENT 'ai_auto_apply_max_changed_files',
  `ai_auto_apply_max_changed_lines` INT COMMENT 'ai_auto_apply_max_changed_lines',
  `ai_denied_path_globs` TEXT COMMENT 'ai_denied_path_globs',
  `ai_max_iterations` INT COMMENT 'ai_max_iterations',
  `ai_model_provider` VARCHAR(20) COMMENT 'ai_model_provider',
  `base_url` VARCHAR(500) COMMENT '대상 사이트 주소',
  `description` TEXT COMMENT '설명',
  `display_order` INT COMMENT 'display_order',
  `docker_container_id` VARCHAR(100) COMMENT 'docker_container_id',
  `docker_enabled` BOOLEAN COMMENT 'docker_enabled',
  `docker_status` VARCHAR(20) COMMENT '러너 상태',
  `env_variables` TEXT COMMENT '환경 변수',
  `install_command` VARCHAR(500) COMMENT 'install_command',
  `login_env_required` BOOLEAN COMMENT 'login_env_required',
  `login_setup_spec_path` VARCHAR(500) COMMENT 'login_setup_spec_path',
  `manager_contact` VARCHAR(200) COMMENT 'manager_contact',
  `manager_name` VARCHAR(100) COMMENT 'manager_name',
  `node_version` VARCHAR(20) COMMENT 'node_version',
  `package_manager` VARCHAR(10) COMMENT 'package_manager',
  `parallel_limit` INT COMMENT 'parallel_limit',
  `playwright_version` VARCHAR(20) COMMENT 'playwright_version',
  `project_name` VARCHAR(200) NOT NULL COMMENT '프로젝트 이름',
  `repository_branch` VARCHAR(100) COMMENT 'repository_branch',
  `repository_token_encrypted` TEXT COMMENT 'repository_token_encrypted',
  `repository_url` VARCHAR(500) COMMENT '테스트 코드 저장소',
  `runner_lifecycle` VARCHAR(20) COMMENT '러너 생명주기',
  `server_type` VARCHAR(20) COMMENT 'server_type',
  `storage_state_max_age_minutes` INT COMMENT 'storage_state_max_age_minutes',
  `test_command` VARCHAR(500) COMMENT '실행 명령',
  `test_purpose` TEXT COMMENT 'test_purpose',
  `timeout` INT COMMENT 'timeout',
  `working_directory` VARCHAR(500) COMMENT 'working_directory',
  `source_repository_branch` VARCHAR(100) COMMENT '앱 소스 브랜치',
  `source_repository_token_encrypted` TEXT COMMENT '앱 소스 토큰(암호화)',
  `source_repository_url` VARCHAR(500) COMMENT '앱 소스 저장소',
  `owner_user_id` BIGINT COMMENT '소유자',
  `monthly_ai_budget_usd` DECIMAL(18,8) NOT NULL COMMENT 'monthly_ai_budget_usd',
  `version` BIGINT NOT NULL COMMENT 'version',
  `created_at` DATETIME NOT NULL COMMENT '생성 일시',
  `updated_at` DATETIME NOT NULL COMMENT '수정 일시',
  PRIMARY KEY (`project_id`)
) COMMENT='프로젝트';

CREATE TABLE `scenario_case_settings` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `enabled` BOOLEAN NOT NULL COMMENT '사용 여부',
  `grep_filter` VARCHAR(500) NOT NULL COMMENT '케이스 키(grep)',
  `node_type` VARCHAR(20) NOT NULL COMMENT '단위 (SPEC/DESCRIBE/TEST)',
  `spec_path` VARCHAR(500) NOT NULL COMMENT 'spec 경로',
  `sort_order` INT COMMENT '순서',
  `assignee` VARCHAR(100) COMMENT '담당자',
  `due_date` DATE COMMENT '마감일',
  `priority` VARCHAR(10) COMMENT '우선순위 (HIGH/MEDIUM/LOW)',
  `updated_at` DATETIME NOT NULL COMMENT '수정 일시',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_scenario_case_settings_key` (`project_id`, `node_type`, `spec_path`, `grep_filter`),
  CONSTRAINT `fk_scenario_case_settings_project_id` FOREIGN KEY (`project_id`) REFERENCES `projects` (`project_id`)
) COMMENT='계획 항목 (사용 여부 · 순서 · 담당자 · 마감일 · 우선순위)';

CREATE TABLE `test_suites` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `case_count` INT COMMENT 'case_count',
  `grep` TEXT COMMENT 'grep',
  `name` VARCHAR(200) NOT NULL COMMENT '이름',
  `sequential` BOOLEAN NOT NULL COMMENT 'sequential',
  `spec_paths` TEXT COMMENT 'spec_paths',
  `version` BIGINT NOT NULL COMMENT 'version',
  `created_by` BIGINT COMMENT '작성자',
  `created_at` DATETIME NOT NULL COMMENT '생성 일시',
  `updated_at` DATETIME NOT NULL COMMENT '수정 일시',
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_test_suites_project_id` FOREIGN KEY (`project_id`) REFERENCES `projects` (`project_id`)
) COMMENT='테스트 스위트';

CREATE TABLE `execution_schedules` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `suite_id` BIGINT COMMENT '스위트 ID',
  `days_of_week` VARCHAR(50) NOT NULL COMMENT 'days_of_week',
  `enabled` BOOLEAN NOT NULL COMMENT '사용 여부',
  `hour` INT NOT NULL COMMENT 'hour',
  `last_triggered_at` DATETIME COMMENT 'last_triggered_at',
  `minute` INT NOT NULL COMMENT 'minute',
  `name` VARCHAR(200) COMMENT '이름',
  `spec_path` VARCHAR(500) COMMENT 'spec 경로',
  `case_title` VARCHAR(500) COMMENT 'case_title',
  `cron_expression` VARCHAR(100) COMMENT 'cron 식',
  `timezone` VARCHAR(64) NOT NULL COMMENT 'timezone',
  `run_at` DATETIME COMMENT 'run_at',
  `next_run_at` DATETIME COMMENT 'next_run_at',
  `misfire_policy` VARCHAR(20) NOT NULL COMMENT 'misfire_policy',
  `version` BIGINT NOT NULL COMMENT 'version',
  `created_by` BIGINT COMMENT '작성자',
  `created_at` DATETIME NOT NULL COMMENT '생성 일시',
  `updated_at` DATETIME NOT NULL COMMENT '수정 일시',
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_execution_schedules_project_id` FOREIGN KEY (`project_id`) REFERENCES `projects` (`project_id`),
  CONSTRAINT `fk_execution_schedules_suite_id` FOREIGN KEY (`suite_id`) REFERENCES `test_suites` (`id`)
) COMMENT='예약 실행';

CREATE TABLE `executions` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `schedule_id` BIGINT COMMENT '예약 ID',
  `case_title` VARCHAR(500) COMMENT '실행 케이스',
  `duration_ms` BIGINT COMMENT '소요 시간(ms)',
  `error_message` TEXT COMMENT '오류 메시지',
  `failed_tests` INT COMMENT '실패 수',
  `finished_at` DATETIME COMMENT '종료 일시',
  `grep_filter` VARCHAR(500) COMMENT '필터',
  `log_output` TEXT COMMENT '실행 로그',
  `passed_tests` INT COMMENT '성공 수',
  `report_path` VARCHAR(500) COMMENT '리포트 경로',
  `sequential` BOOLEAN NOT NULL COMMENT 'sequential',
  `skipped_tests` INT COMMENT '건너뜀 수',
  `source` VARCHAR(30) COMMENT '실행 출처',
  `spec_path` VARCHAR(500) COMMENT 'spec 경로',
  `started_at` DATETIME COMMENT '시작 일시',
  `status` VARCHAR(20) NOT NULL COMMENT '상태',
  `total_tests` INT COMMENT '전체 수',
  `scheduled_for` DATETIME COMMENT 'scheduled_for',
  `created_at` DATETIME NOT NULL COMMENT '생성 일시',
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_executions_project_id` FOREIGN KEY (`project_id`) REFERENCES `projects` (`project_id`),
  CONSTRAINT `fk_executions_schedule_id` FOREIGN KEY (`schedule_id`) REFERENCES `execution_schedules` (`id`)
) COMMENT='테스트 실행 이력 (N차 테스트)';

CREATE TABLE `execution_case_results` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `execution_id` BIGINT NOT NULL COMMENT '실행 ID',
  `case_title` TEXT COMMENT '케이스 제목',
  `duration_ms` INT COMMENT '소요 시간(ms)',
  `error_message` TEXT COMMENT '오류 메시지',
  `spec_path` VARCHAR(500) COMMENT 'spec 경로',
  `status` VARCHAR(20) NOT NULL COMMENT '상태',
  `attempt_index` INT NOT NULL COMMENT 'attempt_index',
  `case_index` INT NOT NULL COMMENT 'case_index',
  `created_at` DATETIME NOT NULL COMMENT '생성 일시',
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_execution_case_results_execution_id` FOREIGN KEY (`execution_id`) REFERENCES `executions` (`id`)
) COMMENT='케이스별 결과';

CREATE TABLE `ai_jobs` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `failed_execution_id` BIGINT COMMENT '실패한 실행',
  `post_apply_verification_execution_id` BIGINT COMMENT '반영 후 검증 실행',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `ai_model_provider` VARCHAR(20) NOT NULL COMMENT 'LLM 공급자',
  `applied_commit_sha` VARCHAR(100) COMMENT '반영 커밋',
  `callback_token` VARCHAR(100) COMMENT 'callback_token',
  `callback_token_expires_at` DATETIME COMMENT 'callback_token_expires_at',
  `changed_files` TEXT COMMENT '바뀐 파일',
  `diff_path` VARCHAR(500) COMMENT 'diff_path',
  `error_message` TEXT COMMENT '오류 메시지',
  `instruction` TEXT COMMENT '요청 문장',
  `iterations_used` INT COMMENT 'iterations_used',
  `job_type` VARCHAR(30) NOT NULL COMMENT '작업 종류',
  `post_apply_verification_status` VARCHAR(20) COMMENT '반영 후 검증',
  `requested_by` BIGINT COMMENT '요청자',
  `revert_commit` VARCHAR(100) COMMENT 'revert_commit',
  `reverted_at` DATETIME COMMENT 'reverted_at',
  `reviewed_by` BIGINT COMMENT '승인자',
  `risk_flags` TEXT COMMENT '주의 표시',
  `status` VARCHAR(20) NOT NULL COMMENT '상태',
  `summary` TEXT COMMENT 'summary',
  `target_spec_path` VARCHAR(500) COMMENT '대상 spec',
  `route_keys` TEXT COMMENT '화면 경로 목록',
  `rejection_reason` VARCHAR(500) COMMENT 'rejection_reason',
  `version` BIGINT NOT NULL COMMENT 'version',
  `auto_created` BOOLEAN NOT NULL COMMENT 'AI 선제 작업(AI Task)',
  `created_at` DATETIME NOT NULL COMMENT '생성 일시',
  `updated_at` DATETIME NOT NULL COMMENT '수정 일시',
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_ai_jobs_project_id` FOREIGN KEY (`project_id`) REFERENCES `projects` (`project_id`),
  CONSTRAINT `fk_ai_jobs_failed_execution_id` FOREIGN KEY (`failed_execution_id`) REFERENCES `executions` (`id`),
  CONSTRAINT `fk_ai_jobs_post_apply_verification_execution_id` FOREIGN KEY (`post_apply_verification_execution_id`) REFERENCES `executions` (`id`)
) COMMENT='AI 작업';

CREATE TABLE `ai_usage` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `project_id` VARCHAR(100) COMMENT '프로젝트 ID',
  `job_id` BIGINT COMMENT 'AI 작업 ID',
  `duration_ms` BIGINT NOT NULL COMMENT 'duration_ms',
  `feature` VARCHAR(40) COMMENT 'feature',
  `input_tokens` INT NOT NULL COMMENT 'input_tokens',
  `model` VARCHAR(200) COMMENT 'model',
  `output_tokens` INT NOT NULL COMMENT 'output_tokens',
  `provider` VARCHAR(16) NOT NULL COMMENT 'provider',
  `succeeded` BOOLEAN NOT NULL COMMENT 'succeeded',
  `request_id` VARCHAR(100) COMMENT 'request_id',
  `input_unit_price` DECIMAL(18,8) COMMENT 'input_unit_price',
  `output_unit_price` DECIMAL(18,8) COMMENT 'output_unit_price',
  `cost_usd` DECIMAL(18,8) COMMENT 'cost_usd',
  `reserved_usd` DECIMAL(18,8) COMMENT 'reserved_usd',
  `status` VARCHAR(20) COMMENT '상태',
  `usage_estimated` BOOLEAN NOT NULL COMMENT 'usage_estimated',
  `settled_at` DATETIME COMMENT 'settled_at',
  `created_at` DATETIME NOT NULL COMMENT '생성 일시',
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_ai_usage_project_id` FOREIGN KEY (`project_id`) REFERENCES `projects` (`project_id`),
  CONSTRAINT `fk_ai_usage_job_id` FOREIGN KEY (`job_id`) REFERENCES `ai_jobs` (`id`)
) COMMENT='AI 사용량';

CREATE TABLE `ai_provider_settings` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `claude_api_key_encrypted` TEXT COMMENT 'claude_api_key_encrypted',
  `claude_input_price` DOUBLE COMMENT 'claude_input_price',
  `claude_output_price` DOUBLE COMMENT 'claude_output_price',
  `claude_workspace_id` VARCHAR(255) COMMENT 'claude_workspace_id',
  `default_provider` VARCHAR(16) COMMENT 'default_provider',
  `openai_api_key_encrypted` TEXT COMMENT 'openai_api_key_encrypted',
  `openai_input_price` DOUBLE COMMENT 'openai_input_price',
  `openai_output_price` DOUBLE COMMENT 'openai_output_price',
  `claude_transport` VARCHAR(30) COMMENT 'claude_transport',
  `bedrock_region` VARCHAR(50) COMMENT 'bedrock_region',
  `bedrock_model` VARCHAR(200) COMMENT 'bedrock_model',
  `version` BIGINT NOT NULL COMMENT 'version',
  `updated_at` DATETIME NOT NULL COMMENT '수정 일시',
  PRIMARY KEY (`id`)
) COMMENT='AI 공급자 설정';

CREATE TABLE `users` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `last_login_at` DATETIME COMMENT 'last_login_at',
  `password` VARCHAR(255) NOT NULL COMMENT 'password',
  `role` VARCHAR(20) NOT NULL COMMENT '역할',
  `username` VARCHAR(100) NOT NULL COMMENT '사용자명',
  `enabled` BOOLEAN NOT NULL COMMENT '사용 여부',
  `created_at` DATETIME NOT NULL COMMENT '생성 일시',
  `updated_at` DATETIME NOT NULL COMMENT '수정 일시',
  PRIMARY KEY (`id`),
  UNIQUE KEY `ukr43af9ap4edm43mmtq01oddj6` (`username`)
) COMMENT='사용자 계정';

CREATE TABLE `ai_chat_sessions` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `project_id` VARCHAR(100) COMMENT '프로젝트 ID',
  `user_id` BIGINT NOT NULL COMMENT '사용자 ID',
  `allowed_tools` TEXT COMMENT '허락한 도구',
  `title` VARCHAR(200) NOT NULL COMMENT '제목',
  `created_at` DATETIME NOT NULL COMMENT '생성 일시',
  `updated_at` DATETIME NOT NULL COMMENT '수정 일시',
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_ai_chat_sessions_project_id` FOREIGN KEY (`project_id`) REFERENCES `projects` (`project_id`),
  CONSTRAINT `fk_ai_chat_sessions_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) COMMENT='AI 채팅 세션';

CREATE TABLE `ai_chat_messages` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `session_id` BIGINT NOT NULL COMMENT '세션 ID',
  `blocks` TEXT NOT NULL COMMENT 'blocks',
  `role` VARCHAR(20) NOT NULL COMMENT '역할',
  `stop_reason` VARCHAR(20) COMMENT '종료 이유',
  `created_at` DATETIME NOT NULL COMMENT '생성 일시',
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_ai_chat_messages_session_id` FOREIGN KEY (`session_id`) REFERENCES `ai_chat_sessions` (`id`)
) COMMENT='AI 채팅 메시지';

CREATE TABLE `site_analysis_run` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `commit_sha` VARCHAR(64) COMMENT '커밋',
  `error_message` TEXT COMMENT '오류 메시지',
  `finished_at` DATETIME COMMENT '종료 일시',
  `framework` VARCHAR(30) COMMENT '프레임워크',
  `partial` BOOLEAN NOT NULL COMMENT '부분 분석',
  `screen_count` INT NOT NULL COMMENT '찾은 화면 수',
  `started_at` DATETIME NOT NULL COMMENT '시작 일시',
  `status` VARCHAR(20) NOT NULL COMMENT '상태',
  `warnings` TEXT COMMENT '경고',
  `llm_calls` INT COMMENT 'LLM 호출 수',
  `processed_count` INT COMMENT '읽은 화면 수',
  `progress_at` DATETIME COMMENT 'progress_at',
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_site_analysis_run_project_id` FOREIGN KEY (`project_id`) REFERENCES `projects` (`project_id`)
) COMMENT='사이트 분석 기록';

CREATE TABLE `site_node` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `auth_required` BOOLEAN COMMENT '로그인 필요',
  `elements` TEXT NOT NULL COMMENT '요소 목록',
  `first_seen_commit` VARCHAR(64) COMMENT '처음 본 커밋',
  `last_seen_commit` VARCHAR(64) COMMENT '마지막 본 커밋',
  `origin` VARCHAR(20) NOT NULL COMMENT '출처 (CODE/SITE/MANUAL)',
  `route_key` VARCHAR(500) NOT NULL COMMENT '화면 경로',
  `source_file` VARCHAR(700) COMMENT '소스 파일',
  `stale` BOOLEAN NOT NULL COMMENT '코드에서 사라짐',
  `title` VARCHAR(300) COMMENT '제목',
  `content_hash` VARCHAR(64) COMMENT '파일 해시',
  `links` TEXT COMMENT '링크 목록',
  `url` VARCHAR(1000) COMMENT '실제 주소',
  `forms` TEXT COMMENT '폼 목록',
  `aria_snapshot` TEXT COMMENT '접근성 트리',
  `screenshot` VARCHAR(300) COMMENT '화면 캡처',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_site_node_route` (`project_id`, `route_key`),
  CONSTRAINT `fk_site_node_project_id` FOREIGN KEY (`project_id`) REFERENCES `projects` (`project_id`)
) COMMENT='화면';

CREATE TABLE `site_edge` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `from_route_key` VARCHAR(500) NOT NULL COMMENT '출발 화면',
  `kind` VARCHAR(20) NOT NULL COMMENT '종류',
  `label` VARCHAR(300) COMMENT '누르는 것',
  `selector` VARCHAR(700) COMMENT '셀렉터',
  `source_file` VARCHAR(700) COMMENT '소스 파일',
  `source_line` INT COMMENT '코드 줄',
  `to_route_key` VARCHAR(500) NOT NULL COMMENT '도착 화면',
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_site_edge_project_id` FOREIGN KEY (`project_id`) REFERENCES `projects` (`project_id`)
) COMMENT='전환';

CREATE TABLE `site_layout` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `content_hash` VARCHAR(64) COMMENT '파일 해시',
  `elements` TEXT COMMENT '요소 목록',
  `links` TEXT COMMENT '링크 목록',
  `route_keys` TEXT COMMENT '화면 경로 목록',
  `source_file` VARCHAR(700) NOT NULL COMMENT '소스 파일',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_site_layout_file` (`project_id`, `source_file`),
  CONSTRAINT `fk_site_layout_project_id` FOREIGN KEY (`project_id`) REFERENCES `projects` (`project_id`)
) COMMENT='공용 메뉴';

CREATE TABLE `site_node_edit` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `excluded` BOOLEAN NOT NULL COMMENT '테스트 제외',
  `note` VARCHAR(500) COMMENT '메모',
  `route_key` VARCHAR(500) NOT NULL COMMENT '화면 경로',
  `version` BIGINT NOT NULL COMMENT 'version',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_site_node_edit_route` (`project_id`, `route_key`),
  CONSTRAINT `fk_site_node_edit_project_id` FOREIGN KEY (`project_id`) REFERENCES `projects` (`project_id`)
) COMMENT='화면 사용자 편집';

CREATE TABLE `scenario_origin` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `route_keys` TEXT COMMENT '화면 경로 목록',
  `selector_keys` TEXT COMMENT '쓴 셀렉터',
  `spec_path` VARCHAR(500) NOT NULL COMMENT 'spec 경로',
  `source` VARCHAR(20) COMMENT '출처 (AI 생성/녹화)',
  `updated_at` DATETIME NOT NULL COMMENT '수정 일시',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_scenario_origin_spec` (`project_id`, `spec_path`),
  CONSTRAINT `fk_scenario_origin_project_id` FOREIGN KEY (`project_id`) REFERENCES `projects` (`project_id`)
) COMMENT='테스트 출처';

CREATE TABLE `notifications` (
  `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '식별자',
  `user_id` BIGINT NOT NULL COMMENT '사용자 ID',
  `project_id` VARCHAR(100) COMMENT '프로젝트 ID',
  `kind` VARCHAR(40) NOT NULL COMMENT '종류',
  `level` VARCHAR(10) NOT NULL COMMENT '수준',
  `title` VARCHAR(200) NOT NULL COMMENT '제목',
  `message` VARCHAR(1000) COMMENT 'message',
  `link` VARCHAR(500) COMMENT 'link',
  `created_at` DATETIME NOT NULL COMMENT '생성 일시',
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_notifications_project_id` FOREIGN KEY (`project_id`) REFERENCES `projects` (`project_id`),
  CONSTRAINT `fk_notifications_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) COMMENT='알림';

CREATE TABLE `notification_outbox` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `project_id` VARCHAR(100) COMMENT '프로젝트 ID',
  `dedup_key` VARCHAR(200) NOT NULL COMMENT 'dedup_key',
  `event_type` VARCHAR(50) NOT NULL COMMENT 'event_type',
  `resource_id` VARCHAR(100) NOT NULL COMMENT 'resource_id',
  `final_status` VARCHAR(30) NOT NULL COMMENT 'final_status',
  `message` TEXT NOT NULL COMMENT 'message',
  `status` VARCHAR(20) NOT NULL COMMENT '상태',
  `retry_count` INT NOT NULL COMMENT 'retry_count',
  `next_retry_at` DATETIME NOT NULL COMMENT 'next_retry_at',
  `last_error` TEXT COMMENT 'last_error',
  `created_at` DATETIME NOT NULL COMMENT '생성 일시',
  `updated_at` DATETIME NOT NULL COMMENT '수정 일시',
  PRIMARY KEY (`id`),
  UNIQUE KEY `notification_outbox_dedup_key_key` (`dedup_key`),
  CONSTRAINT `fk_notification_outbox_project_id` FOREIGN KEY (`project_id`) REFERENCES `projects` (`project_id`)
) COMMENT='알림 발송 대기열';

CREATE TABLE `slack_settings` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `project_id` VARCHAR(100) COMMENT '프로젝트 ID',
  `webhook_url_encrypted` TEXT COMMENT 'webhook_url_encrypted',
  `event_types` TEXT COMMENT 'event_types',
  `enabled` BOOLEAN NOT NULL COMMENT '사용 여부',
  `version` BIGINT NOT NULL COMMENT 'version',
  `updated_at` DATETIME NOT NULL COMMENT '수정 일시',
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_slack_settings_project_id` FOREIGN KEY (`project_id`) REFERENCES `projects` (`project_id`)
) COMMENT='Slack 설정';

CREATE TABLE `idempotency_records` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `operation_type` VARCHAR(50) NOT NULL COMMENT 'operation_type',
  `idempotency_key` VARCHAR(120) NOT NULL COMMENT 'idempotency_key',
  `request_hash` VARCHAR(64) NOT NULL COMMENT 'request_hash',
  `response_status` INT NOT NULL COMMENT 'response_status',
  `response_body` TEXT COMMENT 'response_body',
  `resource_id` VARCHAR(100) COMMENT 'resource_id',
  `expires_at` DATETIME NOT NULL COMMENT 'expires_at',
  `created_at` DATETIME NOT NULL COMMENT '생성 일시',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_idempotency_scope_key` (`project_id`, `operation_type`, `idempotency_key`),
  CONSTRAINT `fk_idempotency_records_project_id` FOREIGN KEY (`project_id`) REFERENCES `projects` (`project_id`)
) COMMENT='중복 요청 방지 기록';

CREATE TABLE `user_sessions` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `user_id` BIGINT NOT NULL COMMENT '사용자 ID',
  `expires_at` DATETIME NOT NULL COMMENT 'expires_at',
  `last_accessed_at` DATETIME COMMENT 'last_accessed_at',
  `token` VARCHAR(100) COMMENT '토큰',
  `token_hash` VARCHAR(64) COMMENT 'token_hash',
  `revoked_at` DATETIME COMMENT 'revoked_at',
  `user_agent` VARCHAR(500) COMMENT 'user_agent',
  `created_at` DATETIME NOT NULL COMMENT '생성 일시',
  PRIMARY KEY (`id`),
  UNIQUE KEY `ukdyv200n8t8bn2vt6pu071b5l0` (`token`),
  CONSTRAINT `fk_user_sessions_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) COMMENT='로그인 세션';

CREATE TABLE `user_audit_logs` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `project_id` VARCHAR(100) COMMENT '프로젝트 ID',
  `action` VARCHAR(50) NOT NULL COMMENT 'action',
  `actor_user_id` BIGINT COMMENT 'actor_user_id',
  `actor_username` VARCHAR(100) COMMENT 'actor_username',
  `detail` TEXT COMMENT 'detail',
  `target_user_id` BIGINT COMMENT 'target_user_id',
  `target_username` VARCHAR(100) COMMENT 'target_username',
  `resource_type` VARCHAR(100) COMMENT 'resource_type',
  `resource_id` VARCHAR(100) COMMENT 'resource_id',
  `request_id` VARCHAR(100) COMMENT 'request_id',
  `outcome` VARCHAR(20) NOT NULL COMMENT 'outcome',
  `created_at` DATETIME NOT NULL COMMENT '생성 일시',
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_user_audit_logs_project_id` FOREIGN KEY (`project_id`) REFERENCES `projects` (`project_id`)
) COMMENT='계정 감사 로그';

CREATE TABLE `board_posts` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `attachments_json` TEXT COMMENT 'attachments_json',
  `content` TEXT NOT NULL COMMENT 'content',
  `parent_id` BIGINT COMMENT 'parent_id',
  `pinned` BOOLEAN NOT NULL COMMENT 'pinned',
  `title` VARCHAR(200) NOT NULL COMMENT '제목',
  `type` VARCHAR(20) NOT NULL COMMENT 'type',
  `visible` BOOLEAN NOT NULL COMMENT 'visible',
  `visible_from` DATETIME COMMENT 'visible_from',
  `visible_until` DATETIME COMMENT 'visible_until',
  `deleted` BOOLEAN NOT NULL COMMENT 'deleted',
  `created_by` VARCHAR(100) NOT NULL COMMENT '작성자',
  `updated_by` VARCHAR(100) COMMENT '수정자',
  `created_at` DATETIME NOT NULL COMMENT '생성 일시',
  `updated_at` DATETIME NOT NULL COMMENT '수정 일시',
  PRIMARY KEY (`id`)
) COMMENT='게시글';

CREATE TABLE `board_post_comments` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `post_id` BIGINT NOT NULL COMMENT 'post_id',
  `attachments_json` TEXT COMMENT 'attachments_json',
  `content` TEXT NOT NULL COMMENT 'content',
  `parent_id` BIGINT COMMENT 'parent_id',
  `deleted` BOOLEAN NOT NULL COMMENT 'deleted',
  `created_by` VARCHAR(100) NOT NULL COMMENT '작성자',
  `updated_by` VARCHAR(100) COMMENT '수정자',
  `created_at` DATETIME NOT NULL COMMENT '생성 일시',
  `updated_at` DATETIME NOT NULL COMMENT '수정 일시',
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_board_post_comments_post_id` FOREIGN KEY (`post_id`) REFERENCES `board_posts` (`id`)
) COMMENT='게시글 댓글';

CREATE TABLE `board_post_reactions` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `post_id` BIGINT NOT NULL COMMENT 'post_id',
  `liked` BOOLEAN NOT NULL COMMENT 'liked',
  `memo` TEXT COMMENT 'memo',
  `rating` INT COMMENT 'rating',
  `username` VARCHAR(100) NOT NULL COMMENT 'username',
  `created_at` DATETIME NOT NULL COMMENT '생성 일시',
  `updated_at` DATETIME NOT NULL COMMENT '수정 일시',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_board_post_reaction_user` (`post_id`, `username`),
  CONSTRAINT `fk_board_post_reactions_post_id` FOREIGN KEY (`post_id`) REFERENCES `board_posts` (`id`)
) COMMENT='게시글 반응';
