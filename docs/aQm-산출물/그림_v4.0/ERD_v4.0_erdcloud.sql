-- AI-TestOps 전체 ERD v4.0 (ERDCloud 가져오기용, MySQL 문법)
-- PostgreSQL 16에 Flyway V1~V23을 적용한 public 스키마. 실제 FK만 제약으로 선언.
-- DB 실행용 원본은 Flyway SQL. 기본값·인덱스·CHECK·뷰는 가져오기 범위에서 생략.
-- langgraph 체크포인트는 라이브러리 관리 스키마.

CREATE TABLE `ai_jobs` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `job_type` VARCHAR(30) NOT NULL COMMENT '작업 종류',
  `status` VARCHAR(20) NOT NULL COMMENT '상태',
  `ai_model_provider` VARCHAR(20) NOT NULL COMMENT 'LLM 공급자',
  `instruction` TEXT COMMENT '요청 문장',
  `target_spec_path` VARCHAR(500) COMMENT '대상 spec',
  `route_keys` TEXT COMMENT '화면 경로 목록',
  `failed_execution_id` BIGINT COMMENT '실패한 실행',
  `iterations_used` INT COMMENT 'iterations_used',
  `diff_path` VARCHAR(500) COMMENT 'diff_path',
  `changed_files` TEXT COMMENT '바뀐 파일',
  `summary` TEXT COMMENT 'summary',
  `risk_flags` TEXT COMMENT '주의 표시',
  `error_message` TEXT COMMENT '오류 메시지',
  `callback_token` VARCHAR(100) COMMENT 'callback_token',
  `callback_token_expires_at` DATETIME COMMENT 'callback_token_expires_at',
  `requested_by` BIGINT COMMENT '요청자',
  `reviewed_by` BIGINT COMMENT '승인자',
  `rejection_reason` VARCHAR(500) COMMENT 'rejection_reason',
  `applied_commit_sha` VARCHAR(100) COMMENT '반영 커밋',
  `post_apply_verification_status` VARCHAR(20) COMMENT '반영 후 검증',
  `post_apply_verification_execution_id` BIGINT COMMENT '반영 후 검증 실행',
  `reverted_at` DATETIME COMMENT 'reverted_at',
  `revert_commit` VARCHAR(100) COMMENT 'revert_commit',
  `version` BIGINT NOT NULL COMMENT 'version',
  `created_at` DATETIME NOT NULL COMMENT '생성 일시',
  `updated_at` DATETIME NOT NULL COMMENT '수정 일시',
  `auto_created` BOOLEAN NOT NULL COMMENT 'AI 선제 작업(AI Task)',
  `parent_job_id` BIGINT COMMENT 'parent_job_id',
  PRIMARY KEY (`id`),
  CONSTRAINT `ai_jobs_parent_job_id_fkey` FOREIGN KEY (`parent_job_id`) REFERENCES `ai_jobs` (`id`) ON DELETE SET NULL
) COMMENT='AI 작업';

CREATE TABLE `ai_usage` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `provider` VARCHAR(16) NOT NULL COMMENT 'provider',
  `feature` VARCHAR(40) COMMENT 'feature',
  `project_id` VARCHAR(100) COMMENT '프로젝트 ID',
  `job_id` BIGINT COMMENT 'AI 작업 ID',
  `request_id` VARCHAR(100) COMMENT 'request_id',
  `model` VARCHAR(200) COMMENT 'model',
  `input_tokens` INT NOT NULL COMMENT 'input_tokens',
  `output_tokens` INT NOT NULL COMMENT 'output_tokens',
  `input_unit_price` NUMERIC(18,8) COMMENT 'input_unit_price',
  `output_unit_price` NUMERIC(18,8) COMMENT 'output_unit_price',
  `cost_usd` NUMERIC(18,8) COMMENT 'cost_usd',
  `reserved_usd` NUMERIC(18,8) COMMENT 'reserved_usd',
  `status` VARCHAR(20) COMMENT '상태',
  `usage_estimated` BOOLEAN NOT NULL COMMENT 'usage_estimated',
  `duration_ms` BIGINT NOT NULL COMMENT 'duration_ms',
  `created_at` DATETIME NOT NULL COMMENT '생성 일시',
  `settled_at` DATETIME COMMENT 'settled_at',
  `succeeded` BOOLEAN NOT NULL COMMENT 'succeeded',
  PRIMARY KEY (`id`)
) COMMENT='AI 사용량';

CREATE TABLE `execution_case_results` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `execution_id` BIGINT NOT NULL COMMENT '실행 ID',
  `spec_path` VARCHAR(500) COMMENT 'spec 경로',
  `case_title` TEXT COMMENT '케이스 제목',
  `status` VARCHAR(20) NOT NULL COMMENT '상태',
  `duration_ms` INT COMMENT '소요 시간(ms)',
  `error_message` TEXT COMMENT '오류 메시지',
  `attempt_index` INT NOT NULL COMMENT 'attempt_index',
  `case_index` INT NOT NULL COMMENT 'case_index',
  `created_at` DATETIME NOT NULL COMMENT '생성 일시',
  PRIMARY KEY (`id`)
) COMMENT='케이스별 결과';

CREATE TABLE `executions` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `status` VARCHAR(20) NOT NULL COMMENT '상태',
  `grep_filter` VARCHAR(500) COMMENT '필터',
  `spec_path` VARCHAR(500) COMMENT 'spec 경로',
  `case_title` VARCHAR(500) COMMENT '실행 케이스',
  `total_tests` INT COMMENT '전체 수',
  `passed_tests` INT COMMENT '성공 수',
  `failed_tests` INT COMMENT '실패 수',
  `skipped_tests` INT COMMENT '건너뜀 수',
  `duration_ms` BIGINT COMMENT '소요 시간(ms)',
  `report_path` VARCHAR(500) COMMENT '리포트 경로',
  `source` VARCHAR(30) COMMENT '실행 출처',
  `sequential` BOOLEAN NOT NULL COMMENT 'sequential',
  `log_output` TEXT COMMENT '실행 로그',
  `error_message` TEXT COMMENT '오류 메시지',
  `started_at` DATETIME COMMENT '시작 일시',
  `finished_at` DATETIME COMMENT '종료 일시',
  `created_at` DATETIME NOT NULL COMMENT '생성 일시',
  `schedule_id` BIGINT COMMENT '예약 ID',
  `scheduled_for` DATETIME COMMENT 'scheduled_for',
  `created_by` BIGINT COMMENT 'created_by',
  `rerun_of` BIGINT COMMENT 'rerun_of',
  PRIMARY KEY (`id`)
) COMMENT='테스트 실행 이력 (N차 테스트)';

CREATE TABLE `execution_schedules` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `name` VARCHAR(200) COMMENT '이름',
  `suite_id` BIGINT COMMENT '스위트 ID',
  `spec_path` VARCHAR(500) COMMENT 'spec 경로',
  `case_title` VARCHAR(500) COMMENT 'case_title',
  `hour` INT NOT NULL COMMENT 'hour',
  `minute` INT NOT NULL COMMENT 'minute',
  `days_of_week` VARCHAR(50) NOT NULL COMMENT 'days_of_week',
  `cron_expression` VARCHAR(100) COMMENT 'cron 식',
  `timezone` VARCHAR(64) NOT NULL COMMENT 'timezone',
  `run_at` DATETIME COMMENT 'run_at',
  `next_run_at` DATETIME COMMENT 'next_run_at',
  `enabled` BOOLEAN NOT NULL COMMENT '사용 여부',
  `misfire_policy` VARCHAR(20) NOT NULL COMMENT 'misfire_policy',
  `last_triggered_at` DATETIME COMMENT 'last_triggered_at',
  `created_by` BIGINT COMMENT '작성자',
  `version` BIGINT NOT NULL COMMENT 'version',
  `created_at` DATETIME NOT NULL COMMENT '생성 일시',
  `updated_at` DATETIME NOT NULL COMMENT '수정 일시',
  `updated_by` BIGINT COMMENT 'updated_by',
  PRIMARY KEY (`id`)
) COMMENT='예약 실행';

CREATE TABLE `notifications` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `user_id` BIGINT NOT NULL COMMENT '사용자 ID',
  `kind` VARCHAR(40) NOT NULL COMMENT '종류',
  `level` VARCHAR(10) NOT NULL COMMENT '수준',
  `title` VARCHAR(200) NOT NULL COMMENT '제목',
  `message` VARCHAR(1000) COMMENT 'message',
  `link` VARCHAR(500) COMMENT 'link',
  `project_id` VARCHAR(100) COMMENT '프로젝트 ID',
  `created_at` DATETIME NOT NULL COMMENT '생성 일시',
  PRIMARY KEY (`id`)
) COMMENT='알림';

CREATE TABLE `projects` (
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `project_name` VARCHAR(200) NOT NULL COMMENT '프로젝트 이름',
  `display_order` INT COMMENT 'display_order',
  `description` TEXT COMMENT '설명',
  `test_purpose` TEXT COMMENT 'test_purpose',
  `manager_name` VARCHAR(100) COMMENT 'manager_name',
  `manager_contact` VARCHAR(200) COMMENT 'manager_contact',
  `node_version` VARCHAR(20) COMMENT 'node_version',
  `playwright_version` VARCHAR(20) COMMENT 'playwright_version',
  `package_manager` VARCHAR(10) COMMENT 'package_manager',
  `install_command` VARCHAR(500) COMMENT 'install_command',
  `test_command` VARCHAR(500) COMMENT '실행 명령',
  `working_directory` VARCHAR(500) COMMENT 'working_directory',
  `env_variables` TEXT COMMENT '환경 변수',
  `login_env_required` BOOLEAN COMMENT 'login_env_required',
  `login_setup_spec_path` VARCHAR(500) COMMENT 'login_setup_spec_path',
  `storage_state_max_age_minutes` INT COMMENT 'storage_state_max_age_minutes',
  `timeout` INT COMMENT 'timeout',
  `parallel_limit` INT COMMENT 'parallel_limit',
  `base_url` VARCHAR(500) COMMENT '대상 사이트 주소',
  `repository_url` VARCHAR(500) COMMENT '테스트 코드 저장소',
  `repository_branch` VARCHAR(100) COMMENT 'repository_branch',
  `repository_token_encrypted` TEXT COMMENT 'repository_token_encrypted',
  `source_repository_url` VARCHAR(500) COMMENT '앱 소스 저장소',
  `source_repository_branch` VARCHAR(100) COMMENT '앱 소스 브랜치',
  `source_repository_token_encrypted` TEXT COMMENT '앱 소스 토큰(암호화)',
  `runner_lifecycle` VARCHAR(20) COMMENT '러너 생명주기',
  `docker_enabled` BOOLEAN COMMENT 'docker_enabled',
  `docker_container_id` VARCHAR(100) COMMENT 'docker_container_id',
  `docker_status` VARCHAR(20) COMMENT '러너 상태',
  `ai_model_provider` VARCHAR(20) COMMENT 'ai_model_provider',
  `ai_auto_apply_enabled` BOOLEAN COMMENT 'AI 자동 반영',
  `ai_auto_apply_max_changed_lines` INT COMMENT 'ai_auto_apply_max_changed_lines',
  `ai_auto_apply_max_changed_files` INT COMMENT 'ai_auto_apply_max_changed_files',
  `ai_allowed_path_globs` TEXT COMMENT 'AI 수정 허용 경로',
  `ai_denied_path_globs` TEXT COMMENT 'ai_denied_path_globs',
  `ai_max_iterations` INT COMMENT 'ai_max_iterations',
  `owner_user_id` BIGINT COMMENT '소유자',
  `monthly_ai_budget_usd` NUMERIC(18,8) NOT NULL COMMENT 'monthly_ai_budget_usd',
  `version` BIGINT NOT NULL COMMENT 'version',
  `created_at` DATETIME NOT NULL COMMENT '생성 일시',
  `updated_at` DATETIME NOT NULL COMMENT '수정 일시',
  `start_date` DATE COMMENT 'start_date',
  `end_date` DATE COMMENT 'end_date',
  `status` VARCHAR(10) NOT NULL COMMENT 'status',
  `created_by` BIGINT COMMENT 'created_by',
  `updated_by` BIGINT COMMENT 'updated_by',
  PRIMARY KEY (`project_id`)
) COMMENT='프로젝트';

CREATE TABLE `site_edge` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `from_route_key` VARCHAR(500) NOT NULL COMMENT '출발 화면',
  `to_route_key` VARCHAR(500) NOT NULL COMMENT '도착 화면',
  `kind` VARCHAR(20) NOT NULL COMMENT '종류',
  `label` VARCHAR(300) COMMENT '누르는 것',
  `selector` VARCHAR(700) COMMENT '셀렉터',
  `source_file` VARCHAR(700) COMMENT '소스 파일',
  `source_line` INT COMMENT '코드 줄',
  PRIMARY KEY (`id`)
) COMMENT='전환';

CREATE TABLE `site_node` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `route_key` VARCHAR(500) NOT NULL COMMENT '화면 경로',
  `title` VARCHAR(300) COMMENT '제목',
  `source_file` VARCHAR(700) COMMENT '소스 파일',
  `origin` VARCHAR(20) NOT NULL COMMENT '출처 (CODE/SITE/MANUAL)',
  `auth_required` BOOLEAN COMMENT '로그인 필요',
  `elements` TEXT NOT NULL COMMENT '요소 목록',
  `links` TEXT COMMENT '링크 목록',
  `content_hash` VARCHAR(64) COMMENT '파일 해시',
  `first_seen_commit` VARCHAR(64) COMMENT '처음 본 커밋',
  `last_seen_commit` VARCHAR(64) COMMENT '마지막 본 커밋',
  `stale` BOOLEAN NOT NULL COMMENT '코드에서 사라짐',
  `url` VARCHAR(1000) COMMENT '실제 주소',
  `forms` TEXT COMMENT '폼 목록',
  `aria_snapshot` TEXT COMMENT '접근성 트리',
  `screenshot` VARCHAR(300) COMMENT '화면 캡처',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_site_node_route` (`project_id`, `route_key`)
) COMMENT='화면';

CREATE TABLE `test_suites` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `name` VARCHAR(200) NOT NULL COMMENT '이름',
  `spec_paths` TEXT COMMENT 'spec_paths',
  `grep` TEXT COMMENT 'grep',
  `case_count` INT COMMENT 'case_count',
  `sequential` BOOLEAN NOT NULL COMMENT 'sequential',
  `created_by` BIGINT COMMENT '작성자',
  `version` BIGINT NOT NULL COMMENT 'version',
  `created_at` DATETIME NOT NULL COMMENT '생성 일시',
  `updated_at` DATETIME NOT NULL COMMENT '수정 일시',
  `updated_by` BIGINT COMMENT 'updated_by',
  PRIMARY KEY (`id`)
) COMMENT='테스트 스위트';

CREATE TABLE `ai_chat_sessions` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `user_id` BIGINT NOT NULL COMMENT '사용자 ID',
  `project_id` VARCHAR(100) COMMENT '프로젝트 ID',
  `title` VARCHAR(200) NOT NULL COMMENT '제목',
  `allowed_tools` TEXT COMMENT '허락한 도구',
  `created_at` DATETIME NOT NULL COMMENT '생성 일시',
  `updated_at` DATETIME NOT NULL COMMENT '수정 일시',
  PRIMARY KEY (`id`)
) COMMENT='AI 채팅 세션';

CREATE TABLE `ai_classify_feedback` (
  `id` BIGINT NOT NULL COMMENT 'id',
  `project_id` VARCHAR(100) NOT NULL COMMENT 'project_id',
  `signature` VARCHAR(12) NOT NULL COMMENT 'signature',
  `cause` VARCHAR(20) NOT NULL COMMENT 'cause',
  `user_id` BIGINT COMMENT 'user_id',
  `created_at` DATETIME NOT NULL COMMENT 'created_at',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ai_classify_feedback` (`project_id`, `signature`)
) COMMENT='분류 정정 기억';

CREATE TABLE `ai_provider_settings` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `claude_api_key_encrypted` TEXT COMMENT 'claude_api_key_encrypted',
  `openai_api_key_encrypted` TEXT COMMENT 'openai_api_key_encrypted',
  `claude_workspace_id` VARCHAR(255) COMMENT 'claude_workspace_id',
  `default_provider` VARCHAR(16) COMMENT 'default_provider',
  `claude_input_price` DOUBLE COMMENT 'claude_input_price',
  `claude_output_price` DOUBLE COMMENT 'claude_output_price',
  `openai_input_price` DOUBLE COMMENT 'openai_input_price',
  `openai_output_price` DOUBLE COMMENT 'openai_output_price',
  `claude_transport` VARCHAR(30) COMMENT 'claude_transport',
  `bedrock_region` VARCHAR(50) COMMENT 'bedrock_region',
  `bedrock_model` VARCHAR(200) COMMENT 'bedrock_model',
  `version` BIGINT NOT NULL COMMENT 'version',
  `updated_at` DATETIME NOT NULL COMMENT '수정 일시',
  `updated_by` BIGINT COMMENT 'updated_by',
  PRIMARY KEY (`id`)
) COMMENT='AI 공급자 설정';

CREATE TABLE `board_posts` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `type` VARCHAR(20) NOT NULL COMMENT 'type',
  `title` VARCHAR(200) NOT NULL COMMENT '제목',
  `parent_id` BIGINT COMMENT 'parent_id',
  `content` TEXT NOT NULL COMMENT 'content',
  `attachments_json` TEXT COMMENT 'attachments_json',
  `visible` BOOLEAN NOT NULL COMMENT 'visible',
  `pinned` BOOLEAN NOT NULL COMMENT 'pinned',
  `deleted` BOOLEAN NOT NULL COMMENT 'deleted',
  `visible_from` DATETIME COMMENT 'visible_from',
  `visible_until` DATETIME COMMENT 'visible_until',
  `created_by` VARCHAR(100) NOT NULL COMMENT '작성자',
  `updated_by` VARCHAR(100) COMMENT '수정자',
  `created_at` DATETIME NOT NULL COMMENT '생성 일시',
  `updated_at` DATETIME NOT NULL COMMENT '수정 일시',
  PRIMARY KEY (`id`)
) COMMENT='공지 · 게시글';

CREATE TABLE `idempotency_records` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `operation_type` VARCHAR(50) NOT NULL COMMENT 'operation_type',
  `idempotency_key` VARCHAR(120) NOT NULL COMMENT 'idempotency_key',
  `request_hash` VARCHAR(64) NOT NULL COMMENT 'request_hash',
  `response_status` INT NOT NULL COMMENT 'response_status',
  `response_body` TEXT COMMENT 'response_body',
  `resource_id` VARCHAR(100) COMMENT 'resource_id',
  `created_at` DATETIME NOT NULL COMMENT '생성 일시',
  `expires_at` DATETIME NOT NULL COMMENT 'expires_at',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_idempotency_scope_key` (`project_id`, `operation_type`, `idempotency_key`)
) COMMENT='중복 요청 방지';

CREATE TABLE `notification_outbox` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `dedup_key` VARCHAR(200) NOT NULL COMMENT 'dedup_key',
  `project_id` VARCHAR(100) COMMENT '프로젝트 ID',
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
  UNIQUE KEY `notification_outbox_dedup_key_key` (`dedup_key`)
) COMMENT='알림 발송 대기';

CREATE TABLE `scenario_origin` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `spec_path` VARCHAR(500) NOT NULL COMMENT 'spec 경로',
  `route_keys` TEXT COMMENT '화면 경로 목록',
  `selector_keys` TEXT COMMENT '쓴 셀렉터',
  `updated_at` DATETIME NOT NULL COMMENT '수정 일시',
  `source` VARCHAR(20) COMMENT '출처 (AI 생성/녹화)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_scenario_origin_spec` (`project_id`, `spec_path`)
) COMMENT='테스트 출처';

CREATE TABLE `site_analysis_run` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `status` VARCHAR(20) NOT NULL COMMENT '상태',
  `commit_sha` VARCHAR(64) COMMENT '커밋',
  `framework` VARCHAR(30) COMMENT '프레임워크',
  `partial` BOOLEAN NOT NULL COMMENT '부분 분석',
  `screen_count` INT NOT NULL COMMENT '찾은 화면 수',
  `processed_count` INT COMMENT '읽은 화면 수',
  `progress_at` DATETIME COMMENT 'progress_at',
  `llm_calls` INT COMMENT 'LLM 호출 수',
  `warnings` TEXT COMMENT '경고',
  `error_message` TEXT COMMENT '오류 메시지',
  `started_at` DATETIME NOT NULL COMMENT '시작 일시',
  `finished_at` DATETIME COMMENT '종료 일시',
  PRIMARY KEY (`id`)
) COMMENT='사이트 분석 기록';

CREATE TABLE `site_layout` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `source_file` VARCHAR(700) NOT NULL COMMENT '소스 파일',
  `route_keys` TEXT COMMENT '화면 경로 목록',
  `elements` TEXT COMMENT '요소 목록',
  `links` TEXT COMMENT '링크 목록',
  `content_hash` VARCHAR(64) COMMENT '파일 해시',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_site_layout_file` (`project_id`, `source_file`)
) COMMENT='공용 메뉴';

CREATE TABLE `site_node_edit` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `route_key` VARCHAR(500) NOT NULL COMMENT '화면 경로',
  `excluded` BOOLEAN NOT NULL COMMENT '테스트 제외',
  `note` VARCHAR(500) COMMENT '메모',
  `version` BIGINT NOT NULL COMMENT 'version',
  `created_by` BIGINT COMMENT 'created_by',
  `created_at` DATETIME COMMENT 'created_at',
  `updated_by` BIGINT COMMENT 'updated_by',
  `updated_at` DATETIME COMMENT 'updated_at',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_site_node_edit_route` (`project_id`, `route_key`)
) COMMENT='화면 사용자 편집';

CREATE TABLE `slack_settings` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `project_id` VARCHAR(100) COMMENT '프로젝트 ID',
  `webhook_url_encrypted` TEXT COMMENT 'webhook_url_encrypted',
  `event_types` TEXT COMMENT 'event_types',
  `enabled` BOOLEAN NOT NULL COMMENT '사용 여부',
  `version` BIGINT NOT NULL COMMENT 'version',
  `updated_at` DATETIME NOT NULL COMMENT '수정 일시',
  `updated_by` BIGINT COMMENT 'updated_by',
  PRIMARY KEY (`id`)
) COMMENT='Slack 설정';

CREATE TABLE `user_audit_logs` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `actor_user_id` BIGINT COMMENT 'actor_user_id',
  `actor_username` VARCHAR(100) COMMENT 'actor_username',
  `action` VARCHAR(50) NOT NULL COMMENT 'action',
  `target_user_id` BIGINT COMMENT 'target_user_id',
  `target_username` VARCHAR(100) COMMENT 'target_username',
  `project_id` VARCHAR(100) COMMENT '프로젝트 ID',
  `resource_type` VARCHAR(100) COMMENT 'resource_type',
  `resource_id` VARCHAR(100) COMMENT 'resource_id',
  `request_id` VARCHAR(100) COMMENT 'request_id',
  `outcome` VARCHAR(20) NOT NULL COMMENT 'outcome',
  `detail` TEXT COMMENT 'detail',
  `created_at` DATETIME NOT NULL COMMENT '생성 일시',
  PRIMARY KEY (`id`)
) COMMENT='계정 감사 로그';

CREATE TABLE `user_sessions` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `token` VARCHAR(100) COMMENT '토큰',
  `token_hash` VARCHAR(64) COMMENT 'token_hash',
  `user_id` BIGINT NOT NULL COMMENT '사용자 ID',
  `created_at` DATETIME NOT NULL COMMENT '생성 일시',
  `expires_at` DATETIME NOT NULL COMMENT 'expires_at',
  `last_accessed_at` DATETIME COMMENT 'last_accessed_at',
  `revoked_at` DATETIME COMMENT 'revoked_at',
  `user_agent` VARCHAR(500) COMMENT 'user_agent',
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_sessions_token_hash_key` (`token_hash`),
  UNIQUE KEY `user_sessions_token_key` (`token`)
) COMMENT='로그인 세션';

CREATE TABLE `users` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `username` VARCHAR(100) NOT NULL COMMENT '사용자명',
  `password` VARCHAR(255) NOT NULL COMMENT 'password',
  `role` VARCHAR(20) NOT NULL COMMENT '역할',
  `enabled` BOOLEAN NOT NULL COMMENT '사용 여부',
  `created_at` DATETIME NOT NULL COMMENT '생성 일시',
  `updated_at` DATETIME NOT NULL COMMENT '수정 일시',
  `last_login_at` DATETIME COMMENT 'last_login_at',
  `display_name` VARCHAR(100) COMMENT 'display_name',
  `password_change_required` BOOLEAN NOT NULL COMMENT 'password_change_required',
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_username_key` (`username`)
) COMMENT='사용자 계정';

CREATE TABLE `ai_chat_messages` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `session_id` BIGINT NOT NULL COMMENT '세션 ID',
  `role` VARCHAR(20) NOT NULL COMMENT '역할',
  `blocks` TEXT NOT NULL COMMENT 'blocks',
  `stop_reason` VARCHAR(20) COMMENT '종료 이유',
  `created_at` DATETIME NOT NULL COMMENT '생성 일시',
  PRIMARY KEY (`id`),
  CONSTRAINT `ai_chat_messages_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `ai_chat_sessions` (`id`) ON DELETE CASCADE
) COMMENT='AI 채팅 메시지';

CREATE TABLE `ai_fix_memory` (
  `id` BIGINT NOT NULL COMMENT 'id',
  `project_id` VARCHAR(100) NOT NULL COMMENT 'project_id',
  `signature` VARCHAR(12) NOT NULL COMMENT 'signature',
  `head` TEXT COMMENT 'head',
  `locator` TEXT COMMENT 'locator',
  `spec_path` VARCHAR(500) COMMENT 'spec_path',
  `cause` VARCHAR(20) NOT NULL COMMENT 'cause',
  `ai_job_id` BIGINT NOT NULL COMMENT 'ai_job_id',
  `diff` TEXT COMMENT 'diff',
  `created_at` DATETIME NOT NULL COMMENT 'created_at',
  PRIMARY KEY (`id`),
  UNIQUE KEY `ai_fix_memory_ai_job_id_key` (`ai_job_id`),
  CONSTRAINT `ai_fix_memory_ai_job_id_fkey` FOREIGN KEY (`ai_job_id`) REFERENCES `ai_jobs` (`id`) ON DELETE CASCADE
) COMMENT='승인 수정 기억';

CREATE TABLE `board_post_comments` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `post_id` BIGINT NOT NULL COMMENT 'post_id',
  `parent_id` BIGINT COMMENT 'parent_id',
  `content` TEXT NOT NULL COMMENT 'content',
  `attachments_json` TEXT COMMENT 'attachments_json',
  `deleted` BOOLEAN NOT NULL COMMENT 'deleted',
  `created_by` VARCHAR(100) NOT NULL COMMENT '작성자',
  `updated_by` VARCHAR(100) COMMENT '수정자',
  `created_at` DATETIME NOT NULL COMMENT '생성 일시',
  `updated_at` DATETIME NOT NULL COMMENT '수정 일시',
  PRIMARY KEY (`id`),
  CONSTRAINT `board_post_comments_post_id_fkey` FOREIGN KEY (`post_id`) REFERENCES `board_posts` (`id`) ON DELETE CASCADE
) COMMENT='게시글 댓글';

CREATE TABLE `board_post_reactions` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `post_id` BIGINT NOT NULL COMMENT 'post_id',
  `username` VARCHAR(100) NOT NULL COMMENT 'username',
  `liked` BOOLEAN NOT NULL COMMENT 'liked',
  `rating` INT COMMENT 'rating',
  `memo` TEXT COMMENT 'memo',
  `created_at` DATETIME NOT NULL COMMENT '생성 일시',
  `updated_at` DATETIME NOT NULL COMMENT '수정 일시',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_board_post_reaction_user` (`post_id`, `username`),
  CONSTRAINT `board_post_reactions_post_id_fkey` FOREIGN KEY (`post_id`) REFERENCES `board_posts` (`id`) ON DELETE CASCADE
) COMMENT='게시글 반응';

CREATE TABLE `project_members` (
  `project_id` VARCHAR(100) NOT NULL COMMENT 'project_id',
  `user_id` BIGINT NOT NULL COMMENT 'user_id',
  `role` VARCHAR(10) NOT NULL COMMENT 'role',
  `created_by` BIGINT COMMENT 'created_by',
  `created_at` DATETIME NOT NULL COMMENT 'created_at',
  `updated_by` BIGINT COMMENT 'updated_by',
  `updated_at` DATETIME NOT NULL COMMENT 'updated_at',
  PRIMARY KEY (`project_id`, `user_id`),
  CONSTRAINT `project_members_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects` (`project_id`) ON DELETE CASCADE,
  CONSTRAINT `project_members_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) COMMENT='프로젝트 멤버';

CREATE TABLE `scenario_case_settings` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `node_type` VARCHAR(20) NOT NULL COMMENT '단위 (SPEC/DESCRIBE/TEST)',
  `spec_path` VARCHAR(500) NOT NULL COMMENT 'spec 경로',
  `grep_filter` VARCHAR(500) NOT NULL COMMENT '케이스 키(grep)',
  `enabled` BOOLEAN NOT NULL COMMENT '사용 여부',
  `updated_at` DATETIME NOT NULL COMMENT '수정 일시',
  `sort_order` INT COMMENT '순서',
  `assignee` VARCHAR(100) COMMENT '담당자',
  `due_date` DATE COMMENT '마감일',
  `priority` VARCHAR(10) COMMENT '우선순위 (HIGH/MEDIUM/LOW)',
  `created_by` BIGINT COMMENT 'created_by',
  `created_at` DATETIME COMMENT 'created_at',
  `updated_by` BIGINT COMMENT 'updated_by',
  `assignee_user_id` BIGINT COMMENT 'assignee_user_id',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_scenario_case_settings_key` (`project_id`, `node_type`, `spec_path`, `grep_filter`)
) COMMENT='계획 항목 (사용 여부 · 순서 · 담당자 · 마감일 · 우선순위)';

ALTER TABLE `executions` ADD CONSTRAINT `fk_executions_rerun_of` FOREIGN KEY (`rerun_of`) REFERENCES `executions` (`id`) ON DELETE SET NULL;
ALTER TABLE `scenario_case_settings` ADD CONSTRAINT `fk_scenario_case_settings_assignee` FOREIGN KEY (`assignee_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL;
