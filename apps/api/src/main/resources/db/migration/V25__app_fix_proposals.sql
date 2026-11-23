-- 제품 코드 수정안 1단계: 결함 하나(파일 + grep)의 실패 실행 · 대상 소스 기준 커밋에 대한 진단과 검토용 diff.
-- Playwright 테스트를 고치는 ai_jobs(CODE_FIX)와 따로 둔다. 원격 저장소에는 쓰지 않는다.
-- identity_key: 프로젝트 · 결함 · 실패 실행 · 저장소 · 브랜치 · 기준 SHA. 같은 요청이 동시에 와도 하나만 만든다.
-- 프로젝트와 함께 지운다: 새 프로젝트 id 는 "가장 큰 번호 + 1" 이라 지운 번호가 다시 쓰일 수 있다.
CREATE TABLE app_fix_proposals (
    id                 BIGSERIAL PRIMARY KEY,
    project_id         VARCHAR(100) NOT NULL REFERENCES projects (project_id) ON DELETE CASCADE,
    spec_path          VARCHAR(500) NOT NULL,
    grep               VARCHAR(500) NOT NULL,
    execution_id       BIGINT       NOT NULL,
    identity_key       VARCHAR(64)  NOT NULL,
    category           VARCHAR(20)  NOT NULL,
    status             VARCHAR(20)  NOT NULL,
    verification       VARCHAR(20),
    source_repository  VARCHAR(200),
    source_branch      VARCHAR(100),
    source_sha         VARCHAR(40),
    app_root           VARCHAR(500),
    evidence           TEXT,
    summary            TEXT,
    causes             TEXT,
    checks             TEXT,
    files              TEXT,
    limitation         TEXT,
    error_message      TEXT,
    requested_by       BIGINT,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_app_fix_proposals_identity UNIQUE (identity_key)
);
CREATE INDEX idx_app_fix_proposals_defect ON app_fix_proposals (project_id, spec_path, grep, id DESC);

-- 앱 소스 저장소 안의 앱 폴더 (모노레포). 비우면 package.json 으로 찾는다 (ScreenFinder)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS source_app_root VARCHAR(500);
