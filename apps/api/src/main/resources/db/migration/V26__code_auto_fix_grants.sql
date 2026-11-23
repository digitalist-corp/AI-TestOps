-- 코드 자동 수정 사용권: 팀원이 요청하고 같은 프로젝트 PM(· 관리자)이 범위를 정해 부여 · 거절 · 회수한다.
-- 멤버십에 묶는다: 멤버 행이 지워지면 함께 지워지고, member_since 가 지금 멤버 행의 가입 시각과 달라도(다시 가입) 쓰지 않는다.
-- scopes: AUTO_FIX(자동 수정 · 재검증 요청), PR_PUBLISH(검증 후 PR 게시 요청, diff 마다 PM · 관리자 승인은 따로). 기본은 없음.
CREATE TABLE code_auto_fix_grants (
    id            BIGSERIAL PRIMARY KEY,
    project_id    VARCHAR(100) NOT NULL,
    user_id       BIGINT       NOT NULL,
    status        VARCHAR(10)  NOT NULL CHECK (status IN ('PENDING', 'GRANTED', 'REJECTED', 'REVOKED')),
    scopes        VARCHAR(100),
    member_since  TIMESTAMPTZ  NOT NULL,
    note          VARCHAR(500),
    requested_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    decided_by    BIGINT,
    decided_at    TIMESTAMPTZ,
    CONSTRAINT uk_code_auto_fix_grants_member UNIQUE (project_id, user_id),
    CONSTRAINT fk_code_auto_fix_grants_member FOREIGN KEY (project_id, user_id)
        REFERENCES project_members (project_id, user_id) ON DELETE CASCADE
);
