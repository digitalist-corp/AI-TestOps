-- 3-1 보안: 기본 비밀번호(admin)로 만든 관리자는 비밀번호를 바꾸기 전에 다른 API 를 못 쓴다.
ALTER TABLE users ADD COLUMN password_change_required BOOLEAN NOT NULL DEFAULT FALSE;
