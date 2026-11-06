-- 시스템이 스스로 만든 AI 작업(수정 제안 등)을 표시한다. 이런 작업은 자동 적용이 켜져 있어도 사람 검토를 거친다. (D-03)
ALTER TABLE ai_jobs ADD COLUMN IF NOT EXISTS auto_created boolean NOT NULL DEFAULT false;
-- 지금까지 자동으로 만든 것은 수정 제안뿐이고, 진행 전에는 요청자가 비어 있다.
UPDATE ai_jobs SET auto_created = true WHERE status = 'PROPOSED' AND requested_by IS NULL;
