package com.playops.api.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.playops.api.dto.AiJobFileDiff;
import com.playops.api.entity.AiJob;
import com.playops.api.entity.AiJobStatus;
import com.playops.api.entity.AiJobType;
import com.playops.api.entity.Project;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.AiJobRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.PathMatcher;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Service
public class AiJobService {

    private static final Logger log = LoggerFactory.getLogger(AiJobService.class);

    private final AiJobRepository aiJobRepository;
    private final ProjectService projectService;
    private final ExecutionLogService executionLogService;
    private final AiRunnerDockerService aiRunnerDockerService;
    private final AiDiffRiskEvaluatorService riskEvaluatorService;
    private final AiPostApplyVerificationService postApplyVerificationService;
    private final SlackNotificationService slackNotificationService;
    private final GitCommitService gitCommitService;
    private final LlmGatewayService llmGatewayService;
    private final SiteMapPromptService siteMapPromptService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * 자기 자신의 Spring 프록시.
     *
     * @Async 는 프록시를 거쳐 호출될 때만 동작한다. 같은 클래스 안에서 this.runAsync() 로 부르면
     * 프록시를 건너뛰어 그냥 같은 스레드에서 실행되고, 그 결과 작업을 "만들기만" 하려던 요청이
     * Docker 이미지 빌드와 AI 호출이 끝날 때까지 몇 분씩 막힌다.
     * 순환 참조를 피하기 위해 @Lazy 로 늦게 주입받는다.
     */
    private final AiJobService self;

    public AiJobService(
            AiJobRepository aiJobRepository,
            ProjectService projectService,
            ExecutionLogService executionLogService,
            AiRunnerDockerService aiRunnerDockerService,
            AiDiffRiskEvaluatorService riskEvaluatorService,
            AiPostApplyVerificationService postApplyVerificationService,
            SlackNotificationService slackNotificationService,
            GitCommitService gitCommitService,
            LlmGatewayService llmGatewayService,
            SiteMapPromptService siteMapPromptService,
            @Lazy AiJobService self
    ) {
        this.aiJobRepository = aiJobRepository;
        this.projectService = projectService;
        this.executionLogService = executionLogService;
        this.aiRunnerDockerService = aiRunnerDockerService;
        this.riskEvaluatorService = riskEvaluatorService;
        this.postApplyVerificationService = postApplyVerificationService;
        this.slackNotificationService = slackNotificationService;
        this.gitCommitService = gitCommitService;
        this.llmGatewayService = llmGatewayService;
        this.siteMapPromptService = siteMapPromptService;
        this.self = self;
    }

    /**
     * AI Runner 컨테이너가 /internal/ai-jobs/{jobId}/... 를 호출할 때 쓰는 job-scoped 토큰 검증.
     * 사용자 로그인 토큰과는 별개 체계다 (컨테이너는 사용자 계정이 없다).
     */
    public AiJob validateCallbackToken(Long jobId, String token) {
        if (token == null || token.isBlank()) {
            throw new ApiException(401, "콜백 토큰이 없습니다.");
        }
        AiJob job = aiJobRepository.findByIdAndCallbackToken(jobId, token)
                .orElseThrow(() -> new ApiException(401, "콜백 토큰이 유효하지 않습니다."));
        if (job.getCallbackTokenExpiresAt() == null || job.getCallbackTokenExpiresAt().isBefore(Instant.now())) {
            throw new ApiException(401, "콜백 토큰이 만료되었습니다.");
        }
        return job;
    }

    public List<AiJob> listByProject(String projectId) {
        return aiJobRepository.findByProjectIdOrderByCreatedAtDesc(projectId);
    }

    public List<AiJob> listNeedsReview() {
        return aiJobRepository.findByStatusOrderByCreatedAtAsc(AiJobStatus.NEEDS_REVIEW);
    }

    public AiJob createCodeFixJob(String projectId, Long failedExecutionId, String targetSpecPath, String instruction, Long requestedBy) {
        Project project = projectService.getProject(projectId);

        AiJob job = new AiJob();
        job.setProjectId(projectId);
        job.setJobType(AiJobType.CODE_FIX);
        job.setStatus(AiJobStatus.PENDING);
        job.setInstruction(instruction);
        job.setTargetSpecPath(targetSpecPath);
        job.setFailedExecutionId(failedExecutionId);
        job.setAiModelProvider(project.getAiModelProvider());
        job.setRequestedBy(requestedBy);
        job.setCallbackToken(UUID.randomUUID().toString());
        job.setCallbackTokenExpiresAt(Instant.now().plus(30, ChronoUnit.MINUTES));
        job = aiJobRepository.save(job);

        self.runAsync(job.getId());
        return job;
    }

    @Async("aiJobExecutor")
    public void runAsync(Long jobId) {
        AiJob job = aiJobRepository.findById(jobId).orElse(null);
        if (job == null) {
            return;
        }
        Project project;
        try {
            project = projectService.getProject(job.getProjectId());
        } catch (ApiException e) {
            markError(job, "프로젝트를 찾을 수 없습니다: " + job.getProjectId());
            return;
        }

        job.setStatus(AiJobStatus.RUNNING);
        aiJobRepository.save(job);

        String failureLog = "";
        if (job.getFailedExecutionId() != null) {
            try {
                failureLog = executionLogService.readLog(job.getFailedExecutionId(), 0).content();
            } catch (Exception e) {
                log.warn("AI job {} - 실패 로그 조회 실패: {}", jobId, e.getMessage());
            }
        }

        try {
            aiRunnerDockerService.runJob(job, project, failureLog);
        } catch (Exception e) {
            log.error("AI job {} 컨테이너 실행 실패", jobId, e);
            markError(job, e.getMessage());
            return;
        }

        processResult(job, project);
    }

    /**
     * "자연어 시나리오 기반 템플릿 생성" 경량판: CODE_FIX처럼 Docker 샌드박스에서 반복 실행/자가검증하지
     *않고, api 프로세스 안에서 LlmGatewayService를 1회 동기 호출해 새 spec 파일 하나를 생성한다.
     * 생성 결과는 CODE_FIX와 동일한 diff 저장 규약(result/files/{safeFileName})을 그대로 따르므로
     * 이후 검토/승인/git-commit 파이프라인은 전부 재사용된다.
     */
    public AiJob createTemplateGenerateJob(String projectId, String targetSpecPath, String instruction, Long requestedBy) {
        return createTemplateGenerateJob(projectId, targetSpecPath, instruction, null, requestedBy);
    }

    /** @param routeKeys 구조 분석에서 고른 화면. null 이나 빈 목록이면 분석된 모든 화면을 참고한다. */
    public AiJob createTemplateGenerateJob(String projectId, String targetSpecPath, String instruction,
                                           List<String> routeKeys, Long requestedBy) {
        Project project = projectService.getProject(projectId);
        if (targetSpecPath == null || targetSpecPath.isBlank()) {
            throw new ApiException(400, "생성할 spec 파일 경로를 입력하세요.");
        }
        String normalizedPath = targetSpecPath.trim();
        if (normalizedPath.contains("..")) {
            throw new ApiException(400, "spec 경로에 '..'를 사용할 수 없습니다.");
        }
        if (instruction == null || instruction.isBlank()) {
            throw new ApiException(400, "생성할 시나리오에 대한 요구사항을 입력하세요.");
        }

        AiJob job = new AiJob();
        job.setProjectId(projectId);
        job.setJobType(AiJobType.TEMPLATE_GENERATE);
        job.setStatus(AiJobStatus.RUNNING);
        job.setInstruction(instruction);
        job.setTargetSpecPath(normalizedPath);
        if (routeKeys != null && !routeKeys.isEmpty()) {
            try {
                job.setRouteKeys(objectMapper.writeValueAsString(routeKeys));
            } catch (IOException ignored) {}
        }
        job.setAiModelProvider(project.getAiModelProvider());
        job.setRequestedBy(requestedBy);
        job = aiJobRepository.save(job);

        self.runTemplateGenerationAsync(job.getId());
        return job;
    }

    @Async("aiJobExecutor")
    public void runTemplateGenerationAsync(Long jobId) {
        AiJob job = aiJobRepository.findById(jobId).orElse(null);
        if (job == null) {
            return;
        }
        Project project;
        try {
            project = projectService.getProject(job.getProjectId());
        } catch (ApiException e) {
            markError(job, "프로젝트를 찾을 수 없습니다: " + job.getProjectId());
            return;
        }

        String generatedContent;
        try {
            generatedContent = generateSpecContent(project, job.getTargetSpecPath(), job.getInstruction(), routeKeysOf(job));
        } catch (Exception e) {
            markError(job, "AI 생성 실패: " + e.getMessage());
            return;
        }

        Path filesDir = aiRunnerDockerService.aiJobDir(job.getId()).resolve("result").resolve("files");
        try {
            Files.createDirectories(filesDir);
            Files.writeString(filesDir.resolve(safeFileName(job.getTargetSpecPath())), generatedContent);
        } catch (IOException e) {
            markError(job, "생성 결과 저장 실패: " + e.getMessage());
            return;
        }

        job.setDiffPath(filesDir.toString());
        try {
            job.setChangedFiles(objectMapper.writeValueAsString(List.of(job.getTargetSpecPath())));
        } catch (IOException ignored) {}
        job.setSummary("AI가 자연어 요구사항으로 새 spec 파일을 생성했습니다: " + job.getTargetSpecPath());

        List<AiDiffRiskEvaluatorService.FileChange> fileChanges = List.of(
                new AiDiffRiskEvaluatorService.FileChange(job.getTargetSpecPath(), "", generatedContent));
        AiDiffRiskEvaluatorService.Assessment assessment = riskEvaluatorService.evaluate(
                fileChanges, 1, project.getAiMaxIterations());
        List<String> allFlags = new ArrayList<>(assessment.hardGateFlags());
        allFlags.addAll(assessment.softNotes());
        // 화면 정보에 없는 셀렉터는 지어냈을 수 있으니 검토자에게 알린다. 어느 화면의 셀렉터를 썼는지도 남긴다.
        SiteMapPromptService.SelectorCheck check = siteMapPromptService.check(project.getProjectId(), generatedContent);
        if (!check.unknown().isEmpty() && !siteMapPromptService.context(project.getProjectId(), List.of()).isBlank()) {
            allFlags.add("화면 정보에 없는 셀렉터 " + check.unknown().size() + "개: "
                    + String.join(", ", check.unknown().subList(0, Math.min(5, check.unknown().size()))));
        }
        siteMapPromptService.recordOrigin(project.getProjectId(), job.getTargetSpecPath(), routeKeysOf(job), check.used());
        try {
            job.setRiskFlags(objectMapper.writeValueAsString(allFlags));
        } catch (IOException ignored) {}

        boolean autoApplyCandidate = !assessment.hasHardGate() && assessment.withinQuantitativeLimits(project);
        if (autoApplyCandidate && project.getAiAutoApplyEnabled()) {
            applyDiff(job, project);
            job.setStatus(AiJobStatus.APPLIED);
            aiJobRepository.save(job);
            // 새 파일 생성은 기존 케이스를 건드리지 않으므로(diff의 before가 항상 빈 문자열) CODE_FIX와 달리
            // 사후 회귀검증을 트리거하지 않는다 — 새로 추가된 파일 자체는 baseline 비교에서도 항상 제외 대상이다.
            return;
        }

        job.setStatus(AiJobStatus.NEEDS_REVIEW);
        aiJobRepository.save(job);
        slackNotificationService.send(
                ":large_yellow_circle: [" + project.getProjectName() + "] AI 시나리오 생성 검토 필요 — job #" + job.getId()
                        + "\n생성 대상: " + job.getTargetSpecPath()
                        + "\nAI-TestOps > AI 검토 메뉴에서 승인/거부해주세요."
        );
    }

    private List<String> routeKeysOf(AiJob job) {
        try {
            return job.getRouteKeys() == null ? List.of()
                    : objectMapper.readValue(job.getRouteKeys(), new com.fasterxml.jackson.core.type.TypeReference<>() {});
        } catch (IOException e) {
            return List.of();
        }
    }

    private String generateSpecContent(Project project, String targetSpecPath, String instruction, List<String> routeKeys) {
        String systemPrompt = """
                You are an expert QA automation engineer specializing in Playwright v%s and TypeScript,
                working inside an existing AI-TestOps-managed test project.
                Generate ONE complete, executable Playwright spec file to be saved at "%s",
                implementing the user's natural-language scenario request.
                Return ONLY the raw TypeScript code for that file — no markdown code fences, no explanation, no JSON wrapper.
                """.formatted(project.getPlaywrightVersion(), targetSpecPath);

        // 구조 분석 결과가 있으면 추측 대신 코드에서 확인한 셀렉터를 쓰게 한다.
        String screens = siteMapPromptService.context(project.getProjectId(), routeKeys);
        if (!screens.isBlank()) {
            systemPrompt += """

                    The user message includes a "화면 정보" section. It lists the app's screens and the locators
                    that were confirmed to exist in the app's source code.
                    - To click, fill, or otherwise act on the page, use ONLY locators listed there, written exactly as listed
                      (prefix them with `page.`). Do not invent locators or CSS selectors.
                    - If the request needs an element that is not listed, leave that step out and say so in a code comment
                      rather than guessing a locator.
                    - Navigate with `page.goto('<route>')` using the listed routes. A route with a `:param` needs a real value;
                      skip it unless the request or the project description provides one.
                    - A locator marked as appearing several times on the screen must be narrowed (for example with `.first()`),
                      and one marked as conditional must not be assumed to be present.
                    """;
        }

        String userPrompt = "프로젝트명: " + project.getProjectName()
                + "\n프로젝트 설명: " + (project.getDescription() != null ? project.getDescription() : "-")
                + "\n테스트 목적: " + (project.getTestPurpose() != null ? project.getTestPurpose() : "-")
                + "\nBase URL: " + (project.getBaseUrl() != null ? project.getBaseUrl() : "-")
                + "\n생성할 파일 경로: " + targetSpecPath
                + "\n요구사항: " + instruction
                + (screens.isBlank() ? "" : "\n\n화면 정보\n" + screens);

        String raw = llmGatewayService.chat(project.getAiModelProvider(), systemPrompt, userPrompt,
                "코드 수정", project.getProjectId());
        return stripMarkdownFence(raw);
    }

    private String stripMarkdownFence(String raw) {
        String trimmed = raw.trim();
        if (trimmed.startsWith("```")) {
            trimmed = trimmed.replaceFirst("^```(typescript|ts|javascript|js)?", "").trim();
            if (trimmed.endsWith("```")) {
                trimmed = trimmed.substring(0, trimmed.length() - 3).trim();
            }
        }
        return trimmed;
    }

    private void processResult(AiJob job, Project project) {
        Path resultFile = aiRunnerDockerService.aiJobDir(job.getId()).resolve("result").resolve("result.json");
        if (!Files.exists(resultFile)) {
            markError(job, "AI Runner가 결과 파일을 남기지 않았습니다.");
            return;
        }

        JsonNode result;
        try {
            result = objectMapper.readTree(Files.readString(resultFile));
        } catch (IOException e) {
            markError(job, "결과 파일 파싱 실패: " + e.getMessage());
            return;
        }

        String status = result.path("status").asText("ERROR");
        job.setIterationsUsed(result.path("iterationsUsed").asInt(0));
        job.setSummary(result.path("summary").isNull() ? null : result.path("summary").asText(null));

        if (!"DIFF_READY".equals(status)) {
            job.setStatus("ERROR".equals(status) ? AiJobStatus.ERROR : AiJobStatus.FAILED);
            job.setErrorMessage(result.path("error").isNull() ? null : result.path("error").asText(null));
            aiJobRepository.save(job);
            return;
        }

        List<String> changedFiles = new ArrayList<>();
        result.path("changedFiles").forEach(node -> changedFiles.add(node.asText()));

        List<String> violations = validatePaths(changedFiles, project);
        if (!violations.isEmpty()) {
            job.setStatus(AiJobStatus.REJECTED);
            job.setErrorMessage("allowedPathGlobs/deniedPathGlobs 위반: " + violations);
            try {
                job.setRiskFlags(objectMapper.writeValueAsString(violations));
            } catch (IOException ignored) {}
            aiJobRepository.save(job);
            return;
        }

        job.setDiffPath(aiRunnerDockerService.aiJobDir(job.getId()).resolve("result").resolve("files").toString());
        try {
            job.setChangedFiles(objectMapper.writeValueAsString(changedFiles));
        } catch (IOException ignored) {}

        boolean targetCaseFixed = result.path("targetCaseFixed").asBoolean(true);
        if (!targetCaseFixed) {
            job.setStatus(AiJobStatus.REJECTED);
            job.setErrorMessage("목표 케이스가 여전히 실패합니다 (targetCaseFixed=false).");
            aiJobRepository.save(job);
            return;
        }

        List<AiDiffRiskEvaluatorService.FileChange> fileChanges = new ArrayList<>();
        for (String file : changedFiles) {
            fileChanges.add(new AiDiffRiskEvaluatorService.FileChange(
                    file, readLiveFile(project, file), readResultFileContent(job, file)));
        }

        AiDiffRiskEvaluatorService.Assessment assessment = riskEvaluatorService.evaluate(
                fileChanges, job.getIterationsUsed(), project.getAiMaxIterations());
        List<String> allFlags = new ArrayList<>(assessment.hardGateFlags());
        allFlags.addAll(assessment.softNotes());
        try {
            job.setRiskFlags(objectMapper.writeValueAsString(allFlags));
        } catch (IOException ignored) {}

        boolean autoApplyCandidate = !assessment.hasHardGate() && assessment.withinQuantitativeLimits(project);
        if (autoApplyCandidate && project.getAiAutoApplyEnabled()) {
            applyDiff(job, project);
            job.setStatus(AiJobStatus.APPLIED);
            job.setReviewedBy(null);
            AiJob saved = aiJobRepository.save(job);
            postApplyVerificationService.triggerVerification(saved, project);
            return;
        }

        job.setStatus(AiJobStatus.NEEDS_REVIEW);
        aiJobRepository.save(job);

        String reason;
        if (assessment.hasHardGate()) {
            reason = String.join(", ", assessment.hardGateFlags());
        } else if (!assessment.withinQuantitativeLimits(project)) {
            reason = "변경 규모 임계값 초과 (changedLines=" + assessment.changedLines() + ", changedFiles=" + assessment.changedFiles() + ")";
        } else {
            reason = "자동 적용이 꺼져 있어 검토가 필요합니다 (Project.aiAutoApplyEnabled=false)";
        }
        slackNotificationService.send(
                ":large_yellow_circle: [" + project.getProjectName() + "] AI 수정 검토 필요 — job #" + job.getId()
                        + "\n대상: " + job.getTargetSpecPath()
                        + "\n사유: " + reason
                        + "\nAI-TestOps > AI 검토 메뉴에서 승인/거부해주세요."
        );
    }

    private String readLiveFile(Project project, String relativePath) {
        try {
            Path file = projectService.getProjectPath(project.getProjectId()).resolve(relativePath);
            return Files.exists(file) ? Files.readString(file) : "";
        } catch (IOException e) {
            log.warn("프로젝트 {} - 원본 파일 조회 실패 ({}): {}", project.getProjectId(), relativePath, e.getMessage());
            return "";
        }
    }

    private String readResultFileContent(AiJob job, String targetSpecPath) {
        Path file = Path.of(job.getDiffPath(), safeFileName(targetSpecPath));
        try {
            return Files.exists(file) ? Files.readString(file) : "";
        } catch (IOException e) {
            log.warn("AI job {} - 결과 파일 조회 실패: {}", job.getId(), e.getMessage());
            return "";
        }
    }

    private String safeFileName(String targetSpecPath) {
        return targetSpecPath.replace("/", "__").replace("\\", "__");
    }

    /** job.getChangedFiles()(JSON 배열)를 파싱한다. 값이 없으면(과거 단일파일 job) targetSpecPath 하나짜리로 대체한다. */
    List<String> parseChangedFiles(AiJob job) {
        List<String> files = new ArrayList<>();
        if (job.getChangedFiles() != null && !job.getChangedFiles().isBlank()) {
            try {
                objectMapper.readTree(job.getChangedFiles()).forEach(node -> files.add(node.asText()));
            } catch (IOException ignored) {}
        }
        if (files.isEmpty() && job.getTargetSpecPath() != null) {
            files.add(job.getTargetSpecPath());
        }
        return files;
    }

    /**
     * NEEDS_REVIEW 승인이든 자동 적용이든 동일하게 사용하는 diff 반영 로직 (멀티파일 지원).
     * 되돌림(안전망)을 위해 파일마다 적용 직전 내용을 스냅샷으로 남기고, git 연동 프로젝트면 커밋/푸시까지 수행한다.
     */
    private void applyDiff(AiJob job, Project project) {
        List<String> changedFiles = parseChangedFiles(job);
        Path snapshotDir = aiRunnerDockerService.aiJobDir(job.getId()).resolve("pre-apply-snapshot");
        try {
            Files.createDirectories(snapshotDir);
            for (String file : changedFiles) {
                Path sourceFile = Path.of(job.getDiffPath(), safeFileName(file));
                Path targetFile = projectService.getProjectPath(job.getProjectId()).resolve(file);
                Files.createDirectories(targetFile.getParent());
                if (Files.exists(targetFile)) {
                    Files.copy(targetFile, snapshotDir.resolve(safeFileName(file)), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                }
                Files.copy(sourceFile, targetFile, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException e) {
            throw new ApiException(500, "diff 적용 실패: " + e.getMessage());
        }

        try {
            String commitMessage = "AI fix: " + job.getTargetSpecPath() + " (AI-TestOps job #" + job.getId() + ")"
                    + (job.getSummary() != null && !job.getSummary().isBlank() ? "\n\n" + job.getSummary() : "");
            String sha = gitCommitService.commitAndPush(project, changedFiles, commitMessage);
            if (sha != null) {
                job.setAppliedCommitSha(sha);
            }
        } catch (Exception e) {
            log.warn("AI job {} git commit/push 실패: {}", job.getId(), e.getMessage());
            slackNotificationService.send(
                    ":warning: [" + project.getProjectName() + "] AI 적용 후 git push 실패 (파일은 로컬에는 정상 반영됨) — job #" + job.getId()
                            + "\n" + e.getMessage()
            );
        }
    }

    private List<String> validatePaths(List<String> changedFiles, Project project) {
        List<String> allowed = parseGlobList(project.getAiAllowedPathGlobs());
        List<String> denied = parseGlobList(project.getAiDeniedPathGlobs());
        List<String> violations = new ArrayList<>();

        for (String file : changedFiles) {
            Path relative = Path.of(file);
            boolean isDenied = denied.stream().anyMatch(glob -> matches(relative, glob));
            boolean isAllowed = allowed.isEmpty() || allowed.stream().anyMatch(glob -> matches(relative, glob));
            if (isDenied || !isAllowed) {
                violations.add(file);
            }
        }
        return violations;
    }

    private boolean matches(Path relative, String glob) {
        try {
            PathMatcher matcher = FileSystems.getDefault().getPathMatcher("glob:" + glob);
            return matcher.matches(relative);
        } catch (Exception e) {
            return false;
        }
    }

    private List<String> parseGlobList(String json) {
        List<String> globs = new ArrayList<>();
        if (json == null || json.isBlank()) {
            return globs;
        }
        try {
            objectMapper.readTree(json).forEach(node -> globs.add(node.asText()));
        } catch (IOException ignored) {}
        return globs;
    }

    public AiJob approve(Long jobId, Long approvedByUserId) {
        AiJob job = getJobOrThrow(jobId);
        if (job.getStatus() != AiJobStatus.NEEDS_REVIEW) {
            throw new ApiException(400, "검토 대기 상태의 job만 승인할 수 있습니다. 현재 상태: " + job.getStatus());
        }

        Project project = projectService.getProject(job.getProjectId());
        applyDiff(job, project);

        job.setStatus(AiJobStatus.APPLIED);
        job.setReviewedBy(approvedByUserId);
        AiJob saved = aiJobRepository.save(job);

        // 사람이 승인한 적용도 자동 적용과 동일하게 사후 검증(안전망)을 거친다 — 리뷰어도 diff만 보고는
        // 다른 spec에 미치는 영향까지 알기 어렵기 때문 (docs/ai-job-spec.md의 "적용 범위" 참고).
        postApplyVerificationService.triggerVerification(saved, project);

        return saved;
    }

    public AiJob reject(Long jobId, Long rejectedByUserId) {
        AiJob job = getJobOrThrow(jobId);
        if (job.getStatus() != AiJobStatus.NEEDS_REVIEW) {
            throw new ApiException(400, "검토 대기 상태의 job만 거부할 수 있습니다. 현재 상태: " + job.getStatus());
        }
        job.setStatus(AiJobStatus.REJECTED);
        job.setReviewedBy(rejectedByUserId);
        return aiJobRepository.save(job);
    }

    public List<AiJobFileDiff> readChangedFileContents(Long jobId) {
        AiJob job = getJobOrThrow(jobId);
        if (job.getDiffPath() == null) {
            throw new ApiException(400, "아직 diff가 준비되지 않았습니다.");
        }
        List<AiJobFileDiff> result = new ArrayList<>();
        for (String file : parseChangedFiles(job)) {
            Path f = Path.of(job.getDiffPath(), safeFileName(file));
            try {
                result.add(new AiJobFileDiff(file, Files.exists(f) ? Files.readString(f) : ""));
            } catch (IOException e) {
                throw new ApiException(500, "결과 파일을 읽을 수 없습니다: " + e.getMessage());
            }
        }
        return result;
    }

    /**
     * 작업 한 건을 읽는다.
     *
     * 채팅 패널의 작업 카드, 'AI 검토' 화면, 그리고 앞으로 붙을 외부 오케스트레이터(LangGraph)가
     * 모두 이 하나의 읽기 경로를 쓴다. 상태를 화면마다 따로 계산하면 같은 작업이 화면에 따라
     * 다르게 보이게 된다.
     */
    public AiJob getJob(Long jobId) {
        return getJobOrThrow(jobId);
    }

    private AiJob getJobOrThrow(Long jobId) {
        return aiJobRepository.findById(jobId)
                .orElseThrow(() -> new ApiException(404, "AiJob not found: " + jobId));
    }

    private void markError(AiJob job, String message) {
        job.setStatus(AiJobStatus.ERROR);
        job.setErrorMessage(message);
        aiJobRepository.save(job);
    }
}
