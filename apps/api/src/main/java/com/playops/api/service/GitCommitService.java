package com.playops.api.service;

import com.playops.api.entity.Project;
import com.playops.api.exception.ApiException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * AI가 적용한 변경을 git 연동된 프로젝트에 실제로 commit/push한다 (git 연동이 없는 프로젝트는 조용히 건너뛴다 —
 * AiJobService.applyDiff는 이 서비스 호출 성패와 무관하게 이미 프로젝트 볼륨 파일을 반영했으므로, git 실패가
 * "AI 수정 적용 자체의 실패"를 의미하지 않는다).
 *
 * GitRepositoryService.cloneRepository와 동일하게 격리된 1회성 컨테이너(GitHub 샌드박스 네트워크)에서만 실행하고,
 * PAT는 이 서비스가 api 프로세스 메모리에서만 잠깐 복호화해 docker run -e 로 전달한다.
 */
@Service
public class GitCommitService {

    private static final Logger log = LoggerFactory.getLogger(GitCommitService.class);
    private static final String GIT_IMAGE = "alpine/git:latest";
    private static final Pattern TOKEN_IN_URL_PATTERN = Pattern.compile("x-access-token:[^@\\s]+@");

    private final DockerRunnerService dockerRunnerService;
    private final SandboxProxyService sandboxProxyService;
    private final GitRepositoryService gitRepositoryService;
    private final SecretCipherService secretCipherService;

    public GitCommitService(
            DockerRunnerService dockerRunnerService,
            SandboxProxyService sandboxProxyService,
            GitRepositoryService gitRepositoryService,
            SecretCipherService secretCipherService
    ) {
        this.dockerRunnerService = dockerRunnerService;
        this.sandboxProxyService = sandboxProxyService;
        this.gitRepositoryService = gitRepositoryService;
        this.secretCipherService = secretCipherService;
    }

    /** git 연동이 안 된 프로젝트면 아무 것도 하지 않고 null을 반환한다. 연동된 프로젝트에서 실패하면 ApiException을 던진다. */
    public String commitAndPush(Project project, List<String> changedFiles, String message) {
        if (!isGitConnected(project)) {
            return null;
        }
        if (changedFiles == null || changedFiles.isEmpty()) {
            return null;
        }

        String remoteUrl = buildTokenUrl(project);
        List<String> script = new ArrayList<>();
        script.add("set -euo pipefail");
        script.add("git config user.email 'ai@playops.local'");
        script.add("git config user.name 'AI-TestOps AI'");
        script.add("git remote set-url origin " + GitRepositoryService.shellDoubleQuote(remoteUrl));
        script.add("git add -- " + changedFiles.stream().map(this::shellQuote).collect(Collectors.joining(" ")));
        script.add("git commit --quiet -m " + shellQuote(message));
        script.add("git push --quiet");
        script.add("git rev-parse HEAD");

        String output = runGitScript(project, "commit/push", script);
        return lastNonBlankLine(output);
    }

    /** git 연동이 안 된 프로젝트면 아무 것도 하지 않고 null을 반환한다. */
    public String revertCommit(Project project, String commitSha) {
        if (!isGitConnected(project) || commitSha == null || commitSha.isBlank()) {
            return null;
        }

        String remoteUrl = buildTokenUrl(project);
        List<String> script = new ArrayList<>();
        script.add("set -euo pipefail");
        script.add("git config user.email 'ai@playops.local'");
        script.add("git config user.name 'AI-TestOps AI'");
        script.add("git remote set-url origin " + GitRepositoryService.shellDoubleQuote(remoteUrl));
        script.add("git revert --no-edit " + shellQuote(commitSha));
        script.add("git push --quiet");
        script.add("git rev-parse HEAD");

        String output = runGitScript(project, "revert", script);
        return lastNonBlankLine(output);
    }

    private boolean isGitConnected(Project project) {
        return project.getRepositoryUrl() != null && !project.getRepositoryUrl().isBlank();
    }

    private String buildTokenUrl(Project project) {
        String slug = gitRepositoryService.validateAndNormalize(project.getRepositoryUrl());
        if (project.getRepositoryTokenEncrypted() == null || project.getRepositoryTokenEncrypted().isBlank()) {
            throw new ApiException(400, "GitHub PAT가 등록되어 있지 않아 push할 수 없습니다.");
        }
        return "https://x-access-token:$GIT_TOKEN@github.com/" + slug + ".git";
    }

    private String runGitScript(Project project, String opLabel, List<String> script) {
        sandboxProxyService.ensureReady();
        String projectId = project.getProjectId();
        String token = secretCipherService.decrypt(project.getRepositoryTokenEncrypted());
        String containerWorkDir = dockerRunnerService.containerWorkDir(projectId);

        List<String> command = new ArrayList<>();
        command.add("docker");
        command.add("run");
        command.add("--rm");
        command.add("--network");
        command.add(SandboxProxyService.SANDBOX_NETWORK);
        command.add("-e");
        command.add("HTTPS_PROXY=http://" + SandboxProxyService.PROXY_HOST + ":" + SandboxProxyService.PROXY_PORT);
        command.add("-e");
        command.add("HTTP_PROXY=http://" + SandboxProxyService.PROXY_HOST + ":" + SandboxProxyService.PROXY_PORT);
        command.add("-e");
        command.add("GIT_TOKEN=" + token);
        command.addAll(dockerRunnerService.projectVolumeArgs(projectId));
        command.add("-w");
        command.add(containerWorkDir);
        command.add("--entrypoint");
        command.add("sh");
        command.add(GIT_IMAGE);
        command.add("-c");
        command.add(String.join("\n", script));

        try {
            String output = runAndCapture(command, 120);
            dockerRunnerService.logOperation(projectId, "[playops] AI 적용 git " + opLabel + " 완료");
            return output;
        } catch (Exception e) {
            String message = redact(e.getMessage());
            dockerRunnerService.logOperation(projectId, "[playops] AI 적용 git " + opLabel + " 실패: " + message);
            throw new ApiException(500, "git " + opLabel + " 실패: " + message);
        }
    }

    private String runAndCapture(List<String> command, int timeoutSeconds) throws Exception {
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
            throw new ApiException(500, "git 명령이 시간 초과되었습니다.");
        }
        if (process.exitValue() != 0) {
            throw new RuntimeException(output.toString().trim());
        }
        return output.toString();
    }

    private String lastNonBlankLine(String output) {
        String[] lines = output.split("\\R");
        for (int i = lines.length - 1; i >= 0; i--) {
            if (!lines[i].isBlank()) {
                return lines[i].trim();
            }
        }
        return null;
    }

    private String redact(String value) {
        if (value == null) {
            return "";
        }
        return TOKEN_IN_URL_PATTERN.matcher(value).replaceAll("x-access-token:***@");
    }

    private String shellQuote(String value) {
        return "'" + value.replace("'", "'\"'\"'") + "'";
    }
}
