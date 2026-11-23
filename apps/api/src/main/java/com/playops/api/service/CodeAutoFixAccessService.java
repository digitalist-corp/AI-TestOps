package com.playops.api.service;

import com.playops.api.dto.CodeAutoFixDtos.Mine;
import com.playops.api.dto.CodeAutoFixDtos.RequestView;
import com.playops.api.entity.CodeAutoFixGrant;
import com.playops.api.entity.Project;
import com.playops.api.entity.ProjectMember;
import com.playops.api.entity.ProjectRole;
import com.playops.api.entity.User;
import com.playops.api.entity.UserRole;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.CodeAutoFixGrantRepository;
import com.playops.api.repository.ProjectMemberRepository;
import com.playops.api.repository.UserRepository;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;

/**
 * 코드 자동 수정 사용권. 팀원은 본인 것을 요청하고, 같은 프로젝트 PM · 관리자가 범위를 정해 부여 · 거절 · 회수한다.
 *
 * - 기본은 없음. 관리자 · PM 은 요청 없이 전 범위를 쓴다(관리하는 쪽).
 * - 멤버십에 묶는다: 지금 멤버 행이 없거나 가입 시각(memberSince)이 다르면(빠졌다 다시 들어옴) 그 줄은 없는 것으로 본다.
 * - 역할은 요청마다 DB 에서 다시 본다. 다른 프로젝트 경로로 다른 프로젝트의 요청을 다룰 수 없다.
 * - 범위를 줘도 실제 자동 수정 실행 · PR 게시 연동은 아직 없다(integrationReady=false). PR 게시는 diff 마다 사람 승인이 따로 필요하다.
 */
@Service
public class CodeAutoFixAccessService {

    public static final String PENDING = "PENDING";
    public static final String GRANTED = "GRANTED";
    public static final String REJECTED = "REJECTED";
    public static final String REVOKED = "REVOKED";
    /** AUTO_FIX: 자동 수정 · 재검증 요청. PR_PUBLISH: 검증 후 PR 게시 요청 */
    public static final List<String> SCOPES = List.of("AUTO_FIX", "PR_PUBLISH");

    private final CodeAutoFixGrantRepository grants;
    private final ProjectMemberRepository members;
    private final UserRepository users;
    private final NotificationService notifications;
    private final ProjectService projects;

    public CodeAutoFixAccessService(CodeAutoFixGrantRepository grants, ProjectMemberRepository members, UserRepository users,
                                    NotificationService notifications, ProjectService projects) {
        this.grants = grants;
        this.members = members;
        this.users = users;
        this.notifications = notifications;
        this.projects = projects;
    }

    /** 내 역할 · 지금 쓸 수 있는 범위 · 내 요청 */
    public Mine me(String projectId, User actor) {
        if (isAdmin(actor)) {
            return new Mine("ADMIN", SCOPES, true, null, false);
        }
        ProjectMember member = memberOf(projectId, actor)
                .orElseThrow(() -> new ApiException(403, "FORBIDDEN", "이 프로젝트의 멤버가 아닙니다."));
        if (member.getRole() == ProjectRole.PM) {
            return new Mine("PM", SCOPES, true, null, false);
        }
        Optional<CodeAutoFixGrant> mine = current(projectId, member);
        List<String> scopes = mine.filter(g -> GRANTED.equals(g.getStatus())).map(g -> scopes(g)).orElse(List.of());
        return new Mine("MEMBER", scopes, false, mine.map(g -> view(g, null)).orElse(null), false);
    }

    /** 팀원 본인 요청. 대기 · 부여 중이면 그 줄을 돌려주고(알림 없음), 없거나 거절 · 회수 · 이전 멤버십이면 대기로 만들고 PM 에게 알린다 */
    public RequestView request(String projectId, User actor, String note) {
        if (isAdmin(actor)) {
            throw new ApiException(400, "VALIDATION_ERROR", "관리자는 요청 없이 사용권을 관리합니다.");
        }
        ProjectMember member = memberOf(projectId, actor)
                .orElseThrow(() -> new ApiException(403, "FORBIDDEN", "이 프로젝트의 멤버가 아닙니다."));
        if (member.getRole() == ProjectRole.PM) {
            throw new ApiException(400, "VALIDATION_ERROR", "PM은 요청 없이 사용권을 관리합니다.");
        }
        String reason = note == null || note.isBlank() ? null : note.strip();
        if (reason != null && reason.length() > 500) {
            throw new ApiException(400, "VALIDATION_ERROR", "요청 사유는 500자까지 적을 수 있습니다.");
        }
        Optional<CodeAutoFixGrant> existing = grants.findByProjectIdAndUserId(projectId, actor.getId());
        if (existing.isPresent() && sameMembership(existing.get(), member)
                && (PENDING.equals(existing.get().getStatus()) || GRANTED.equals(existing.get().getStatus()))) {
            return view(existing.get(), null);
        }
        CodeAutoFixGrant g;
        if (existing.isPresent()) {
            // 거절 · 회수 · 이전 멤버십의 줄을 다시 연다. 동시에 여러 번 와도 한 요청만 열고 그 요청만 알린다
            Long id = existing.get().getId();
            boolean reopened = grants.reopen(id, member.getCreatedAt(), reason, Instant.now()) == 1;
            g = grants.findById(id).orElseThrow(() -> new ApiException(404, "NOT_FOUND", "사용권 요청을 찾을 수 없습니다."));
            if (!reopened) return view(g, null);
        } else {
            g = new CodeAutoFixGrant();
            g.setProjectId(projectId);
            g.setUserId(actor.getId());
            g.setStatus(PENDING);
            g.setMemberSince(member.getCreatedAt());
            g.setNote(reason);
            try {
                g = grants.saveAndFlush(g);
            } catch (DataIntegrityViolationException e) {
                // 처음 요청이 동시에 왔다. 먼저 만든 줄을 쓴다.
                return view(grants.findByProjectIdAndUserId(projectId, actor.getId()).orElseThrow(() -> e), null);
            }
        }
        Project project = projects.getProject(projectId);
        notifications.autoFixAccessRequested(project, nameOf(actor), g.getId());
        return view(g, null);
    }

    /** PM · 관리자: 지금 멤버인 사람의 요청만 (최근 요청 먼저) */
    public List<RequestView> list(String projectId, User actor) {
        requireManager(projectId, actor);
        List<CodeAutoFixGrant> rows = grants.findByProjectIdOrderByRequestedAtDesc(projectId).stream()
                .filter(g -> memberOf(projectId, g.getUserId()).map(m -> sameMembership(g, m)).orElse(false))
                .toList();
        Map<Long, String> names = new HashMap<>();
        users.findAllById(rows.stream().map(CodeAutoFixGrant::getUserId).toList()).forEach(u -> names.put(u.getId(), nameOf(u)));
        return rows.stream().map(g -> view(g, names.get(g.getUserId()))).toList();
    }

    /** 대기 중이거나 이미 부여된 요청에 범위를 정해 준다 (범위 바꾸기도 이것) */
    public RequestView grant(String projectId, Long requestId, List<String> scopes, User actor) {
        Set<String> chosen = new LinkedHashSet<>(scopes == null ? List.of() : scopes);
        if (chosen.isEmpty() || !SCOPES.containsAll(chosen)) {
            throw new ApiException(400, "VALIDATION_ERROR", "허용 범위를 하나 이상 고르세요: " + String.join(", ", SCOPES));
        }
        return decide(projectId, requestId, actor, List.of(PENDING, GRANTED), GRANTED,
                String.join(",", SCOPES.stream().filter(chosen::contains).toList()));
    }

    public RequestView reject(String projectId, Long requestId, User actor) {
        return decide(projectId, requestId, actor, List.of(PENDING), REJECTED, null);
    }

    public RequestView revoke(String projectId, Long requestId, User actor) {
        return decide(projectId, requestId, actor, List.of(GRANTED), REVOKED, null);
    }

    /** 확인한 뒤 조건부 갱신 하나로 바꾼다. 그 사이 다른 PM 이 먼저 처리했으면 409 (늦은 쪽이 덮지 않는다) */
    private RequestView decide(String projectId, Long requestId, User actor, List<String> from, String to, String scopes) {
        decidable(projectId, requestId, actor, from.toArray(String[]::new));
        if (grants.transition(requestId, from, to, scopes, actor.getId(), Instant.now()) == 0) {
            throw new ApiException(409, "STATE_CONFLICT", "다른 사람이 먼저 처리했습니다. 새로 고친 뒤 다시 확인하세요.");
        }
        return view(grants.findById(requestId).orElseThrow(), null);
    }

    private CodeAutoFixGrant decidable(String projectId, Long requestId, User actor, String... from) {
        requireManager(projectId, actor);
        CodeAutoFixGrant g = grants.findById(requestId).filter(r -> projectId.equals(r.getProjectId()))
                .orElseThrow(() -> new ApiException(404, "NOT_FOUND", "사용권 요청을 찾을 수 없습니다."));
        boolean stillMember = memberOf(projectId, g.getUserId()).map(m -> sameMembership(g, m)).orElse(false);
        if (!stillMember) {
            throw new ApiException(409, "STATE_CONFLICT", "요청한 사람이 더 이상 이 프로젝트의 팀원이 아닙니다.");
        }
        if (!Arrays.asList(from).contains(g.getStatus())) {
            throw new ApiException(409, "STATE_CONFLICT", "지금 상태(" + g.getStatus() + ")에서는 할 수 없습니다.");
        }
        return g;
    }

    /** 관리자는 기존 정책대로 모든 프로젝트, 그 밖에는 그 프로젝트의 PM (DB 에서 다시 본다) */
    private void requireManager(String projectId, User actor) {
        if (isAdmin(actor)) return;
        if (memberOf(projectId, actor).map(ProjectMember::getRole).orElse(null) != ProjectRole.PM) {
            throw new ApiException(403, "FORBIDDEN", "이 프로젝트의 PM 또는 관리자만 할 수 있습니다.");
        }
    }

    private Optional<CodeAutoFixGrant> current(String projectId, ProjectMember member) {
        return grants.findByProjectIdAndUserId(projectId, member.getUserId()).filter(g -> sameMembership(g, member));
    }

    private Optional<ProjectMember> memberOf(String projectId, User user) {
        return user == null || user.getId() == null ? Optional.empty() : memberOf(projectId, user.getId());
    }

    private Optional<ProjectMember> memberOf(String projectId, Long userId) {
        return members.findByProjectIdAndUserId(projectId, userId);
    }

    /** DB 가 시각을 마이크로초까지 저장해 밀리초까지만 견준다 */
    private static boolean sameMembership(CodeAutoFixGrant g, ProjectMember m) {
        return g.getMemberSince() != null && m.getCreatedAt() != null
                && g.getMemberSince().truncatedTo(ChronoUnit.MILLIS).equals(m.getCreatedAt().truncatedTo(ChronoUnit.MILLIS));
    }

    private static List<String> scopes(CodeAutoFixGrant g) {
        return g.getScopes() == null || g.getScopes().isBlank() ? List.of() : List.of(g.getScopes().split(","));
    }

    private static RequestView view(CodeAutoFixGrant g, String userName) {
        return new RequestView(g.getId(), g.getUserId(), userName, g.getStatus(), scopes(g), g.getNote(), g.getRequestedAt(),
                g.getDecidedBy(), g.getDecidedAt());
    }

    private static boolean isAdmin(User user) {
        return user != null && user.getRole() == UserRole.ADMIN;
    }

    private static String nameOf(User user) {
        return Objects.requireNonNullElse(user.getDisplayName() == null || user.getDisplayName().isBlank()
                ? user.getUsername() : user.getDisplayName(), "팀원");
    }
}
