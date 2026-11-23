-- 계정 역할에 PM 을 더한다 (ADMIN · PM · USER). 권한은 그대로 ADMIN 이냐 아니냐로만 갈린다.
-- 예전 Hibernate 가 만든 users_role_check(ADMIN · USER) 가 있는 DB 가 있어 다시 만든다.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('ADMIN', 'PM', 'USER'));

-- 이미 어느 프로젝트에서 PM 을 맡은 일반 계정은 PM 계정으로 바꾼다. 게스트는 팀원 계정이어야 하므로 뺀다.
UPDATE users
SET role = 'PM'
WHERE role = 'USER'
  AND username <> 'guest'
  AND id IN (SELECT user_id FROM project_members WHERE role = 'PM');
