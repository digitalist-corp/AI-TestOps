-- 학습 루프 기억 (E-04 ~ E-06). 서명 = FailureRules.signature 의 key.
-- ai_fix_memory: 사람이 승인해 반영한 CODE_FIX 와 그때의 실패 서명. 되돌리면 지운다. 다음 같은 · 비슷한 실패의 예시가 된다.
CREATE TABLE ai_fix_memory (
    id          BIGSERIAL PRIMARY KEY,
    project_id  VARCHAR(100) NOT NULL,
    signature   VARCHAR(12)  NOT NULL,
    head        TEXT,
    locator     TEXT,
    spec_path   VARCHAR(500),
    cause       VARCHAR(20)  NOT NULL,
    ai_job_id   BIGINT       NOT NULL UNIQUE REFERENCES ai_jobs (id) ON DELETE CASCADE,
    diff        TEXT,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_ai_fix_memory_project ON ai_fix_memory (project_id, signature);

-- ai_classify_feedback: 사람이 고친 원인. 같은 서명은 프로젝트마다 하나(마지막 값).
CREATE TABLE ai_classify_feedback (
    id          BIGSERIAL PRIMARY KEY,
    project_id  VARCHAR(100) NOT NULL,
    signature   VARCHAR(12)  NOT NULL,
    cause       VARCHAR(20)  NOT NULL,
    user_id     BIGINT,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_ai_classify_feedback UNIQUE (project_id, signature)
);
