-- 계획 담당자를 프로젝트 멤버 계정과 잇는다(#119). 기존 assignee 글자는 지우지 않는다 (못 이은 행은 화면에 "(계정 없음) 이름").
ALTER TABLE scenario_case_settings ADD COLUMN assignee_user_id BIGINT;
ALTER TABLE scenario_case_settings ADD CONSTRAINT fk_scenario_case_settings_assignee
    FOREIGN KEY (assignee_user_id) REFERENCES users (id) ON DELETE SET NULL;
CREATE INDEX idx_scenario_case_settings_assignee ON scenario_case_settings (assignee_user_id);

-- 이관: 글자가 그 프로젝트 멤버의 아이디나 표시 이름과 같은 사람이 꼭 한 명일 때만 잇는다.
UPDATE scenario_case_settings s
SET assignee_user_id = (
    SELECT MIN(u.id) FROM project_members m JOIN users u ON u.id = m.user_id
    WHERE m.project_id = s.project_id AND TRIM(s.assignee) IN (u.username, u.display_name))
WHERE s.assignee IS NOT NULL
  AND (SELECT COUNT(DISTINCT u.id) FROM project_members m JOIN users u ON u.id = m.user_id
       WHERE m.project_id = s.project_id AND TRIM(s.assignee) IN (u.username, u.display_name)) = 1;
