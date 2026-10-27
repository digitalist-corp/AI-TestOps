package com.playops.api.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.playops.api.config.PlayOpsProperties;
import com.playops.api.entity.Execution;
import com.playops.api.entity.ExecutionCaseResult;
import com.playops.api.entity.ExecutionStatus;
import com.playops.api.entity.Project;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.ExecutionCaseResultRepository;
import com.playops.api.repository.ExecutionRepository;
import com.playops.api.util.ProjectEnvVariables;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

@Service
public class TestExecutionService {

    private static final Logger log = LoggerFactory.getLogger(TestExecutionService.class);
    private static final String DEFAULT_PLAYWRIGHT_PROJECT = "--project=chromium";
    private static final String DEFAULT_PLAYWRIGHT_RETRIES = "--retries=0";
    private static final Pattern PLAYWRIGHT_TEST_COMMAND_PATTERN =
            Pattern.compile("(^|\\s)playwright\\s+test(\\s|$)");
    private static final Pattern PLAYWRIGHT_PROJECT_OPTION_PATTERN =
            Pattern.compile("(^|\\s)--project(=|\\s+)\\S+");
    private static final Pattern PLAYWRIGHT_RETRIES_OPTION_PATTERN =
            Pattern.compile("(^|\\s)--retries(=|\\s+)\\S+");

    private final ExecutionRepository executionRepository;
    private final ExecutionCaseResultRepository executionCaseResultRepository;
    private final SiteMapPromptService siteMapPromptService;
    private final ProjectService projectService;
    private final PlayOpsProperties properties;
    private final ExecutionLogService logService;
    private final DockerRunnerService dockerRunnerService;
    private final PlaywrightScenarioService scenarioService;
    private final SlackNotificationService slackNotificationService;
    private final LoginSessionService loginSessionService;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final Map<Long, Process> activeProcesses = new ConcurrentHashMap<>();

    public TestExecutionService(
            ExecutionRepository executionRepository,
            ExecutionCaseResultRepository executionCaseResultRepository,
            ProjectService projectService,
            PlayOpsProperties properties,
            ExecutionLogService logService,
            DockerRunnerService dockerRunnerService,
            PlaywrightScenarioService scenarioService,
            SlackNotificationService slackNotificationService,
            LoginSessionService loginSessionService,
            SiteMapPromptService siteMapPromptService
    ) {
        this.siteMapPromptService = siteMapPromptService;
        this.executionRepository = executionRepository;
        this.executionCaseResultRepository = executionCaseResultRepository;
        this.projectService = projectService;
        this.properties = properties;
        this.logService = logService;
        this.dockerRunnerService = dockerRunnerService;
        this.scenarioService = scenarioService;
        this.slackNotificationService = slackNotificationService;
        this.loginSessionService = loginSessionService;
    }

    public Execution createExecution(String projectId, String grep, String specPath, List<String> specPaths, String caseTitle) {
        return createExecution(projectId, grep, specPath, specPaths, caseTitle, false);
    }

    public Execution createExecution(
            String projectId, String grep, String specPath, List<String> specPaths, String caseTitle, boolean sequential
    ) {
        Project project = projectService.getProject(projectId);
        validateRequiredEnv(project);
        projectService.ensureDockerRunnerRunning(project);
        Execution execution = new Execution();
        execution.setProjectId(projectId);
        execution.setGrepFilter(grep);
        execution.setSpecPath(joinSpecPaths(specPath, specPaths));
        execution.setCaseTitle(caseTitle);
        execution.setStatus(ExecutionStatus.PENDING);
        execution.setReportPath("reports/" + projectId + "/pending");
        execution.setSequential(sequential);
        return executionRepository.save(execution);
    }

    private void validateRequiredEnv(Project project) {
        if (!project.getLoginEnvRequired()) {
            return;
        }

        // 테스트 계정 env가 필수인 프로젝트는 실행 요청 시점에 실제 KEY=VALUE 입력 여부를 확인한다.
        // 일회용 러너라면 이 검증을 통과한 뒤에만 컨테이너를 생성한다.
        boolean hasEnv = ProjectEnvVariables.parse(project.getEnvVariables()).entrySet().stream()
                .anyMatch(entry -> !entry.getKey().isBlank() && !entry.getValue().isBlank());
        if (!hasEnv) {
            throw new ApiException(400, "테스트 계정 환경변수가 필요합니다. 환경변수를 먼저 입력하세요.");
        }
    }

    public Execution cancelExecution(Long executionId) {
        Execution execution = executionRepository.findById(executionId)
                .orElseThrow(() -> new ApiException(404, "Execution not found"));

        if (isTerminal(execution.getStatus())) {
            throw new ApiException(409, "이미 종료된 실행입니다.");
        }

        if (execution.getStatus() == ExecutionStatus.PENDING) {
            execution.setStatus(ExecutionStatus.CANCELLED);
            execution.setFinishedAt(Instant.now());
            execution.setErrorMessage("사용자가 대기 중인 실행을 취소했습니다.");
            Execution saved = executionRepository.save(execution);
            projectService.cleanupEphemeralRunner(projectService.getProject(saved.getProjectId()));
            return saved;
        }

        execution.setStatus(ExecutionStatus.CANCEL_REQUESTED);
        execution.setErrorMessage("사용자가 실행 중단을 요청했습니다.");
        executionRepository.save(execution);

        Path reportDir = logService.resolveReportDir(execution);
        logService.append(reportDir, "[playops] 실행 중단 요청...");
        stopContainerExecution(execution);

        Process process = activeProcesses.get(executionId);
        if (process != null && process.isAlive()) {
            process.destroy();
            try {
                if (!process.waitFor(3, TimeUnit.SECONDS)) {
                    process.destroyForcibly();
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                process.destroyForcibly();
            }
        }

        return executionRepository.findById(executionId).orElse(execution);
    }

    @Async("executionExecutor")
    public void runExecutionAsync(Long executionId) {
        Execution execution = executionRepository.findById(executionId)
                .orElseThrow(() -> new ApiException(404, "Execution not found"));

        if (execution.getStatus() == ExecutionStatus.CANCELLED
                || execution.getStatus() == ExecutionStatus.CANCEL_REQUESTED) {
            execution.setStatus(ExecutionStatus.CANCELLED);
            execution.setFinishedAt(Instant.now());
            executionRepository.save(execution);
            return;
        }

        Project project = projectService.getProject(execution.getProjectId());
        Path reportDir = Path.of(properties.storageRoot(), "reports", project.getProjectId(), String.valueOf(executionId));

        execution.setStatus(ExecutionStatus.RUNNING);
        execution.setStartedAt(Instant.now());
        execution.setReportPath(reportDir.toString().replace('\\', '/'));
        executionRepository.save(execution);

        try {
            Files.createDirectories(reportDir);
            logService.initStreamLog(reportDir);
            logService.append(reportDir, "[playops] 테스트 실행 시작...");

            int exitCode = runPlaywright(execution, project, reportDir);
            parseReport(reportDir, execution);

            Execution latest = executionRepository.findById(executionId).orElse(execution);
            if (isCancellation(latest.getStatus())) {
                markCancelled(execution, reportDir);
            } else {
                execution.setStatus(exitCode == 0 ? ExecutionStatus.PASSED : ExecutionStatus.FAILED);
                logService.append(reportDir, "[playops] 완료 (exit=" + exitCode + ")");
            }
        } catch (Exception e) {
            log.error("Execution {} failed", executionId, e);
            Execution latest = executionRepository.findById(executionId).orElse(execution);
            if (isCancellation(latest.getStatus())) {
                markCancelled(execution, reportDir);
            } else {
                execution.setStatus(ExecutionStatus.ERROR);
                execution.setErrorMessage(e.getMessage());
                logService.append(reportDir, "[playops] 오류: " + e.getMessage());
            }
        } finally {
            execution.setFinishedAt(Instant.now());
            if (execution.getStartedAt() != null) {
                execution.setDurationMs(
                        execution.getFinishedAt().toEpochMilli() - execution.getStartedAt().toEpochMilli()
                );
            }
            executionRepository.save(execution);
            notifyFailureIfNeeded(execution, project);
            try {
                projectService.cleanupEphemeralRunner(project);
            } catch (Exception e) {
                log.warn("Failed to cleanup ephemeral runner for project {}: {}", project.getProjectId(), e.getMessage());
            }
        }
    }

    /**
     * 일반 실패/오류만 알린다. AI_POST_APPLY(사후 검증) 실행은 AiPostApplyVerificationService가
     * 회귀 여부를 판단해 별도의 더 구체적인 알림을 보내므로 여기서 중복 알림을 보내지 않는다.
     */
    private void notifyFailureIfNeeded(Execution execution, Project project) {
        if (execution.getStatus() != ExecutionStatus.FAILED && execution.getStatus() != ExecutionStatus.ERROR) {
            return;
        }
        if ("AI_POST_APPLY".equals(execution.getSource())) {
            return;
        }
        String statusLabel = execution.getStatus() == ExecutionStatus.ERROR ? "오류" : "실패";
        String counts = execution.getTotalTests() != null && execution.getTotalTests() > 0
                ? " (" + execution.getFailedTests() + "/" + execution.getTotalTests() + " 실패)"
                : "";
        slackNotificationService.send(
                ":x: [" + project.getProjectName() + "] 테스트 실행 " + statusLabel + counts
                        + "\nexecution #" + execution.getId()
                        + (execution.getSpecPath() != null && !execution.getSpecPath().isBlank() ? "\nspec: " + execution.getSpecPath() : "")
        );
    }

    private int runPlaywright(Execution execution, Project project, Path reportDir) throws Exception {
        String baseUrl = project.getBaseUrl() != null && !project.getBaseUrl().isBlank()
                ? project.getBaseUrl() : "https://example.com";

        String installCmd = project.getInstallCommand() != null ? project.getInstallCommand() : "npm install";
        String testCmd = buildTestCommand(project, execution);

        String workingDirInApiContainer = Path.of(properties.projectsRoot(), project.getProjectId())
                .toAbsolutePath()
                .normalize()
                .toString()
                .replace('\\', '/');
        String reportDirInApiContainer = reportDir.toAbsolutePath().normalize().toString().replace('\\', '/');
        String npmCacheDirInApiContainer = Path.of(properties.storageRoot(), "cache", "npm", project.getProjectId())
                .toAbsolutePath()
                .normalize()
                .toString()
                .replace('\\', '/');
        String pnpmHomeDirInApiContainer = Path.of(properties.storageRoot(), "cache", "pnpm-home", project.getProjectId())
                .toAbsolutePath()
                .normalize()
                .toString()
                .replace('\\', '/');
        String pnpmStoreDirInApiContainer = Path.of(properties.storageRoot(), "cache", "pnpm-store", project.getProjectId())
                .toAbsolutePath()
                .normalize()
                .toString()
                .replace('\\', '/');
        String pidFile = "/tmp/playops-execution-" + execution.getId() + ".pid";

        // 로그인/설정 선행 시나리오(Project.loginSetupSpecPath) 지원 — docs/scenario-env-management.md의
        // "로그인 세션 관리" 설계. 미설정이면 아래 로직은 전부 건너뛰고 기존 흐름과 동일하게 동작한다.
        boolean loginSessionConfigured = loginSessionService.isConfigured(project);
        boolean isRunningLoginSpecItself = loginSessionConfigured
                && project.getLoginSetupSpecPath().equals(execution.getSpecPath());
        boolean needsLoginRefresh = loginSessionConfigured && !isRunningLoginSpecItself
                && loginSessionService.needsRefresh(project);
        String storageStateFileInApiContainer = null;
        if (loginSessionConfigured) {
            storageStateFileInApiContainer = loginSessionService.storageStateFile(project.getProjectId())
                    .toString().replace('\\', '/');
        }

        List<String> lines = new ArrayList<>(List.of(
                "set -euo pipefail",
                "EXEC_PID_FILE=" + shellQuote(pidFile),
                "echo $$ > \"$EXEC_PID_FILE\"",
                "trap 'rm -f \"$EXEC_PID_FILE\"' EXIT",
                "mkdir -p " + reportDirInApiContainer,
                "mkdir -p " + npmCacheDirInApiContainer + " " + pnpmHomeDirInApiContainer + " " + pnpmStoreDirInApiContainer,
                "export NPM_CONFIG_CACHE=" + shellQuote(npmCacheDirInApiContainer),
                "export PNPM_HOME=" + shellQuote(pnpmHomeDirInApiContainer),
                "export PNPM_STORE_DIR=" + shellQuote(pnpmStoreDirInApiContainer),
                "export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1",
                "export PATH=\"$PNPM_HOME:$PATH\"",
                "echo \"[env] nodeVersion=" + (project.getNodeVersion() != null ? project.getNodeVersion() : "") + " playwrightVersion=" + (project.getPlaywrightVersion() != null ? project.getPlaywrightVersion() : "") + "\"",
                "echo \"[cache] npm=$NPM_CONFIG_CACHE pnpm=$PNPM_STORE_DIR\"",
                "echo '[runtime] 확인'",
                "node -v 2>&1",
                "npm -v 2>&1",
                "pnpm -v 2>&1 || true",
                "echo '[corepack] enable'",
                "corepack enable 2>&1 | tee -a " + reportDirInApiContainer + "/install.log || true",
                "echo '[install] 시작'",
                installCmd + " 2>&1 | tee -a " + reportDirInApiContainer + "/install.log",
                "echo \"[runner] container=" + dockerRunnerService.containerName(project.getProjectId()) + "\""
        ));

        if (needsLoginRefresh) {
            String storageStateDirInApiContainer = storageStateFileInApiContainer.substring(
                    0, storageStateFileInApiContainer.lastIndexOf('/'));
            lines.add("echo " + shellQuote("[playops] 로그인 선행 시나리오 실행: " + project.getLoginSetupSpecPath()));
            lines.add("mkdir -p " + storageStateDirInApiContainer);
            lines.add("export PLAYOPS_STORAGE_STATE_OUTPUT=" + shellQuote(storageStateFileInApiContainer));
            lines.add("npx playwright test " + shellQuote(project.getLoginSetupSpecPath()) + " --project=chromium"
                    + " 2>&1 | tee -a " + reportDirInApiContainer + "/login-setup.log"
                    + " || echo '[playops] 로그인 선행 시나리오 실패 — 세션 없이 계속 진행'");
        }

        lines.add("echo " + shellQuote("[playops] test command=" + testCmd));
        lines.add("echo '[test] 시작'");
        lines.add("export PLAYWRIGHT_JSON_OUTPUT_NAME=" + shellQuote(reportDirInApiContainer + "/results.json"));
        lines.add("export PLAYWRIGHT_HTML_OUTPUT_DIR=" + shellQuote("playwright-report"));
        if (loginSessionConfigured) {
            lines.add("export PLAYWRIGHT_STORAGE_STATE=" + shellQuote(storageStateFileInApiContainer));
        }
        lines.add("set +e");
        lines.add(testCmd + " --reporter=line,json,html 2>&1 | tee " + reportDirInApiContainer + "/run.log");
        lines.add("EXIT_CODE=${PIPESTATUS[0]}");
        lines.add("set -e");
        lines.add("cp -r playwright-report " + reportDirInApiContainer + "/ 2>/dev/null || true");
        lines.add("cp -r test-results " + reportDirInApiContainer + "/ 2>/dev/null || true");
        lines.add("echo \"[playops] exit=$EXIT_CODE\"");
        lines.add("exit $EXIT_CODE");

        String script = String.join("\n", lines);

        List<String> command = new ArrayList<>();
        command.add("docker");
        command.add("exec");
        command.add("--user");
        command.add("0");
        command.add("-w");
        command.add(workingDirInApiContainer);

        // 프로젝트 환경변수는 컨테이너 생성 시점이 아니라 테스트 실행 시점에 주입한다.
        // 상주 러너도 계정/비밀번호 변경 후 다음 실행에서 최신 값을 바로 사용해야 하기 때문이다.
        Map<String, String> envFromProject = ProjectEnvVariables.parse(project.getEnvVariables());
        for (Map.Entry<String, String> entry : envFromProject.entrySet()) {
            if ("BASE_URL".equalsIgnoreCase(entry.getKey()) || "CI".equalsIgnoreCase(entry.getKey())) {
                continue;
            }
            command.add("-e");
            command.add(entry.getKey() + "=" + entry.getValue());
        }
        command.add("-e");
        command.add("NODE_VERSION=" + (project.getNodeVersion() != null ? project.getNodeVersion() : ""));
        command.add("-e");
        command.add("NPM_CONFIG_CACHE=" + npmCacheDirInApiContainer);
        command.add("-e");
        command.add("PNPM_HOME=" + pnpmHomeDirInApiContainer);
        command.add("-e");
        command.add("PNPM_STORE_DIR=" + pnpmStoreDirInApiContainer);
        command.add("-e");
        command.add("PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1");
        command.add("-e");
        command.add("BASE_URL=" + baseUrl);
        command.add("-e");
        command.add("CI=true");
        command.add(dockerRunnerService.containerName(project.getProjectId()));
        command.add("bash");
        command.add("-lc");
        command.add(script);

        if (!properties.dockerEnabled()) {
            throw new ApiException(500, "Docker is not enabled. Set PLAYOPS_DOCKER_ENABLED=true for test execution.");
        }

        ProcessBuilder pb = new ProcessBuilder(command);
        pb.redirectErrorStream(true);
        Process process = pb.start();
        activeProcesses.put(execution.getId(), process);

        StringBuilder output = new StringBuilder();
        try {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    output.append(line).append("\n");
                    logService.append(reportDir, line);
                }
            }

            boolean finished = process.waitFor(project.getTimeout() != null ? project.getTimeout() : 300, TimeUnit.SECONDS);
            if (!finished) {
                process.destroyForcibly();
                throw new ApiException(500, "Test execution timed out");
            }

            saveLogToReport(reportDir, output.toString());
            execution.setLogOutput(output.length() > 8000 ? output.substring(0, 8000) + "..." : output.toString());

            return process.exitValue();
        } finally {
            activeProcesses.remove(execution.getId(), process);
        }
    }

    private void stopContainerExecution(Execution execution) {
        try {
            String pidFile = "/tmp/playops-execution-" + execution.getId() + ".pid";
            String script = String.join("\n",
                    "pid=$(cat " + shellQuote(pidFile) + " 2>/dev/null || true)",
                    "if [ -n \"$pid\" ]; then",
                    "  pkill -TERM -P \"$pid\" 2>/dev/null || true",
                    "  kill -TERM \"$pid\" 2>/dev/null || true",
                    "  sleep 1",
                    "  pkill -KILL -P \"$pid\" 2>/dev/null || true",
                    "  kill -KILL \"$pid\" 2>/dev/null || true",
                    "  rm -f " + shellQuote(pidFile),
                    "fi"
            );
            Process process = new ProcessBuilder(
                    "docker",
                    "exec",
                    "--user",
                    "0",
                    dockerRunnerService.containerName(execution.getProjectId()),
                    "bash",
                    "-lc",
                    script
            ).redirectErrorStream(true).start();
            process.waitFor(5, TimeUnit.SECONDS);
        } catch (Exception e) {
            log.warn("Failed to stop container execution {}: {}", execution.getId(), e.getMessage());
        }
    }

    private void markCancelled(Execution execution, Path reportDir) {
        execution.setStatus(ExecutionStatus.CANCELLED);
        execution.setErrorMessage("사용자가 실행을 중단했습니다.");
        logService.append(reportDir, "[playops] 중단 완료");
    }

    private boolean isCancellation(ExecutionStatus status) {
        return status == ExecutionStatus.CANCEL_REQUESTED || status == ExecutionStatus.CANCELLED;
    }

    private boolean isTerminal(ExecutionStatus status) {
        return status == ExecutionStatus.PASSED
                || status == ExecutionStatus.FAILED
                || status == ExecutionStatus.ERROR
                || status == ExecutionStatus.CANCELLED;
    }

    private void saveLogToReport(Path reportDir, String dockerLog) {
        try {
            Files.writeString(reportDir.resolve("docker.log"), dockerLog);
        } catch (Exception ignored) {}
    }

    private void parseReport(Path reportDir, Execution execution) {
        Path resultsFile = reportDir.resolve("results.json");
        if (!Files.exists(resultsFile)) {
            appendRunLog(execution, reportDir);
            return;
        }
        try {
            JsonNode root = objectMapper.readTree(resultsFile.toFile());
            JsonNode stats = root.path("stats");
            if (!stats.isMissingNode()) {
                int expected = stats.path("expected").asInt(0);
                int unexpected = stats.path("unexpected").asInt(0);
                int skipped = stats.path("skipped").asInt(0);
                execution.setPassedTests(expected);
                execution.setFailedTests(unexpected);
                execution.setSkippedTests(skipped);
                execution.setTotalTests(expected + unexpected + skipped);
            }
            persistCaseResults(root, execution);
            appendRunLog(execution, reportDir);
        } catch (Exception e) {
            log.warn("Failed to parse results.json: {}", e.getMessage());
            appendRunLog(execution, reportDir);
        }
    }

    /**
     * Playwright JSON reporter의 suites 트리를 케이스 단위로 펼쳐 execution_case_results에 저장한다.
     * "결과탭 실패 UI 개선"에서 케이스별 에러 메시지를 인라인으로 보여주기 위한 데이터다.
     * AiPostApplyVerificationService도 같은 results.json을 걷지만 회귀비교용 Map<caseKey,Boolean>만
     * 만들고 에러 메시지는 필요 없어서 별도 로직이다 (서비스 간 순환 의존 방지 겸 각자 필요한 만큼만 추출).
     */
    private void persistCaseResults(JsonNode root, Execution execution) {
        List<ExecutionCaseResult> results = new ArrayList<>();
        for (JsonNode suite : root.path("suites")) {
            walkSuiteForCaseResults(suite, null, new ArrayList<>(), execution.getId(), results);
        }
        if (!results.isEmpty()) {
            executionCaseResultRepository.saveAll(results);
            updateSelectorVerification(execution.getProjectId(), results);
        }
    }

    /** 구조 분석으로 뽑은 셀렉터가 실제 화면에서 통했는지 기록한다. 부가 작업이라 실패해도 실행 결과에는 영향을 주지 않는다. */
    private void updateSelectorVerification(String projectId, List<ExecutionCaseResult> results) {
        try {
            siteMapPromptService.applyResults(projectId, results.stream()
                    .map(r -> new SiteMapPromptService.CaseOutcome(r.getSpecPath(), r.getStatus(), r.getErrorMessage()))
                    .toList());
        } catch (RuntimeException e) {
            log.warn("셀렉터 확인 상태 갱신 실패 (project={}): {}", projectId, e.getMessage());
        }
    }

    private void walkSuiteForCaseResults(
            JsonNode suite, String inheritedFile, List<String> parentTitles, Long executionId, List<ExecutionCaseResult> out
    ) {
        String file = suite.hasNonNull("file") && !suite.path("file").asText().isBlank()
                ? suite.path("file").asText()
                : inheritedFile;

        List<String> titles = new ArrayList<>(parentTitles);
        String suiteTitle = suite.path("title").asText(null);
        if (suiteTitle != null && !suiteTitle.isBlank()) {
            titles.add(suiteTitle);
        }

        for (JsonNode spec : suite.path("specs")) {
            List<String> specTitles = new ArrayList<>(titles);
            specTitles.add(spec.path("title").asText(""));

            JsonNode lastResult = null;
            String errorMessage = null;
            for (JsonNode test : spec.path("tests")) {
                for (JsonNode result : test.path("results")) {
                    lastResult = result;
                    if (errorMessage == null && !result.path("error").isMissingNode()) {
                        errorMessage = result.path("error").path("message").asText(null);
                    }
                }
            }

            ExecutionCaseResult caseResult = new ExecutionCaseResult();
            caseResult.setExecutionId(executionId);
            caseResult.setSpecPath(file);
            caseResult.setCaseTitle(String.join(" > ", specTitles));
            boolean ok = spec.path("ok").asBoolean(true);
            String rawStatus = lastResult != null ? lastResult.path("status").asText(null) : null;
            caseResult.setStatus(!ok ? "FAILED" : "skipped".equals(rawStatus) ? "SKIPPED" : "PASSED");
            if (lastResult != null && lastResult.hasNonNull("duration")) {
                caseResult.setDurationMs(lastResult.path("duration").asInt());
            }
            caseResult.setErrorMessage(!ok ? errorMessage : null);
            out.add(caseResult);
        }

        for (JsonNode child : suite.path("suites")) {
            walkSuiteForCaseResults(child, file, titles, executionId, out);
        }
    }

    private void appendRunLog(Execution execution, Path reportDir) {
        try {
            Path streamLog = reportDir.resolve("stream.log");
            Path runLog = reportDir.resolve("run.log");
            if (Files.exists(streamLog)) {
                execution.setLogOutput(Files.readString(streamLog, StandardCharsets.UTF_8));
            } else if (Files.exists(runLog)) {
                execution.setLogOutput(Files.readString(runLog, StandardCharsets.UTF_8));
            }
        } catch (Exception ignored) {}
    }

    private String buildTestCommand(Project project, Execution execution) {
        String testCmd = project.getTestCommand() != null && !project.getTestCommand().isBlank()
                ? project.getTestCommand()
                : "npx playwright test " + DEFAULT_PLAYWRIGHT_PROJECT + " " + DEFAULT_PLAYWRIGHT_RETRIES;
        testCmd = applyDefaultPlaywrightOptions(testCmd);
        List<String> specPaths = normalizeSpecPaths(execution.getSpecPath());
        String grep = execution.getGrepFilter();
        if (specPaths.isEmpty() && (grep == null || grep.isBlank())) {
            specPaths = scenarioService.enabledSpecPaths(project.getProjectId());
            if (specPaths.isEmpty()) {
                throw new ApiException(400, "사용 설정된 spec 파일이 없습니다.");
            }
        }
        for (String specPath : specPaths) {
            testCmd += " " + shellQuote(specPath);
        }
        if (grep != null && !grep.isBlank()) {
            testCmd += " --grep " + shellQuote(grep);
        } else {
            List<String> disabledGreps = scenarioService.disabledGreps(project.getProjectId(), specPaths);
            if (!disabledGreps.isEmpty()) {
                String grepInvert = disabledGreps.stream()
                        .map(Pattern::quote)
                        .reduce((left, right) -> left + "|" + right)
                        .orElse("");
                testCmd += " --grep-invert " + shellQuote(grepInvert);
            }
        }
        if (execution.isSequential()) {
            // 병렬 워커를 1개로 고정해 지정한 spec 목록을 순서대로 하나씩 실행한다("테스트 묶음 순차 실행").
            // 나중에 --workers 옵션이 또 붙어도 Playwright CLI는 뒤에 오는 값을 우선하므로 안전하다.
            testCmd += " --workers=1";
        }
        return testCmd;
    }

    private String applyDefaultPlaywrightOptions(String testCmd) {
        if (!PLAYWRIGHT_TEST_COMMAND_PATTERN.matcher(testCmd).find()) {
            return testCmd;
        }
        if (PLAYWRIGHT_PROJECT_OPTION_PATTERN.matcher(testCmd).find()) {
            return applyDefaultPlaywrightRetries(testCmd);
        }
        return applyDefaultPlaywrightRetries(testCmd + " " + DEFAULT_PLAYWRIGHT_PROJECT);
    }

    private String applyDefaultPlaywrightRetries(String testCmd) {
        if (PLAYWRIGHT_RETRIES_OPTION_PATTERN.matcher(testCmd).find()) {
            return testCmd;
        }
        return testCmd + " " + DEFAULT_PLAYWRIGHT_RETRIES;
    }

    private String joinSpecPaths(String specPath, List<String> specPaths) {
        if (specPaths != null && !specPaths.isEmpty()) {
            return String.join("\n", specPaths);
        }
        return specPath;
    }

    private List<String> normalizeSpecPaths(String specPath) {
        if (specPath == null || specPath.isBlank()) {
            return List.of();
        }
        List<String> result = new ArrayList<>();
        for (String item : specPath.split("\\R")) {
            String normalized = normalizeSpecPath(item);
            if (normalized != null && !result.contains(normalized)) {
                result.add(normalized);
            }
        }
        return result;
    }

    private String normalizeSpecPath(String specPath) {
        if (specPath == null || specPath.isBlank()) {
            return null;
        }
        String normalized = specPath.replace('\\', '/');
        if (normalized.startsWith("/") || normalized.contains("../") || normalized.equals("..") || normalized.startsWith("-")) {
            throw new ApiException(400, "Invalid spec path");
        }
        return normalized;
    }

    private String shellQuote(String value) {
        return "'" + value.replace("'", "'\"'\"'") + "'";
    }
}
