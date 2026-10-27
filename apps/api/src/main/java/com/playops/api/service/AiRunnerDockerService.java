package com.playops.api.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.playops.api.config.PlayOpsProperties;
import com.playops.api.entity.AiJob;
import com.playops.api.entity.Project;
import com.playops.api.exception.ApiException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * AI job(현재는 CODE_FIX)마다 일회성 컨테이너를 띄우고 지운다 — 테스트 러너(DockerRunnerService)의
 * "프로젝트당 상주 컨테이너 + docker exec" 방식과 달리, job 하나당 컨테이너 하나(docker run --rm)다.
 * docker.sock 제어 방식(ProcessBuilder + CLI)은 DockerRunnerService와 동일하게 맞춘다.
 */
@Service
public class AiRunnerDockerService {

    private static final Logger log = LoggerFactory.getLogger(AiRunnerDockerService.class);
    private static final String AI_RUNNER_IMAGE = "playops-ai-runner:latest";

    private final PlayOpsProperties properties;
    private final DockerRunnerService dockerRunnerService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public AiRunnerDockerService(PlayOpsProperties properties, DockerRunnerService dockerRunnerService) {
        this.properties = properties;
        this.dockerRunnerService = dockerRunnerService;
    }

    /** job.json을 공유 볼륨(/storage/ai-jobs/{jobId})에 써 두고, 일회성 AI Runner 컨테이너를 실행한다 (동기 호출 — 호출자가 @Async로 감싼다). */
    public void runJob(AiJob job, Project project, String failureLog) {
        Path jobDir = aiJobDir(job.getId());
        Path resultDir = jobDir.resolve("result");
        try {
            Files.createDirectories(jobDir);
            Files.createDirectories(resultDir);

            Map<String, Object> jobJson = new HashMap<>();
            jobJson.put("jobId", job.getId());
            jobJson.put("jobType", job.getJobType().name());
            jobJson.put("instruction", job.getInstruction());
            jobJson.put("targetSpecPath", job.getTargetSpecPath());
            jobJson.put("failureLog", failureLog);
            jobJson.put("maxIterations", project.getAiMaxIterations());
            Files.writeString(jobDir.resolve("job.json"), objectMapper.writeValueAsString(jobJson), StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new ApiException(500, "AI job 작업 디렉터리 준비 실패: " + e.getMessage());
        }

        ensureRunnerImage();

        String containerName = "ai-job-" + job.getId();
        String containerJobFile = containerAiJobPath(job.getId()) + "/job.json";
        String containerResultDir = containerAiJobPath(job.getId()) + "/result";

        List<String> command = new ArrayList<>();
        command.add("docker");
        command.add("run");
        command.add("--rm");
        command.add("--name");
        command.add(containerName);
        command.add("--network");
        command.add("container:playops-api");
        command.addAll(dockerRunnerService.projectVolumeArgs(project.getProjectId()));
        command.add("--user");
        command.add("0");
        command.add("-w");
        command.add(dockerRunnerService.containerWorkDir(project.getProjectId()));
        command.add("-e");
        command.add("AI_JOB_FILE=" + containerJobFile);
        command.add("-e");
        command.add("AI_JOB_RESULT_DIR=" + containerResultDir);
        command.add("-e");
        command.add("PLAYOPS_LLM_PROXY_URL=http://localhost:8080/internal/ai-jobs/" + job.getId() + "/llm");
        command.add("-e");
        command.add("PLAYOPS_CALLBACK_TOKEN=" + job.getCallbackToken());
        command.add(AI_RUNNER_IMAGE);

        try {
            log.info("AI job 컨테이너 실행 시작. job={}, container={}", job.getId(), containerName);
            // job 자체의 timeoutSeconds는 api 쪽 AiJobService에서 별도로 감시한다 (컨테이너가 멈춰도 job이 영구 RUNNING으로 남지 않도록).
            runProcessCommand(command, 1800);
            log.info("AI job 컨테이너 종료. job={}", job.getId());
        } catch (Exception e) {
            log.error("AI job 컨테이너 실행 실패. job={}", job.getId(), e);
            throw new ApiException(500, "AI Runner 컨테이너 실행 실패: " + e.getMessage());
        }
    }

    public record VerifyResult(boolean passed, String output) {}

    /**
     * 에디터 "AI 수정 도움"용 — LLM 호출·job.json DB row 없이, 제안된 파일 내용을 실제로
     * spec에 대해 한 번 실행해 pass/fail+로그만 얻는다. runJob과 달리 결과를 review 큐에 올리지
     * 않고 그 자리에서 바로 반환하며, 디렉터리도 호출이 끝나면 곧바로 지운다.
     */
    public VerifyResult runVerifyJob(Project project, String specPath, Map<String, String> fileOverrides) {
        String verifyId = "verify-" + java.util.UUID.randomUUID();
        Path jobDir = Path.of(properties.storageRoot(), "ai-jobs", verifyId);
        Path resultDir = jobDir.resolve("result");
        try {
            Files.createDirectories(jobDir);
            Files.createDirectories(resultDir);

            List<Map<String, String>> files = new ArrayList<>();
            for (Map.Entry<String, String> entry : fileOverrides.entrySet()) {
                Map<String, String> f = new HashMap<>();
                f.put("path", entry.getKey());
                f.put("content", entry.getValue());
                files.add(f);
            }
            Map<String, Object> jobJson = new HashMap<>();
            jobJson.put("jobType", "EDIT_ASSIST_VERIFY");
            jobJson.put("specPath", specPath);
            jobJson.put("files", files);
            Files.writeString(jobDir.resolve("job.json"), objectMapper.writeValueAsString(jobJson), StandardCharsets.UTF_8);

            ensureRunnerImage();

            String containerName = "ai-verify-" + verifyId.substring("verify-".length(), Math.min(verifyId.length(), 15));
            String containerJobFile = properties.storageRoot() + "/ai-jobs/" + verifyId + "/job.json";
            String containerResultDir = properties.storageRoot() + "/ai-jobs/" + verifyId + "/result";

            List<String> command = new ArrayList<>();
            command.add("docker");
            command.add("run");
            command.add("--rm");
            command.add("--name");
            command.add(containerName);
            command.add("--network");
            command.add("container:playops-api");
            command.addAll(dockerRunnerService.projectVolumeArgs(project.getProjectId()));
            command.add("--user");
            command.add("0");
            command.add("-w");
            command.add(dockerRunnerService.containerWorkDir(project.getProjectId()));
            command.add("-e");
            command.add("AI_JOB_FILE=" + containerJobFile);
            command.add("-e");
            command.add("AI_JOB_RESULT_DIR=" + containerResultDir);
            command.add(AI_RUNNER_IMAGE);

            log.info("AI edit-assist verify 컨테이너 실행 시작. spec={}, container={}", specPath, containerName);
            int projectTimeout = project.getTimeout() != null ? project.getTimeout() : 300;
            runProcessCommand(command, Math.max(120, projectTimeout + 60));

            String resultJson = Files.readString(resultDir.resolve("result.json"), StandardCharsets.UTF_8);
            @SuppressWarnings("unchecked")
            Map<String, Object> parsed = objectMapper.readValue(resultJson, Map.class);
            boolean passed = Boolean.TRUE.equals(parsed.get("passed"));
            String output = String.valueOf(parsed.getOrDefault("output", ""));
            return new VerifyResult(passed, output);
        } catch (Exception e) {
            log.error("AI edit-assist verify 실패. spec={}", specPath, e);
            throw new ApiException(500, "실행 검증 실패: " + e.getMessage());
        } finally {
            try {
                deleteRecursively(jobDir);
            } catch (Exception e) {
                log.warn("verify 작업 디렉터리 정리 실패: {}", jobDir, e);
            }
        }
    }

    /**
     * 대상 사이트 탐색(SITE_ANALYSIS, analyze.js). LLM 을 부르지 않으므로 AiJob 행도, 콜백 토큰도 없다.
     * job.json 은 호출자가 채워 jobDir 에 넘기고, 결과(result.json + screens/*.jpg)는 jobDir/result 에 남긴다 —
     * 스크린샷을 구조 탭에서 보여 줘야 하므로 verify 와 달리 지우지 않는다.
     *
     * @return result.json 을 그대로 읽은 값
     */
    public Map<String, Object> runSiteAnalysisJob(Project project, Path jobDir, Map<String, Object> jobJson, int timeoutSeconds) {
        Path resultDir = jobDir.resolve("result");
        try {
            Files.createDirectories(resultDir);
            Map<String, Object> withType = new HashMap<>(jobJson);
            withType.put("jobType", "SITE_ANALYSIS");
            Files.writeString(jobDir.resolve("job.json"), objectMapper.writeValueAsString(withType), StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new ApiException(500, "사이트 탐색 작업 디렉터리 준비 실패: " + e.getMessage());
        }

        ensureRunnerImage();

        String containerJobDir = dockerRunnerService.directoryContainerPath(jobDir);
        List<String> command = new ArrayList<>();
        command.add("docker");
        command.add("run");
        command.add("--rm");
        command.add("--name");
        command.add("ai-site-" + project.getProjectId() + "-" + System.currentTimeMillis());
        command.add("--network");
        command.add("container:playops-api");
        command.addAll(dockerRunnerService.directoryVolumeArgs(jobDir));
        command.add("--user");
        command.add("0");
        command.add("-e");
        command.add("AI_JOB_FILE=" + containerJobDir + "/job.json");
        command.add("-e");
        command.add("AI_JOB_RESULT_DIR=" + containerJobDir + "/result");
        command.add(AI_RUNNER_IMAGE);

        try {
            log.info("사이트 탐색 컨테이너 실행 시작. project={}", project.getProjectId());
            runProcessCommand(command, timeoutSeconds);
        } catch (Exception e) {
            // 탐색 도중 실패해도 analyze.js 가 result.json 에 오류를 남기므로, 있으면 그것을 돌려준다.
            log.warn("사이트 탐색 컨테이너 비정상 종료. project={}: {}", project.getProjectId(), e.getMessage());
        }
        try {
            String resultJson = Files.readString(resultDir.resolve("result.json"), StandardCharsets.UTF_8);
            @SuppressWarnings("unchecked")
            Map<String, Object> parsed = objectMapper.readValue(resultJson, Map.class);
            return parsed;
        } catch (Exception e) {
            throw new ApiException(500, "사이트 탐색 결과를 읽지 못했습니다. AI Runner 컨테이너를 실행할 수 있는지 확인하세요.");
        }
    }

    private void deleteRecursively(Path dir) throws java.io.IOException {
        if (!Files.exists(dir)) {
            return;
        }
        try (var stream = Files.walk(dir)) {
            stream.sorted(java.util.Comparator.reverseOrder()).forEach(p -> {
                try {
                    Files.delete(p);
                } catch (java.io.IOException ignored) {
                }
            });
        }
    }

    public Path aiJobDir(Long jobId) {
        return Path.of(properties.storageRoot(), "ai-jobs", String.valueOf(jobId));
    }

    private String containerAiJobPath(Long jobId) {
        return properties.storageRoot() + "/ai-jobs/" + jobId;
    }

    private void ensureRunnerImage() {
        try {
            runProcessCommand(List.of("docker", "image", "inspect", AI_RUNNER_IMAGE), 10);
            return;
        } catch (Exception ignored) {
            log.info("AI Runner 이미지가 없어 먼저 빌드합니다: {}", AI_RUNNER_IMAGE);
        }
        try {
            runProcessCommand(
                    List.of(
                            "docker", "build",
                            "--no-cache",
                            "--force-rm",
                            "-f", "/app/ai-runner.Dockerfile",
                            "-t", AI_RUNNER_IMAGE,
                            "/app"
                    ),
                    900
            );
        } catch (Exception e) {
            throw new ApiException(500, "AI Runner 이미지 빌드 실패: " + e.getMessage());
        }
    }

    private String runProcessCommand(List<String> command, int timeoutSeconds) throws Exception {
        ProcessBuilder pb = new ProcessBuilder(command);
        pb.redirectErrorStream(true);
        Process process = pb.start();

        StringBuilder output = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                output.append(line).append("\n");
            }
        }

        if (!process.waitFor(timeoutSeconds, TimeUnit.SECONDS)) {
            process.destroyForcibly();
            throw new ApiException(500, "AI Runner 명령 시간 초과");
        }
        if (process.exitValue() != 0) {
            throw new ApiException(500, output.toString().trim());
        }
        return output.toString().trim();
    }
}
