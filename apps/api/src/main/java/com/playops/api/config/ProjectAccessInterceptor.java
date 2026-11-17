package com.playops.api.config;

import com.playops.api.entity.AiJob;
import com.playops.api.entity.Execution;
import com.playops.api.entity.ProjectRole;
import com.playops.api.entity.User;
import com.playops.api.entity.UserRole;
import com.playops.api.repository.AiJobRepository;
import com.playops.api.repository.ExecutionRepository;
import com.playops.api.service.AiBootstrapService;
import com.playops.api.service.ProjectMemberService;
import jakarta.servlet.DispatcherType;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 관리자 · PM · 팀원 권한을 한 곳에서 막는다 (#105). AuthInterceptor 다음에 돈다.
 *
 * - 관리자: 모두 통과
 * - 관리자 전용: 사용자 관리 · 러너 · 리소스 · 템플릿 변경 · 프로젝트 생성/삭제
 * - 프로젝트 하위 경로(/api/projects/{id}/**, 실행 · AI 작업 · 첫 테스트 생성 id 경로 포함): 멤버가 아니면 403.
 *   조회(GET)는 멤버 모두, 쓰기는 PM. 팀원은 MEMBER_WRITES(실행 · 재실행 · 취소)만.
 *
 * 쓰기는 허용 목록 방식이라 새 API 를 만들고 깜빡해도 팀원에게는 막힌다.
 */
@Component
public class ProjectAccessInterceptor implements HandlerInterceptor {

    private static final Pattern PROJECT_PATH = Pattern.compile("^/api/projects/([^/]+)(/.*)?$");
    private static final Pattern EXECUTION_PATH = Pattern.compile("^/api/executions/(\\d+)(/.*)?$");
    private static final Pattern AI_JOB_PATH = Pattern.compile("^/api/ai-jobs/(\\d+)(/.*)?$");
    private static final Pattern BOOTSTRAP_PATH = Pattern.compile("^/api/ai/bootstrap/([^/]+)(/.*)?$");
    /** /api/projects/ 바로 아래지만 프로젝트 id 가 아닌 경로 */
    private static final Set<String> NOT_PROJECT_IDS = Set.of("docker", "site-check");
    /** 팀원이 할 수 있는 쓰기 (프로젝트 기준 상대 경로): 실행 · 실패 재실행 · 러너 켜기 · 실행 취소 */
    private static final List<Pattern> MEMBER_WRITES = List.of(
            Pattern.compile("^POST /executions$"),
            Pattern.compile("^POST /test-suites/\\d+/execute$"),
            Pattern.compile("^POST /docker/start$"),
            Pattern.compile("^POST /execution/\\d+/cancel$")
    );

    private final ProjectMemberService memberService;
    private final ExecutionRepository executionRepository;
    private final AiJobRepository aiJobRepository;
    private final AiBootstrapService bootstrapService;

    public ProjectAccessInterceptor(ProjectMemberService memberService, ExecutionRepository executionRepository,
                                    AiJobRepository aiJobRepository, AiBootstrapService bootstrapService) {
        this.memberService = memberService;
        this.executionRepository = executionRepository;
        this.aiJobRepository = aiJobRepository;
        this.bootstrapService = bootstrapService;
    }

    private record Target(String projectId, String action) {}

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
        User user = (User) request.getAttribute("currentUser");
        if (user == null || user.getRole() == UserRole.ADMIN
                || "OPTIONS".equalsIgnoreCase(request.getMethod())
                || request.getDispatcherType() == DispatcherType.ASYNC) {
            return true;
        }
        String method = request.getMethod().toUpperCase();
        String path = request.getRequestURI();

        if (adminOnly(method, path)) {
            return deny(response, "관리자만 할 수 있습니다.");
        }
        Target target = target(path);
        if (target == null) {
            return true;
        }
        Optional<ProjectRole> role = memberService.roleOf(target.projectId(), user);
        if (role.isEmpty()) {
            return deny(response, "이 프로젝트의 멤버가 아닙니다.");
        }
        if (method.equals("GET") || method.equals("HEAD") || role.get() == ProjectRole.PM) {
            return true;
        }
        String action = method + " " + target.action();
        if (MEMBER_WRITES.stream().anyMatch(p -> p.matcher(action).matches())) {
            return true;
        }
        return deny(response, "PM 또는 관리자만 할 수 있습니다.");
    }

    static boolean adminOnly(String method, String path) {
        boolean read = method.equals("GET") || method.equals("HEAD");
        return path.startsWith("/api/admin/")
                || path.equals("/api/users") || path.startsWith("/api/users/")
                || path.startsWith("/api/projects/docker/")
                || (method.equals("POST") && path.equals("/api/projects"))
                || (method.equals("DELETE") && path.matches("^/api/projects/[^/]+$"))
                || (!read && (path.equals("/api/templates") || path.startsWith("/api/templates/")));
    }

    private Target target(String path) {
        Matcher m = PROJECT_PATH.matcher(path);
        if (m.matches() && !NOT_PROJECT_IDS.contains(m.group(1))) {
            return new Target(m.group(1), m.group(2) == null ? "" : m.group(2));
        }
        Matcher exec = EXECUTION_PATH.matcher(path);
        if (exec.matches()) {
            String rest = exec.group(2) == null ? "" : exec.group(2);
            return executionRepository.findById(Long.parseLong(exec.group(1)))
                    .map(Execution::getProjectId)
                    .map(projectId -> new Target(projectId, "/execution/" + exec.group(1) + rest))
                    .orElse(null);
        }
        Matcher job = AI_JOB_PATH.matcher(path);
        if (job.matches()) {
            String rest = job.group(2) == null ? "" : job.group(2);
            return aiJobRepository.findById(Long.parseLong(job.group(1)))
                    .map(AiJob::getProjectId)
                    .map(projectId -> new Target(projectId, "/ai-job/" + job.group(1) + rest))
                    .orElse(null);
        }
        Matcher boot = BOOTSTRAP_PATH.matcher(path);
        if (boot.matches()) {
            String rest = boot.group(2) == null ? "" : boot.group(2);
            return bootstrapService.projectIdOf(boot.group(1))
                    .map(projectId -> new Target(projectId, "/ai-bootstrap/" + boot.group(1) + rest))
                    .orElse(null);
        }
        return null;
    }

    private static boolean deny(HttpServletResponse response, String message) throws Exception {
        response.setStatus(HttpServletResponse.SC_FORBIDDEN);
        response.setContentType("application/json;charset=UTF-8");
        response.getWriter().write(
                "{\"message\":\"" + message + "\",\"error\":{\"code\":\"FORBIDDEN\",\"message\":\"" + message + "\",\"details\":[]}}"
        );
        return false;
    }
}
