package com.playops.api.service;

import com.playops.api.config.PlayOpsProperties;
import com.playops.api.repository.ExecutionCaseResultRepository;
import com.playops.api.repository.ExecutionRepository;
import com.playops.api.util.PlaywrightGrep;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

/**
 * 코드 리뷰 1번: 테스트 탭에서 케이스를 정확 일치(#149)로 돌리면 grep_filter 에 파일이 붙은 패턴이 저장된다.
 * 케이스 실행 이력은 예전 방식(키 그대로)과 그 케이스의 정확 일치 패턴을 둘 다 찾아야 한다.
 */
class CaseHistoryTest {

    @Test
    void historyFindsRunsSavedWithTheExactMatchPatternToo() {
        ExecutionRepository executions = mock(ExecutionRepository.class);
        ExecutionQueryService service = new ExecutionQueryService(executions, mock(ExecutionCaseResultRepository.class),
                mock(TestExecutionService.class), new PlayOpsProperties("p", "s", false,
                new PlayOpsProperties.Security("0123456789abcdef0123456789abcdef")));

        service.historyByGrep("p1", "시연 확인 로그인", "tests/demo.spec.ts");

        verify(executions).findByProjectIdAndGrepFilterInOrderByCreatedAtDesc("p1",
                List.of("시연 확인 로그인", PlaywrightGrep.testTitle("tests/demo.spec.ts", "시연 확인 로그인")));
    }
}
