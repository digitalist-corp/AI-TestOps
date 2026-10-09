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

/**
 * GitHub 레포 연동: URL 검증과, 격리된 1회성 clone 컨테이너를 통한 저장소 복제를 담당한다.
 * clone 컨테이너는 {@link SandboxProxyService}가 관리하는 internal 네트워크에만 붙으며,
 * 그 네트워크에서 도달 가능한 allowlist 프록시를 통해서만 github.com 계열 호스트에 접근할 수 있다.
 * 실제 테스트를 실행하는 러너 컨테이너와는 완전히 분리되어 있어, baseUrl(테스트 대상)로의
 * 자유로운 네트워크 접근 등 기존 테스트 실행 동작에는 영향을 주지 않는다.
 * PAT는 이 서비스가 API 프로세스 메모리에서만 잠깐 복호화해 docker run -e 로 clone 컨테이너에만 전달하며,
 * DB나 로그에는 평문으로 남기지 않는다.
 */
@Service
public class GitRepositoryService {

    private static final Logger log = LoggerFactory.getLogger(GitRepositoryService.class);
    private static final String GIT_IMAGE = "alpine/git:latest";

    // https://github.com/{owner}/{repo}(.git)?(/)?  만 허용한다. 다른 호스트/스킴은 SSRF성 오남용을 막기 위해 거부한다.
    private static final Pattern GITHUB_HTTPS_PATTERN =
            Pattern.compile("^https://github\\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(\\.git)?/?$");
    private static final Pattern BRANCH_PATTERN = Pattern.compile("^[A-Za-z0-9._/-]{1,200}$");
    private static final Pattern TOKEN_IN_URL_PATTERN = Pattern.compile("x-access-token:[^@\\s]+@");

    private final DockerRunnerService dockerRunnerService;
    private final SandboxProxyService sandboxProxyService;

    public GitRepositoryService(DockerRunnerService dockerRunnerService, SandboxProxyService sandboxProxyService) {
        this.dockerRunnerService = dockerRunnerService;
        this.sandboxProxyService = sandboxProxyService;
    }

    /** GitHub HTTPS URL 형식만 허용하고, owner/repo 슬러그를 반환한다. */
    public String validateAndNormalize(String repositoryUrl) {
        if (repositoryUrl == null || repositoryUrl.isBlank()) {
            throw new ApiException(400, "GitHub 저장소 URL이 필요합니다.");
        }
        Matcher matcher = GITHUB_HTTPS_PATTERN.matcher(repositoryUrl.trim());
        if (!matcher.matches()) {
            throw new ApiException(400, "GitHub 저장소 URL은 https://github.com/{owner}/{repo} 형식이어야 합니다.");
        }
        return matcher.group(1) + "/" + matcher.group(2);
    }

    public String validateBranch(String branch) {
        if (branch == null || branch.isBlank()) {
            return null;
        }
        String trimmed = branch.trim();
        if (!BRANCH_PATTERN.matcher(trimmed).matches()) {
            throw new ApiException(400, "브랜치 이름 형식이 올바르지 않습니다.");
        }
        return trimmed;
    }

    /**
     * 격리된 1회성 컨테이너(--rm)에서 git clone을 실행해 프로젝트 디렉토리에 채워 넣는다.
     * 이 컨테이너는 {@link SandboxProxyService#SANDBOX_NETWORK} internal 네트워크에만 붙어 있어
     * allowlist 프록시를 거쳐 github.com 계열 호스트로만 나갈 수 있다.
     * 토큰은 docker run 의 -e 옵션으로만 전달되어(컨테이너가 --rm으로 즉시 제거되므로 흔적이 남지 않음) 실행 중에만 노출된다.
     */
    public void cloneRepository(Project project, String decryptedToken) {
        String projectId = project.getProjectId();
        cloneInto(projectId, project.getRepositoryUrl(), project.getRepositoryBranch(), decryptedToken,
                dockerRunnerService.containerWorkDir(projectId), dockerRunnerService.projectVolumeArgs(projectId));
    }

    /**
     * 같은 격리 컨테이너로 임의의 폴더에 복제한다. 폴더의 기존 내용은 지운다.
     *
     * @param containerWorkDir clone 컨테이너 안에서 본 대상 폴더
     * @param volumeArgs       그 폴더를 컨테이너에 보이게 하는 docker 인자
     */
    public void cloneInto(String projectId, String repositoryUrl, String rawBranch, String decryptedToken,
                          String containerWorkDir, List<String> volumeArgs) {
        String slug = validateAndNormalize(repositoryUrl);
        String branch = validateBranch(rawBranch);

        sandboxProxyService.ensureReady();

        boolean hasToken = decryptedToken != null && !decryptedToken.isBlank();
        String cloneUrl = hasToken
                ? "https://x-access-token:$GIT_TOKEN@github.com/" + slug + ".git"
                : "https://github.com/" + slug + ".git";

        List<String> script = new ArrayList<>();
        script.add("set -euo pipefail");
        script.add("find . -mindepth 1 -maxdepth 1 -exec rm -rf {} +");
        StringBuilder cloneCmd = new StringBuilder("git clone --single-branch --depth 1");
        if (branch != null) {
            cloneCmd.append(" --branch ").append(shellQuote(branch));
        }
        // cloneUrl에 담긴 $GIT_TOKEN은 셸이 확장해줘야 하므로 작은따옴표(리터럴)가 아니라 큰따옴표로 감싼다.
        // slug/owner는 이미 GITHUB_HTTPS_PATTERN으로 [A-Za-z0-9_.-]만 허용되도록 검증된 값이라
        // 큰따옴표 안에서 별도 이스케이프 없이도 셸 인젝션 위험이 없다.
        cloneCmd.append(" ").append(shellDoubleQuote(cloneUrl)).append(" .");
        script.add(cloneCmd.toString());

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
        if (hasToken) {
            command.add("-e");
            command.add("GIT_TOKEN=" + decryptedToken);
        }
        command.addAll(volumeArgs);
        command.add("-w");
        command.add(containerWorkDir);
        command.add("--entrypoint");
        command.add("sh");
        command.add(GIT_IMAGE);
        command.add("-c");
        command.add(String.join("\n", script));

        dockerRunnerService.logOperation(projectId, "[playops] GitHub 저장소 clone 시작(격리 샌드박스): " + slug
                + (branch != null ? " (" + branch + ")" : ""));

        try {
            int exitCode = runAndStream(projectId, command);
            if (exitCode != 0) {
                dockerRunnerService.logOperation(projectId, "[playops] GitHub 저장소 clone 실패 (exit=" + exitCode + ")");
                throw new ApiException(500, "GitHub 저장소 clone에 실패했습니다 (exit=" + exitCode + ")");
            }
            dockerRunnerService.logOperation(projectId, "[playops] GitHub 저장소 clone 완료: " + slug);
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            log.error("Failed to clone repository for project {}: {}", projectId, redact(e.getMessage()));
            dockerRunnerService.logOperation(projectId, "[playops] GitHub 저장소 clone 오류: " + redact(e.getMessage()));
            throw new ApiException(500, "GitHub 저장소 clone 중 오류가 발생했습니다: " + redact(e.getMessage()));
        }
    }

    private int runAndStream(String projectId, List<String> command) throws Exception {
        ProcessBuilder pb = new ProcessBuilder(command);
        pb.redirectErrorStream(true);
        Process process = pb.start();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                dockerRunnerService.logOperation(projectId, redact(line));
            }
        }
        if (!process.waitFor(180, TimeUnit.SECONDS)) {
            process.destroyForcibly();
            throw new ApiException(500, "GitHub 저장소 clone이 시간 초과되었습니다.");
        }
        return process.exitValue();
    }

    /** 실패 시 clone URL에 토큰이 그대로 찍히는 것을 막기 위한 방어적 마스킹 (정상 흐름에서는 애초에 노출되지 않음). */
    private String redact(String value) {
        if (value == null) {
            return "";
        }
        return TOKEN_IN_URL_PATTERN.matcher(value).replaceAll("x-access-token:***@");
    }

    private String shellQuote(String value) {
        return "'" + value.replace("'", "'\"'\"'") + "'";
    }

    /** $VAR 확장이 필요한 값을 안전하게 큰따옴표로 감싼다 (호출자가 값에 셸 메타문자가 없음을 보장해야 함). */
    static String shellDoubleQuote(String value) {
        return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }
}
