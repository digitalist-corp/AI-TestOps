-- AI-TestOps 핵심 ERD v3.0 (ERDCloud 가져오기용, MySQL 문법)
-- 문서 그림(ERD_v3.0.png)과 같은 핵심 14개 테이블 · 핵심 컬럼만 담았다. 전체 컬럼은 ERD_v3.0_erdcloud.sql 참고.
-- 실제 DB는 PostgreSQL 16. 게시판 외 FK 는 코드에서 지키는 논리 관계를 선으로 그리기 위해 적었다.
-- 화면(site_node)과 전환 · 편집 · 출처는 (project_id, route_key) 로 이어진다.

CREATE TABLE `users` (
  `id` BIGINT NOT NULL COMMENT '사용자 ID',
  `username` VARCHAR(100) NOT NULL COMMENT '사용자명',
  `role` VARCHAR(20) NOT NULL COMMENT '역할 (ADMIN/USER)',
  PRIMARY KEY (`id`)
) COMMENT='사용자';

CREATE TABLE `projects` (
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `project_name` VARCHAR(200) NOT NULL COMMENT '프로젝트 이름',
  `base_url` VARCHAR(500) COMMENT '대상 사이트 주소',
  `repository_url` VARCHAR(500) COMMENT '테스트 코드 저장소',
  `source_repository_url` VARCHAR(500) COMMENT '앱 소스 저장소',
  `runner_lifecycle` VARCHAR(20) COMMENT '러너 생명주기',
  `ai_auto_apply_enabled` BOOLEAN COMMENT 'AI 자동 반영 (기본 꺼짐)',
  PRIMARY KEY (`project_id`)
) COMMENT='프로젝트';

CREATE TABLE `scenario_case_settings` (
  `id` BIGINT NOT NULL COMMENT '계획 항목 ID',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `node_type` VARCHAR(20) NOT NULL COMMENT '단위 (SPEC/DESCRIBE/TEST)',
  `spec_path` VARCHAR(500) NOT NULL COMMENT 'spec 경로',
  `grep_filter` VARCHAR(500) NOT NULL COMMENT '케이스 키',
  `enabled` BOOLEAN NOT NULL COMMENT '사용 여부',
  `sort_order` INT COMMENT '★ 순서',
  `assignee` VARCHAR(100) COMMENT '★ 담당자',
  `due_date` DATE COMMENT '★ 마감일',
  `priority` VARCHAR(10) COMMENT '★ 우선순위 (HIGH/MEDIUM/LOW)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_scenario_case_settings_key` (`project_id`, `node_type`, `spec_path`, `grep_filter`),
  CONSTRAINT `fk_plan_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`project_id`)
) COMMENT='★ 계획 항목';

CREATE TABLE `executions` (
  `id` BIGINT NOT NULL COMMENT '실행 ID (N차 순서)',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `status` VARCHAR(20) NOT NULL COMMENT '실행 상태',
  `spec_path` VARCHAR(500) COMMENT '실행 spec',
  `grep_filter` VARCHAR(500) COMMENT '필터',
  `total_tests` INT NOT NULL COMMENT '전체 수',
  `passed_tests` INT NOT NULL COMMENT '성공 수',
  `failed_tests` INT NOT NULL COMMENT '실패 수',
  `source` VARCHAR(30) COMMENT '실행 출처 (MANUAL/SCHEDULED/CI)',
  `report_path` VARCHAR(500) COMMENT '리포트 (단계 기록 · 영상)',
  `started_at` DATETIME COMMENT '시작 일시',
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_execution_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`project_id`)
) COMMENT='테스트 실행 (N차)';

CREATE TABLE `execution_case_results` (
  `id` BIGINT NOT NULL COMMENT '결과 ID',
  `execution_id` BIGINT NOT NULL COMMENT '실행 ID',
  `spec_path` VARCHAR(500) COMMENT '리포트 경로',
  `case_title` TEXT COMMENT '파일 > 묶음 > 제목',
  `status` VARCHAR(20) NOT NULL COMMENT 'PASSED/FAILED/SKIPPED',
  `error_message` TEXT COMMENT '오류 메시지 (결함)',
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_result_execution` FOREIGN KEY (`execution_id`) REFERENCES `executions` (`id`)
) COMMENT='케이스별 결과';

CREATE TABLE `ai_jobs` (
  `id` BIGINT NOT NULL COMMENT 'AI 작업 ID',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `failed_execution_id` BIGINT COMMENT '실패한 실행',
  `job_type` VARCHAR(30) NOT NULL COMMENT '작업 종류 (생성/수정/분석)',
  `status` VARCHAR(20) NOT NULL COMMENT '상태 (PROPOSED/NEEDS_REVIEW…)',
  `route_keys` TEXT COMMENT '고른 화면',
  `risk_flags` TEXT COMMENT '주의 표시',
  `auto_created` BOOLEAN NOT NULL COMMENT 'AI 선제 작업 (AI Task)',
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_job_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`project_id`),
  CONSTRAINT `fk_job_execution` FOREIGN KEY (`failed_execution_id`) REFERENCES `executions` (`id`)
) COMMENT='AI 작업';

CREATE TABLE `ai_chat_sessions` (
  `id` BIGINT NOT NULL COMMENT '세션 ID',
  `user_id` BIGINT NOT NULL COMMENT '사용자 ID',
  `project_id` VARCHAR(100) COMMENT '프로젝트 ID',
  `title` VARCHAR(200) NOT NULL COMMENT '제목',
  `allowed_tools` TEXT COMMENT '허락한 도구',
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_chat_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) COMMENT='AI 채팅 세션';

CREATE TABLE `ai_chat_messages` (
  `id` BIGINT NOT NULL COMMENT '메시지 ID',
  `session_id` BIGINT NOT NULL COMMENT '세션 ID',
  `role` VARCHAR(20) NOT NULL COMMENT '역할',
  `blocks` TEXT COMMENT '내용 · 도구 호출 (JSON)',
  `stop_reason` VARCHAR(20) COMMENT '종료 이유',
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_message_session` FOREIGN KEY (`session_id`) REFERENCES `ai_chat_sessions` (`id`)
) COMMENT='AI 채팅 메시지';

CREATE TABLE `notifications` (
  `id` BIGINT NOT NULL COMMENT '알림 ID',
  `user_id` BIGINT NOT NULL COMMENT '받는 사람',
  `project_id` VARCHAR(100) COMMENT '프로젝트 ID',
  `kind` VARCHAR(40) NOT NULL COMMENT '종류 (실행/AI 작업)',
  `level` VARCHAR(10) NOT NULL COMMENT '수준',
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_notification_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) COMMENT='알림';

CREATE TABLE `site_analysis_run` (
  `id` BIGINT NOT NULL COMMENT '분석 ID',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `status` VARCHAR(20) NOT NULL COMMENT '상태',
  `commit_sha` VARCHAR(64) COMMENT '커밋',
  `framework` VARCHAR(30) COMMENT '프레임워크',
  `screen_count` INT NOT NULL COMMENT '찾은 화면 수',
  `llm_calls` INT COMMENT 'LLM 호출 수',
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_analysis_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`project_id`)
) COMMENT='사이트 분석 기록';

CREATE TABLE `site_node` (
  `id` BIGINT NOT NULL COMMENT '화면 ID',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `route_key` VARCHAR(500) NOT NULL COMMENT '화면 경로',
  `title` VARCHAR(300) COMMENT '화면 제목',
  `origin` VARCHAR(20) NOT NULL COMMENT '출처 (CODE/SITE/MANUAL)',
  `url` VARCHAR(1000) COMMENT '실제 주소',
  `screenshot` VARCHAR(300) COMMENT '화면 캡처',
  `elements` TEXT NOT NULL COMMENT '요소 · 셀렉터 · 확인 상태',
  `stale` BOOLEAN NOT NULL COMMENT '코드에서 사라짐',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_site_node_route` (`project_id`, `route_key`),
  CONSTRAINT `fk_node_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`project_id`)
) COMMENT='화면';

CREATE TABLE `site_edge` (
  `id` BIGINT NOT NULL COMMENT '전환 ID',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `from_route_key` VARCHAR(500) NOT NULL COMMENT '출발 화면',
  `to_route_key` VARCHAR(500) NOT NULL COMMENT '도착 화면',
  `label` VARCHAR(300) COMMENT '누르는 것',
  `selector` VARCHAR(700) COMMENT '셀렉터',
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_edge_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`project_id`)
) COMMENT='전환';

CREATE TABLE `site_layout` (
  `id` BIGINT NOT NULL COMMENT '공용 메뉴 ID',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `source_file` VARCHAR(700) NOT NULL COMMENT '레이아웃 파일',
  `route_keys` TEXT COMMENT '감싸는 화면',
  `links` TEXT COMMENT '메뉴 링크',
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_layout_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`project_id`)
) COMMENT='공용 메뉴';

CREATE TABLE `site_node_edit` (
  `id` BIGINT NOT NULL COMMENT '편집 ID',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `route_key` VARCHAR(500) NOT NULL COMMENT '화면 경로',
  `excluded` BOOLEAN NOT NULL COMMENT '테스트 제외',
  `note` VARCHAR(500) COMMENT '메모',
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_edit_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`project_id`)
) COMMENT='화면 사용자 편집';

CREATE TABLE `scenario_origin` (
  `id` BIGINT NOT NULL COMMENT '출처 ID',
  `project_id` VARCHAR(100) NOT NULL COMMENT '프로젝트 ID',
  `spec_path` VARCHAR(500) NOT NULL COMMENT 'spec 경로',
  `source` VARCHAR(20) COMMENT '출처 (AI 생성/녹화)',
  `route_keys` TEXT COMMENT '쓴 화면',
  `selector_keys` TEXT COMMENT '쓴 셀렉터',
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_origin_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`project_id`)
) COMMENT='테스트 출처';
