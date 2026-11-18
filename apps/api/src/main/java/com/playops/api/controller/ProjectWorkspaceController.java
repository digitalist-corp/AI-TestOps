package com.playops.api.controller;

import com.playops.api.dto.*;
import com.playops.api.util.PlaywrightGrep;
import com.playops.api.service.ExecutionQueryService;
import com.playops.api.service.FileStorageService;
import com.playops.api.service.PlaywrightScenarioService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/projects/{projectId}")
public class ProjectWorkspaceController {

    private final FileStorageService fileStorageService;
    private final PlaywrightScenarioService scenarioService;
    private final ExecutionQueryService executionQueryService;

    public ProjectWorkspaceController(
            FileStorageService fileStorageService,
            PlaywrightScenarioService scenarioService,
            ExecutionQueryService executionQueryService
    ) {
        this.fileStorageService = fileStorageService;
        this.scenarioService = scenarioService;
        this.executionQueryService = executionQueryService;
    }

    @GetMapping("/files/content")
    public ProjectFileContent readFile(
            @PathVariable String projectId,
            @RequestParam String path
    ) {
        return new ProjectFileContent(path, fileStorageService.readFile(projectId, path));
    }

    @PutMapping("/files/content")
    public ProjectFileContent saveFile(
            @PathVariable String projectId,
            @RequestParam String path,
            @RequestBody SaveFileRequest request
    ) {
        fileStorageService.writeFile(projectId, path, request.content());
        return new ProjectFileContent(path, fileStorageService.readFile(projectId, path));
    }

    @GetMapping("/scenarios")
    public ScenarioTreeResponse scenarios(@PathVariable String projectId) {
        return scenarioService.analyze(projectId);
    }

    @PutMapping("/scenarios/usage")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void updateScenarioUsage(
            @PathVariable String projectId,
            @RequestBody ScenarioUsageRequest request
    ) {
        scenarioService.updateUsage(
                projectId,
                request.nodeType(),
                request.specPath(),
                request.grep(),
                request.enabled()
        );
    }

    @GetMapping("/executions")
    public List<ExecutionResponse> executions(@PathVariable String projectId) {
        return executionQueryService.listByProject(projectId);
    }

    @DeleteMapping("/executions")
    public void resetExecutions(@PathVariable String projectId) {
        executionQueryService.resetProjectExecutions(projectId);
    }

    @PostMapping("/executions")
    public ExecutionResponse runTests(
            @PathVariable String projectId,
            @RequestBody(required = false) RunTestRequest request
    ) {
        String grep = request != null ? request.grep() : null;
        String specPath = request != null ? request.specPath() : null;
        List<String> specPaths = request != null ? request.specPaths() : null;
        if (request != null && request.cases() != null && !request.cases().isEmpty()) {
            grep = casesGrep(request.cases());
            specPath = null;
            specPaths = request.cases().stream().map(RunTestRequest.CaseKey::specPath).distinct().toList();
        }
        String caseTitle = request != null ? request.caseTitle() : null;
        boolean sequential = request != null && Boolean.TRUE.equals(request.sequential());
        return executionQueryService.triggerRun(projectId, grep, specPath, specPaths, caseTitle, sequential);
    }

    @GetMapping("/executions/history")
    public List<ExecutionResponse> executionHistory(
            @PathVariable String projectId,
            @RequestParam String grep
    ) {
        return executionQueryService.historyByGrep(projectId, grep);
    }

    /** executions.grep_filter 칸 길이 (V1 VARCHAR(500), ai_ro 뷰가 써서 넓히지 않는다) */
    private static final int MAX_GREP = 500;

    /**
     * 고른 케이스 · 묶음을 #135 정확 일치 패턴으로 — 비슷한 제목의 다른 케이스는 같이 돌지 않는다.
     * 칸을 넘으면 null: 이름 없이 고른 파일 단위로 돈다 (결함 다시 실행과 같은 처리, 더 돌 뿐 결과는 맞다 — #155).
     */
    static String casesGrep(List<RunTestRequest.CaseKey> cases) {
        String grep = PlaywrightGrep.anyOf(cases.stream()
                .map(c -> "DESCRIBE".equals(c.nodeType())
                        ? PlaywrightGrep.describeTitle(c.specPath(), c.grep())
                        : PlaywrightGrep.testTitle(c.specPath(), c.grep()))
                .distinct().toList());
        return grep != null && grep.length() > MAX_GREP ? null : grep;
    }
}
