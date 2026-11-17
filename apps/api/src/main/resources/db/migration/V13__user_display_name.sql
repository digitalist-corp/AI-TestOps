-- 회원가입(#103): 아이디와 따로 화면에 보일 이름. V12 는 B트랙(재실행 링크)에 예약돼 있어 건너뛴다.
ALTER TABLE users ADD COLUMN display_name VARCHAR(100);
