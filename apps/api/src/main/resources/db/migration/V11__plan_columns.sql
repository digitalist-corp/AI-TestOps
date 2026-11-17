-- 계획 표(F-1): 케이스(TEST 행) 하나를 계획 항목 하나로 보고 순서 · 담당자 · 마감일 · 우선순위를 붙인다.
ALTER TABLE scenario_case_settings
    ADD COLUMN sort_order INT,
    ADD COLUMN assignee VARCHAR(100),
    ADD COLUMN due_date DATE,
    ADD COLUMN priority VARCHAR(10);
