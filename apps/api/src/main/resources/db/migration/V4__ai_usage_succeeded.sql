-- =====================================================================
-- V4__ai_usage_succeeded.sql
-- V1 기준선에서 빠진 ai_usage.succeeded(호출 성공 여부) 컬럼을 채운다.
-- hibernate ddl-auto=update 로 만든 기존 DB 에는 이미 있으므로 IF NOT EXISTS 로 건너뛴다.
-- =====================================================================

ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS succeeded BOOLEAN NOT NULL DEFAULT TRUE;
