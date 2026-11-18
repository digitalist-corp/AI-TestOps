package com.playops.api.dto;

import java.util.List;

/**
 * cases: 테스트 탭에서 고른 케이스 · 묶음. 있으면 grep · specPaths 대신 서버가 #135 정확 일치 패턴을 만든다 (3차 2번).
 */
public record RunTestRequest(String grep, String specPath, List<String> specPaths, String caseTitle, Boolean sequential,
                             List<CaseKey> cases) {

    /** nodeType: TEST | DESCRIBE. grep 은 시나리오의 케이스 키(상위 묶음 + 제목) */
    public record CaseKey(String specPath, String grep, String nodeType) {}
}
