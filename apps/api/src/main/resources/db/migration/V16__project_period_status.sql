-- 프로젝트 기간 · 상태(#117): 계획(PLANNED) · 실행(RUNNING) · 종료(CLOSED). 기존 프로젝트는 계획으로 시작한다.
-- V12 · V15 는 B트랙에 예약.
ALTER TABLE projects ADD COLUMN start_date DATE;
ALTER TABLE projects ADD COLUMN end_date DATE;
ALTER TABLE projects ADD COLUMN status VARCHAR(10) NOT NULL DEFAULT 'PLANNED';
ALTER TABLE projects ADD CONSTRAINT chk_projects_status CHECK (status IN ('PLANNED', 'RUNNING', 'CLOSED'));
ALTER TABLE projects ADD CONSTRAINT chk_projects_period CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date);
