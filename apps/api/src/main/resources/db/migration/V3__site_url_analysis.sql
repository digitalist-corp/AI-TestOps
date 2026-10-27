-- =====================================================================
-- V3__site_url_analysis.sql
-- URL 기반 사이트 탐색(SITE_ANALYSIS) 결과 보관: 폼 구조 · 접근성 트리 · 스크린샷
-- =====================================================================

ALTER TABLE site_node ADD COLUMN IF NOT EXISTS url VARCHAR(1000);
ALTER TABLE site_node ADD COLUMN IF NOT EXISTS forms TEXT;
ALTER TABLE site_node ADD COLUMN IF NOT EXISTS aria_snapshot TEXT;
ALTER TABLE site_node ADD COLUMN IF NOT EXISTS screenshot VARCHAR(300);
