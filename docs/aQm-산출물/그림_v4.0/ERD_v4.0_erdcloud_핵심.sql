-- AI-TestOps 핵심 ERD v4.0 (ERDCloud 가져오기용, MySQL 문법)
-- PostgreSQL 16에 Flyway V1~V23을 적용한 public 스키마. 실제 FK만 제약으로 선언.
-- DB 실행용 원본은 Flyway SQL. 기본값·인덱스·CHECK·뷰는 가져오기 범위에서 생략.
-- langgraph 체크포인트는 라이브러리 관리 스키마.
-- 실행·계획·AI·사이트 구조·사용자·공지의 핵심 열. 전체 열은 전체 SQL 참조.

CREATE TABLE `users` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `username` VARCHAR(100) NOT NULL COMMENT '사용자명',
  `role` VARCHAR(20) NOT NULL COMMENT '역할',
  `display_name` VARCHAR(100) COMMENT 'display_name',
  `password_change_required` BOOLEAN NOT NULL COMMENT 'password_change_required',
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_username_key` (`username`)
) COMMENT='사용자 계정';

CREATE TABLE `projects` (
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `project_name` VARCHAR(200) NOT NULL COMMENT '프로젝트 이름',
  `base_url` VARCHAR(500) COMMENT '대상 사이트 주소',
  `repository_url` VARCHAR(500) COMMENT '테스트 코드 저장소',
  `source_repository_url` VARCHAR(500) COMMENT '앱 소스 저장소',
  `runner_lifecycle` VARCHAR(20) COMMENT '러너 생명주기',
  `ai_auto_apply_enabled` BOOLEAN COMMENT 'AI 자동 반영',
  `start_date` DATE COMMENT 'start_date',
  `end_date` DATE COMMENT 'end_date',
  `status` VARCHAR(10) NOT NULL COMMENT 'status',
  `created_by` BIGINT COMMENT 'created_by',
  `updated_by` BIGINT COMMENT 'updated_by',
  PRIMARY KEY (`project_id`)
) COMMENT='프로젝트';

CREATE TABLE `executions` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `status` VARCHAR(20) NOT NULL COMMENT '상태',
  `grep_filter` VARCHAR(500) COMMENT '필터',
  `spec_path` VARCHAR(500) COMMENT 'spec 경로',
  `total_tests` INT COMMENT '전체 수',
  `passed_tests` INT COMMENT '성공 수',
  `failed_tests` INT COMMENT '실패 수',
  `report_path` VARCHAR(500) COMMENT '리포트 경로',
  `source` VARCHAR(30) COMMENT '실행 출처',
  `started_at` DATETIME COMMENT '시작 일시',
  `created_by` BIGINT COMMENT 'created_by',
  `rerun_of` BIGINT COMMENT 'rerun_of',
  PRIMARY KEY (`id`)
) COMMENT='테스트 실행 이력 (N차 테스트)';

CREATE TABLE `execution_case_results` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `execution_id` BIGINT NOT NULL COMMENT '실행 ID',
  `spec_path` VARCHAR(500) COMMENT 'spec 경로',
  `case_title` TEXT COMMENT '케이스 제목',
  `status` VARCHAR(20) NOT NULL COMMENT '상태',
  `error_message` TEXT COMMENT '오류 메시지',
  PRIMARY KEY (`id`)
) COMMENT='케이스별 결과';

CREATE TABLE `ai_jobs` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `job_type` VARCHAR(30) NOT NULL COMMENT '작업 종류',
  `status` VARCHAR(20) NOT NULL COMMENT '상태',
  `route_keys` TEXT COMMENT '화면 경로 목록',
  `failed_execution_id` BIGINT COMMENT '실패한 실행',
  `risk_flags` TEXT COMMENT '주의 표시',
  `auto_created` BOOLEAN NOT NULL COMMENT 'AI 선제 작업(AI Task)',
  `parent_job_id` BIGINT COMMENT 'parent_job_id',
  PRIMARY KEY (`id`),
  CONSTRAINT `ai_jobs_parent_job_id_fkey` FOREIGN KEY (`parent_job_id`) REFERENCES `ai_jobs` (`id`) ON DELETE SET NULL
) COMMENT='AI 작업';

CREATE TABLE `ai_chat_sessions` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `user_id` BIGINT NOT NULL COMMENT '사용자 ID',
  `project_id` VARCHAR(100) COMMENT '프로젝트 ID',
  `title` VARCHAR(200) NOT NULL COMMENT '제목',
  `allowed_tools` TEXT COMMENT '허락한 도구',
  PRIMARY KEY (`id`)
) COMMENT='AI 채팅 세션';

CREATE TABLE `notifications` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `user_id` BIGINT NOT NULL COMMENT '사용자 ID',
  `kind` VARCHAR(40) NOT NULL COMMENT '종류',
  `level` VARCHAR(10) NOT NULL COMMENT '수준',
  `project_id` VARCHAR(100) COMMENT '프로젝트 ID',
  PRIMARY KEY (`id`)
) COMMENT='알림';

CREATE TABLE `site_analysis_run` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `status` VARCHAR(20) NOT NULL COMMENT '상태',
  `commit_sha` VARCHAR(64) COMMENT '커밋',
  `framework` VARCHAR(30) COMMENT '프레임워크',
  `screen_count` INT NOT NULL COMMENT '찾은 화면 수',
  `llm_calls` INT COMMENT 'LLM 호출 수',
  PRIMARY KEY (`id`)
) COMMENT='사이트 분석 기록';

CREATE TABLE `site_node` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `route_key` VARCHAR(500) NOT NULL COMMENT '화면 경로',
  `title` VARCHAR(300) COMMENT '제목',
  `origin` VARCHAR(20) NOT NULL COMMENT '출처 (CODE/SITE/MANUAL)',
  `elements` TEXT NOT NULL COMMENT '요소 목록',
  `stale` BOOLEAN NOT NULL COMMENT '코드에서 사라짐',
  `url` VARCHAR(1000) COMMENT '실제 주소',
  `screenshot` VARCHAR(300) COMMENT '화면 캡처',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_site_node_route` (`project_id`, `route_key`)
) COMMENT='화면';

CREATE TABLE `site_edge` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `from_route_key` VARCHAR(500) NOT NULL COMMENT '출발 화면',
  `to_route_key` VARCHAR(500) NOT NULL COMMENT '도착 화면',
  `label` VARCHAR(300) COMMENT '누르는 것',
  `selector` VARCHAR(700) COMMENT '셀렉터',
  PRIMARY KEY (`id`)
) COMMENT='전환';

CREATE TABLE `site_layout` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `source_file` VARCHAR(700) NOT NULL COMMENT '소스 파일',
  `route_keys` TEXT COMMENT '화면 경로 목록',
  `links` TEXT COMMENT '링크 목록',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_site_layout_file` (`project_id`, `source_file`)
) COMMENT='공용 메뉴';

CREATE TABLE `site_node_edit` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `route_key` VARCHAR(500) NOT NULL COMMENT '화면 경로',
  `excluded` BOOLEAN NOT NULL COMMENT '테스트 제외',
  `note` VARCHAR(500) COMMENT '메모',
  `created_by` BIGINT COMMENT 'created_by',
  `created_at` DATETIME COMMENT 'created_at',
  `updated_by` BIGINT COMMENT 'updated_by',
  `updated_at` DATETIME COMMENT 'updated_at',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_site_node_edit_route` (`project_id`, `route_key`)
) COMMENT='화면 사용자 편집';

CREATE TABLE `scenario_origin` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `spec_path` VARCHAR(500) NOT NULL COMMENT 'spec 경로',
  `route_keys` TEXT COMMENT '화면 경로 목록',
  `selector_keys` TEXT COMMENT '쓴 셀렉터',
  `source` VARCHAR(20) COMMENT '출처 (AI 생성/녹화)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_scenario_origin_spec` (`project_id`, `spec_path`)
) COMMENT='테스트 출처';

CREATE TABLE `board_posts` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `type` VARCHAR(20) NOT NULL COMMENT 'type',
  `title` VARCHAR(200) NOT NULL COMMENT '제목',
  `visible` BOOLEAN NOT NULL COMMENT 'visible',
  `pinned` BOOLEAN NOT NULL COMMENT 'pinned',
  `deleted` BOOLEAN NOT NULL COMMENT 'deleted',
  `visible_from` DATETIME COMMENT 'visible_from',
  `visible_until` DATETIME COMMENT 'visible_until',
  PRIMARY KEY (`id`)
) COMMENT='공지 · 게시글';

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

CREATE TABLE `scenario_case_settings` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `node_type` VARCHAR(20) NOT NULL COMMENT '단위 (SPEC/DESCRIBE/TEST)',
  `spec_path` VARCHAR(500) NOT NULL COMMENT 'spec 경로',
  `grep_filter` VARCHAR(500) NOT NULL COMMENT '케이스 키(grep)',
  `enabled` BOOLEAN NOT NULL COMMENT '사용 여부',
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

CREATE TABLE `ai_chat_messages` (
  `id` BIGINT NOT NULL COMMENT '식별자',
  `session_id` BIGINT NOT NULL COMMENT '세션 ID',
  `role` VARCHAR(20) NOT NULL COMMENT '역할',
  `blocks` TEXT NOT NULL COMMENT 'blocks',
  `stop_reason` VARCHAR(20) COMMENT '종료 이유',
  PRIMARY KEY (`id`),
  CONSTRAINT `ai_chat_messages_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `ai_chat_sessions` (`id`) ON DELETE CASCADE
) COMMENT='AI 채팅 메시지';

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

ALTER TABLE `executions` ADD CONSTRAINT `fk_executions_rerun_of` FOREIGN KEY (`rerun_of`) REFERENCES `executions` (`id`) ON DELETE SET NULL;
ALTER TABLE `scenario_case_settings` ADD CONSTRAINT `fk_scenario_case_settings_assignee` FOREIGN KEY (`assignee_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL;
