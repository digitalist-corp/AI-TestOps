-- 프로젝트 멤버(#104): 프로젝트마다 PM · 팀원을 둔다. 전역 역할(ADMIN · USER)과 따로다.
-- V12 는 B트랙(재실행 링크)에 예약, V13 은 #103(users.display_name).
CREATE TABLE project_members (
    project_id VARCHAR(100) NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    user_id    BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       VARCHAR(10)  NOT NULL CHECK (role IN ('PM', 'MEMBER')),
    created_by BIGINT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_by BIGINT,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id)
);
CREATE INDEX idx_project_members_user ON project_members (user_id);

-- 기존 프로젝트 이관: 만든 사람(owner_user_id)이 있으면 그 사람을, 없으면 가장 먼저 만든 관리자를 PM 으로.
INSERT INTO project_members (project_id, user_id, role)
SELECT p.project_id,
       COALESCE(
           (SELECT u.id FROM users u WHERE u.id = p.owner_user_id),
           (SELECT MIN(u.id) FROM users u WHERE u.role = 'ADMIN')
       ),
       'PM'
FROM projects p
WHERE COALESCE(
          (SELECT u.id FROM users u WHERE u.id = p.owner_user_id),
          (SELECT MIN(u.id) FROM users u WHERE u.role = 'ADMIN')
      ) IS NOT NULL;
