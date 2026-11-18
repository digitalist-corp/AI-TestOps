-- 선택 재실행(#82): 다시 실행한 실행이 어느 실행의 실패를 다시 돌린 것인지. 원래 실행을 지우면 연결만 끊는다.
-- V12 · V15 는 비워 둔다 (V19 까지 배포돼서 낮은 번호를 새로 만들면 Flyway 가 거부한다).
ALTER TABLE executions ADD COLUMN rerun_of BIGINT;
ALTER TABLE executions ADD CONSTRAINT fk_executions_rerun_of
    FOREIGN KEY (rerun_of) REFERENCES executions (id) ON DELETE SET NULL;
CREATE INDEX idx_executions_rerun_of ON executions (rerun_of);
