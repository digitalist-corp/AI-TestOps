package com.playops.api.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.playops.api.config.PlayOpsProperties;
import com.playops.api.dto.AppFixDtos.FileDiff;
import com.playops.api.dto.AppFixDtos.Proposal;
import com.playops.api.dto.AppFixDtos.View;
import com.playops.api.dto.DefectDtos.Defect;
import com.playops.api.entity.AiModelProvider;
import com.playops.api.entity.AppFixProposal;
import com.playops.api.entity.Project;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.AppFixProposalRepository;
import com.playops.api.repository.ProjectMemberRepository;
import com.playops.api.util.ProjectEnvVariables;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.annotation.Lazy;
import org.springframework.context.event.EventListener;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.util.FileSystemUtils;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * 제품 코드 수정안 1단계: 결함 상세의 "AI 수정 제안 보기".
 *
 * 요청할 때 서버가 결함 분류 · 권한 · 기준 실패 실행 · 공개 소스의 기준 SHA 를 정하고, 같은 것(identity_key)이 있으면 그것을 쓴다.
 * 분석은 비동기로: 그 커밋만 받아 앱 폴더에서 단서에 맞는 파일을 골라 모델에 보내고, 모델이 준 수정을 서버가 원본에 적용해 diff 를 만든다.
 * 소스가 없거나(웹주소만) 공개로 읽지 못하거나 근거가 부족하면 진단만 남긴다. 원격 저장소에는 쓰지 않는다.
 * 조회 · 요청: 관리자, 또는 그 프로젝트의 PM · 팀원 (웹 · 채팅 같은 검사).
 */
@Service
public class AppFixProposalService {

    private static final Logger log = LoggerFactory.getLogger(AppFixProposalService.class);
    private static final ObjectMapper JSON = new ObjectMapper();

    /** 모델 입력 상한 (계획서 1단계). 실제 결함으로 조정한다 */
    static final int MAX_FILES = 10;
    static final int MAX_BYTES = 30 * 1024;
    private static final int MAX_EVIDENCE = 8000;
    private static final int MAX_FILE_BYTES = 512 * 1024;
    private static final Set<String> SKIP_DIRS = Set.of("node_modules", "dist", "build", "out", "coverage", ".next", ".nuxt",
            ".git", ".turbo", ".cache", "vendor", "target", "test-results", "playwright-report");
    private static final List<String> EXTENSIONS = List.of(".tsx", ".ts", ".jsx", ".js", ".vue", ".svelte", ".java", ".kt", ".py");

    private static final String SYSTEM = """
            너는 웹 서비스의 기능 결함을 진단하는 시니어 개발자다. QA 실행 증거와, 있으면 대상 서비스 소스 일부를 받는다.
            - 증거에 없는 사실을 지어내지 않는다. 원인은 후보로 말하고 근거 파일 · 줄을 "경로:줄 — 설명" 형식으로 적는다.
            - 테스트 코드 · 기대값을 바꾸거나 테스트를 건너뛰는 수정은 제품 수정이 아니다. 받은 소스 파일만 고친다.
            - 인증 · 권한 정책, 비밀값, 배포 설정, 의존성 잠금 파일, DB 마이그레이션은 고치지 않는다.
            - edits 의 find 는 그 파일에 정확히 한 번 나오는 원문 그대로의 코드 조각이어야 한다. 확신이 없으면 edits 를 비운다.
            JSON 하나만 답한다 (코드 블록 없이):
            {"summary":"한두 문장 진단","causes":["경로:줄 — 원인 후보"],"checks":["사람이 확인할 곳 · 재현 단계"],
             "edits":[{"path":"저장소 기준 경로","find":"원문","replace":"바꿀 코드"}]}
            """;

    private final AppFixProposalRepository proposals;
    private final ProjectMemberRepository members;
    private final DefectService defects;
    private final ProjectService projects;
    private final GitRepositoryService git;
    private final DockerRunnerService docker;
    private final StepRecordService steps;
    private final ScreenFinder screenFinder;
    private final LlmGatewayService llm;
    private final AiProviderSettingsService providers;
    private final PlayOpsProperties properties;
    private final com.playops.api.repository.UserRepository users;
    /** @Async 는 프록시를 거쳐야 돈다 (AiJobService 와 같은 이유) */
    private final AppFixProposalService self;
    /** 빈은 웹 서버가 열리기 전에 만들어지므로 생성 시각을 기동 시각으로 쓴다 (ExecutionStartupCleaner 와 같은 방식) */
    private final java.time.Instant bootedAt = java.time.Instant.now();

    public AppFixProposalService(AppFixProposalRepository proposals, ProjectMemberRepository members, DefectService defects,
                                 ProjectService projects, GitRepositoryService git, DockerRunnerService docker,
                                 StepRecordService steps, ScreenFinder screenFinder, LlmGatewayService llm,
                                 AiProviderSettingsService providers, PlayOpsProperties properties,
                                 com.playops.api.repository.UserRepository users, @Lazy AppFixProposalService self) {
        this.proposals = proposals;
        this.members = members;
        this.defects = defects;
        this.projects = projects;
        this.git = git;
        this.docker = docker;
        this.steps = steps;
        this.screenFinder = screenFinder;
        this.llm = llm;
        this.providers = providers;
        this.properties = properties;
        this.users = users;
        this.self = self;
    }

    /** 조회 · 폴링. 원격 저장소는 읽지 않는다(ls-remote 없음). 새 커밋 반영은 다시 요청할 때 정한다 */
    public View get(String projectId, String specPath, String grep, Long userId, boolean admin) {
        checkAccess(projectId, userId, admin);
        Defect defect = defects.find(projectId, specPath, grep);
        return view(defect, projects.getProject(projectId),
                proposals.findFirstByProjectIdAndSpecPathAndGrepOrderByIdDesc(projectId, specPath, grep).orElse(null));
    }

    /** executionId 를 비우면 결함의 마지막 실패 실행. 이전 실패 실행은 기준이 될 수 없다 (그 결과는 조회에서 "이전 수정안") */
    public View request(String projectId, String specPath, String grep, Long executionId, Long userId, boolean admin) {
        checkAccess(projectId, userId, admin);
        Defect defect = defects.find(projectId, specPath, grep);
        AppFixRules.Category category = AppFixRules.Category.valueOf(defect.fixCategory());
        if (!category.candidate()) {
            throw new ApiException(409, "CATEGORY", "코드 · API 오류 후보 결함만 수정 제안을 볼 수 있습니다. (분류: " + category + ")");
        }
        Long failed = defect.lastFailedExecutionId();
        if (executionId != null && !executionId.equals(failed)) {
            throw new ApiException(409, "STALE_EXECUTION", "결함의 마지막 실패 실행(#" + failed + ") 기준으로만 요청할 수 있습니다.");
        }
        Project project = projects.getProject(projectId);
        Source source = source(project);
        // 저장소 · 브랜치 · 앱 폴더 · 기준 SHA 를 작업에 고정한다. 설정이 바뀌면 다른 작업이다
        String appRoot = source.slug() == null ? null : blankToNull(project.getSourceAppRoot());
        String key = identity(projectId, specPath, grep, String.valueOf(failed), source.slug(), source.branch(), appRoot, source.sha());

        Optional<AppFixProposal> existing = proposals.findByIdentityKey(key);
        if (existing.isPresent()) {
            return view(defect, project, retryIfNeeded(existing.get(), userId, source.limitation()));
        }
        AppFixProposal p = new AppFixProposal();
        p.setProjectId(projectId);
        p.setSpecPath(specPath);
        p.setGrep(grep);
        p.setExecutionId(failed);
        p.setIdentityKey(key);
        p.setCategory(category.name());
        p.setStatus(AppFixProposal.ANALYZING);
        p.setSourceRepository(source.slug());
        p.setSourceBranch(source.branch());
        p.setSourceSha(source.sha());
        p.setAppRoot(appRoot);
        p.setLimitation(source.limitation());
        p.setEvidence(evidence(project, defect, failed));
        p.setRequestedBy(userId);
        try {
            p = proposals.saveAndFlush(p);
        } catch (DataIntegrityViolationException e) {
            // 같은 요청이 동시에 왔다. 먼저 만든 것을 쓴다.
            return view(defect, project, proposals.findByIdentityKey(key).orElseThrow(() -> e));
        }
        return view(defect, project, start(p));
    }

    /**
     * 관리자는 기존 정책대로 모든 프로젝트, 그 밖에는 그 프로젝트의 PM · 팀원만.
     * 예전 AI 분석 채팅은 도구에 관리자 여부를 넘기지 않으므로(다른 도구 범위를 넓히지 않으려고), 인증된 사용자 id 로 전역 역할을 직접 본다.
     */
    private void checkAccess(String projectId, Long userId, boolean admin) {
        if (admin) return;
        if (userId != null && users.findById(userId).map(u -> u.getRole() == com.playops.api.entity.UserRole.ADMIN).orElse(false)) {
            return;
        }
        if (userId == null || members.findByProjectIdAndUserId(projectId, userId).isEmpty()) {
            throw new ApiException(403, "FORBIDDEN", "이 프로젝트의 멤버가 아닙니다.");
        }
    }

    /**
     * stale(이전 수정안): 결함의 마지막 실패 실행이 바뀌었거나, 지금 프로젝트의 소스 설정(저장소 · 브랜치 · 지정한 앱 폴더)이 작업과 다르다.
     * 같은 설정에서 브랜치에 새 커밋이 생긴 것은 다시 요청할 때 기준 SHA 로 가린다.
     */
    private View view(Defect defect, Project project, AppFixProposal p) {
        Long failed = defect.lastFailedExecutionId();
        boolean stale = p != null && (!failed.equals(p.getExecutionId()) || !sameSource(project, p));
        return new View(defect.fixCategory(), failed, stale, p == null ? null : Proposal.from(p));
    }

    private boolean sameSource(Project project, AppFixProposal p) {
        String url = blankToNull(project.getSourceRepositoryUrl());
        String slug = url == null ? null : git.validateAndNormalize(url);
        if (!java.util.Objects.equals(slug, p.getSourceRepository())) return false;
        if (slug == null) return true;
        String appRoot = blankToNull(project.getSourceAppRoot());
        return java.util.Objects.equals(blankToNull(project.getSourceRepositoryBranch()), blankToNull(p.getSourceBranch()))
                && (appRoot == null || appRoot.equals(p.getAppRoot()));
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    /**
     * 같은 기준으로 다시 돌린다: 실패한 분석, 또는 키가 없어 AI 없이 끝난 진단(요약 없음)이고 지금은 키가 있을 때.
     * 끝난 분석 · 진행 중인 것은 그대로 쓴다. 동시에 여러 번 와도 조건부 갱신을 얻은 한 요청만 분석을 시작한다.
     * sourceLimitation: 요청 때 정한 소스 한계 (지난 실행의 한계 문구가 새 결과에 남지 않게)
     */
    private AppFixProposal retryIfNeeded(AppFixProposal p, Long userId, String sourceLimitation) {
        boolean failed = AppFixProposal.FAILED.equals(p.getStatus());
        boolean withoutAi = AppFixProposal.DIAGNOSIS_ONLY.equals(p.getStatus()) && p.getSummary() == null
                && providers.hasKey(llm.defaultProvider());
        if (!failed && !withoutAi) return p;
        if (proposals.retry(p.getId(), userId, sourceLimitation, java.time.Instant.now()) == 0) {
            return proposals.findById(p.getId()).orElse(p);
        }
        p.setStatus(AppFixProposal.ANALYZING);
        p.setErrorMessage(null);
        p.setRequestedBy(userId);
        p.setLimitation(sourceLimitation);
        p.setSummary(null);
        p.setCauses(null);
        p.setChecks(null);
        p.setFiles(null);
        p.setVerification(null);
        return start(p);
    }

    /** 비동기 분석을 맡긴다. 대기열이 가득 차 맡기지 못하면 실패로 남겨 다시 요청할 수 있게 한다 (분석 중으로 멈춰 있지 않게) */
    private AppFixProposal start(AppFixProposal p) {
        try {
            self.runAsync(p.getId());
            return p;
        } catch (TaskRejectedException e) {
            p.setStatus(AppFixProposal.FAILED);
            p.setErrorMessage("분석 대기열이 가득 찼어요. 잠시 뒤 다시 요청하세요.");
            return proposals.save(p);
        }
    }

    /** 서버 재시작 전부터 분석 중이던 것만 실패로 돌린다. 기동 뒤 시작한 분석은 건드리지 않는다 */
    @EventListener(ApplicationReadyEvent.class)
    public void failInterrupted() {
        proposals.failInterrupted(bootedAt, "API 서버 재시작으로 분석이 중단됐어요. 다시 요청하세요.", java.time.Instant.now());
    }

    private record Source(String slug, String branch, String sha, String limitation) {}

    /** 테스트 저장소가 아닌 "앱 소스 저장소"만 본다. 1단계는 토큰 없는 공개 저장소만 읽는다 */
    private Source source(Project project) {
        String url = project.getSourceRepositoryUrl();
        if (url == null || url.isBlank()) {
            return new Source(null, null, null,
                    "웹주소만 연결돼 있어 소스 없이 실행 증거로만 진단했어요. 앱 소스 저장소를 연결하면 파일별 수정안을 볼 수 있어요.");
        }
        String slug = git.validateAndNormalize(url);
        String branch = project.getSourceRepositoryBranch();
        try {
            return new Source(slug, branch, git.remoteHeadSha(project.getProjectId(), url, branch), null);
        } catch (ApiException e) {
            // 502 는 저장소를 읽지 못한 것, 그 밖(Docker 꺼짐 · 샌드박스 준비 실패)은 서버 환경 문제다
            return new Source(slug, branch, null, e.getStatus() == 502
                    ? "공개 저장소로 읽지 못해(비공개 저장소이거나 주소 · 브랜치가 다름) 진단만 제공해요. 비공개 저장소 읽기는 다음 단계에서 연결해요."
                    : "저장소를 읽을 격리 환경을 쓸 수 없어 진단만 제공해요: " + e.getMessage());
        }
    }

    static String identity(String... parts) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256")
                    .digest(String.join("\n", java.util.Arrays.stream(parts).map(String::valueOf).toList()).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    /** 오류 · 실패한 케이스의 단계. 인증 정보 · 개인정보 · 프로젝트 환경값을 지운 뒤 저장하고 모델에도 이것만 보낸다 */
    private String evidence(Project project, Defect defect, Long executionId) {
        StringBuilder out = new StringBuilder()
                .append("케이스: ").append(String.join(" > ", java.util.stream.Stream.of(defect.describePath(), defect.title())
                        .filter(s -> s != null && !s.isBlank()).toList()))
                .append(" (").append(defect.specPath()).append(")\n")
                .append("실패 실행: #").append(executionId).append('\n')
                .append("오류:\n").append(defect.errorMessage() == null ? "(없음)" : defect.errorMessage().strip()).append('\n');
        // 단계 기록의 제목은 "파일 > 묶음 > 케이스". 끝부분이 같은 다른 케이스(예: 총합계)를 고르지 않게 " > " 경계까지 맞춘다
        String caseTitle = " > " + String.join(" > ", java.util.stream.Stream.of(defect.describePath(), defect.title())
                .filter(s -> s != null && !s.isBlank()).toList());
        try {
            steps.steps(project.getProjectId(), executionId).cases().stream()
                    .filter(c -> DefectService.samePath(c.specPath(), defect.specPath()) && c.title().endsWith(caseTitle))
                    .findFirst()
                    .ifPresent(c -> {
                        out.append("단계:\n");
                        for (int i = 0; i < c.steps().size(); i++) {
                            StepRecordService.Step s = c.steps().get(i);
                            out.append(i + 1).append(". ").append(s.text()).append(" [").append(s.status()).append(']');
                            if (s.error() != null) out.append(" — ").append(s.error().lines().findFirst().orElse(""));
                            out.append('\n');
                        }
                    });
        } catch (RuntimeException e) {
            // 단계 기록이 없으면 오류만으로 진단한다
        }
        String clean = AppFixRules.redact(out.toString(), ProjectEnvVariables.parse(project.getEnvVariables()).values());
        return clean.length() <= MAX_EVIDENCE ? clean : clean.substring(0, MAX_EVIDENCE) + "\n… (이후 생략)";
    }

    // ── 비동기 분석 ──

    @Async("aiJobExecutor")
    public void runAsync(Long id) {
        AppFixProposal p = proposals.findById(id).orElse(null);
        if (p == null) return;
        Path work = Path.of(properties.storageRoot(), "app-fix", String.valueOf(id)).toAbsolutePath().normalize();
        try {
            List<String> limits = new ArrayList<>();
            if (p.getLimitation() != null) limits.add(p.getLimitation());
            Map<String, String> files = p.getSourceSha() == null ? Map.of() : readSource(p, work, limits);

            AiModelProvider provider = llm.defaultProvider();
            if (!providers.hasKey(provider)) {
                limits.add("AI 설정(키)이 없어 원인 분석 없이 실행 증거만 보여 줘요.");
                p.setStatus(AppFixProposal.DIAGNOSIS_ONLY);
            } else {
                JsonNode answer = parse(llm.chat(provider, SYSTEM, prompt(p, files), "APP_FIX_PROPOSAL", p.getProjectId()));
                p.setSummary(answer.path("summary").asText(null));
                p.setCauses(JSON.writeValueAsString(strings(answer.path("causes"))));
                p.setChecks(JSON.writeValueAsString(strings(answer.path("checks"))));
                List<FileDiff> diffs = diffs(answer.path("edits"), files);
                if (!diffs.isEmpty()) {
                    p.setFiles(JSON.writeValueAsString(diffs));
                    p.setVerification(AppFixProposal.DIFF_APPLIES);
                    p.setStatus(AppFixProposal.DIFF_READY);
                } else {
                    if (!files.isEmpty()) limits.add("후보 파일에 그대로 적용할 수 있는 수정을 만들지 못해 진단만 제공해요.");
                    p.setStatus(AppFixProposal.DIAGNOSIS_ONLY);
                }
            }
            p.setLimitation(limits.isEmpty() ? null : String.join("\n", limits));
        } catch (Exception e) {
            p.setStatus(AppFixProposal.FAILED);
            p.setErrorMessage(AppFixRules.redact(String.valueOf(e.getMessage()), Set.of()));
            log.warn("제품 코드 수정안 {} 분석 실패: {}", id, e.getClass().getSimpleName());
        } finally {
            try {
                FileSystemUtils.deleteRecursively(work);
            } catch (IOException ignored) {
                // 다음 분석이 폴더를 비우고 쓴다
            }
            proposals.save(p);
        }
    }

    /** 기준 커밋만 받아 앱 폴더에서 후보 파일(저장소 기준 경로 → 내용)을 고른다. 못 쓰면 이유를 limits 에 남기고 빈 결과 */
    private Map<String, String> readSource(AppFixProposal p, Path work, List<String> limits) throws IOException {
        Files.createDirectories(work);
        try {
            // 요청 때 고정한 저장소만 쓴다. 그 뒤 바뀐 프로젝트 설정은 다른 작업이다
            git.fetchCommit(p.getProjectId(), "https://github.com/" + p.getSourceRepository(), p.getSourceSha(),
                    docker.directoryContainerPath(work), docker.directoryVolumeArgs(work));
        } catch (ApiException e) {
            limits.add("기준 커밋을 받지 못해 진단만 제공해요.");
            return Map.of();
        }
        if (!p.getSourceSha().equals(SiteAnalysisService.readCommitSha(work))) {
            limits.add("받은 소스가 기준 커밋(" + p.getSourceSha().substring(0, 7) + ")과 달라 쓰지 않았어요.");
            return Map.of();
        }
        String appRoot = p.getAppRoot() != null ? p.getAppRoot() : screenFinder.find(work).appRoot();
        p.setAppRoot(appRoot);
        Path app = appRoot == null ? work : work.resolve(appRoot).normalize();
        // 링크로 된 앱 폴더가 격리 폴더 밖을 가리키면 읽지 않는다
        if (!Files.isDirectory(app) || !app.toRealPath().startsWith(work.toRealPath())) {
            limits.add("앱 폴더(" + appRoot + ")가 기준 커밋 안의 폴더가 아니라 읽지 않았어요.");
            return Map.of();
        }
        Map<String, String> files = candidates(work, app, AppFixRules.clues(p.getEvidence()), limits);
        if (files.isEmpty()) limits.add("실행 증거에 맞는 소스 파일을 앱 폴더에서 찾지 못해 진단만 제공해요.");
        return files;
    }

    private record Scored(String path, String content, int score) {}

    /** 단서(화면 경로 · 버튼 이름 · API 경로 · 스택 파일명)가 많이 맞는 순서로 상한까지 */
    static Map<String, String> candidates(Path repo, Path app, Set<String> clues, List<String> limits) throws IOException {
        List<Scored> scored = new ArrayList<>();
        Files.walkFileTree(app, new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) {
                return !dir.equals(app) && SKIP_DIRS.contains(dir.getFileName().toString())
                        ? FileVisitResult.SKIP_SUBTREE : FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
                String name = file.getFileName().toString();
                // 링크는 따라가지 않는다 (저장소 밖 파일을 가리킬 수 있다)
                if (!attrs.isRegularFile() || name.startsWith(".env") || attrs.size() > MAX_FILE_BYTES || EXTENSIONS.stream().noneMatch(name::endsWith)) {
                    return FileVisitResult.CONTINUE;
                }
                String path = repo.relativize(file).toString().replace('\\', '/');
                String content;
                try {
                    content = Files.readString(file, StandardCharsets.UTF_8);
                } catch (IOException e) {
                    return FileVisitResult.CONTINUE; // UTF-8 이 아닌 파일 · 읽을 수 없는 파일은 후보에서 뺀다
                }
                int score = 0;
                for (String clue : clues) {
                    String bare = clue.startsWith("/") ? clue.substring(1) : clue;
                    if (content.contains(clue) || (!bare.isEmpty() && path.contains(bare))) score++;
                }
                if (score > 0) scored.add(new Scored(path, content, score));
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult visitFileFailed(Path file, IOException e) {
                return FileVisitResult.CONTINUE;
            }
        });
        scored.sort(Comparator.comparingInt(Scored::score).reversed().thenComparing(Scored::path));
        Map<String, String> out = new LinkedHashMap<>();
        int bytes = 0;
        boolean cut = false;
        for (Scored s : scored) {
            int size = s.content().getBytes(StandardCharsets.UTF_8).length;
            if (out.size() >= MAX_FILES || bytes + size > MAX_BYTES) {
                cut = true;
                continue;
            }
            out.put(s.path(), s.content());
            bytes += size;
        }
        if (cut) limits.add("입력 상한(파일 " + MAX_FILES + "개 · 30KiB)에 걸려 일부 후보 파일만 봤어요.");
        return out;
    }

    private static String prompt(AppFixProposal p, Map<String, String> files) {
        StringBuilder out = new StringBuilder("## 분류\n").append(p.getCategory()).append("\n\n## 실행 증거\n").append(p.getEvidence());
        if (files.isEmpty()) {
            out.append("\n\n## 소스\n없음. 증거만으로 진단하고 edits 는 비운다.\n");
        } else {
            out.append("\n\n## 소스 (").append(p.getSourceRepository()).append(" @ ").append(p.getSourceSha()).append(")\n");
            files.forEach((path, content) -> out.append("\n### ").append(path).append("\n```\n").append(numbered(content)).append("```\n"));
        }
        return out.toString();
    }

    private static String numbered(String content) {
        StringBuilder out = new StringBuilder();
        String[] lines = content.split("\n", -1);
        for (int i = 0; i < lines.length; i++) {
            if (i == lines.length - 1 && lines[i].isEmpty()) break;
            out.append(i + 1).append(": ").append(lines[i]).append('\n');
        }
        return out.toString();
    }

    private static JsonNode parse(String answer) throws IOException {
        int start = answer == null ? -1 : answer.indexOf('{');
        int end = answer == null ? -1 : answer.lastIndexOf('}');
        if (start < 0 || end < start) throw new IOException("AI 응답에서 JSON 을 찾지 못했습니다.");
        return JSON.readTree(answer.substring(start, end + 1));
    }

    private static List<String> strings(JsonNode array) {
        List<String> out = new ArrayList<>();
        array.forEach(n -> { if (n.isTextual() && !n.asText().isBlank()) out.add(n.asText()); });
        return out;
    }

    /** 후보 파일 안에서, 원본에 그대로 적용되는 수정만 diff 로 만든다 */
    private static List<FileDiff> diffs(JsonNode edits, Map<String, String> files) {
        Map<String, List<AppFixRules.Edit>> byFile = new LinkedHashMap<>();
        edits.forEach(e -> {
            String path = e.path("path").asText("");
            if (files.containsKey(path)) {
                byFile.computeIfAbsent(path, k -> new ArrayList<>())
                        .add(new AppFixRules.Edit(path, e.path("find").asText(null), e.path("replace").asText(null)));
            }
        });
        List<FileDiff> out = new ArrayList<>();
        byFile.forEach((path, list) -> {
            String diff = AppFixRules.unifiedDiff(path, files.get(path), list);
            if (diff != null) out.add(new FileDiff(path, diff));
        });
        return out;
    }
}
