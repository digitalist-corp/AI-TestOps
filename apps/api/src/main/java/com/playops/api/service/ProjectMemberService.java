package com.playops.api.service;

import com.playops.api.dto.MemberDtos.Member;
import com.playops.api.dto.MemberDtos.UserCandidate;
import com.playops.api.entity.ProjectMember;
import com.playops.api.entity.ProjectRole;
import com.playops.api.entity.User;
import com.playops.api.entity.UserRole;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.ProjectMemberRepository;
import com.playops.api.repository.UserRepository;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 프로젝트 멤버(#104). 규칙 (11/17 결정):
 * PM 지정 · 해제 · 역할 변경은 관리자만, 팀원 추가 · 제외는 관리자 또는 그 프로젝트의 PM.
 */
@Service
public class ProjectMemberService {

    private final ProjectMemberRepository memberRepository;
    private final UserRepository userRepository;

    public ProjectMemberService(ProjectMemberRepository memberRepository, UserRepository userRepository) {
        this.memberRepository = memberRepository;
        this.userRepository = userRepository;
    }

    public Optional<ProjectRole> roleOf(String projectId, User user) {
        if (user == null || user.getId() == null) {
            return Optional.empty();
        }
        return memberRepository.findByProjectIdAndUserId(projectId, user.getId()).map(ProjectMember::getRole);
    }

    /** 이 사용자가 멤버(PM · 팀원)인 프로젝트와 역할 */
    public Map<String, ProjectRole> projectsOf(User user) {
        if (user == null || user.getId() == null) {
            return Map.of();
        }
        return memberRepository.findByUserId(user.getId()).stream()
                .collect(Collectors.toMap(ProjectMember::getProjectId, ProjectMember::getRole));
    }

    public List<Member> list(String projectId) {
        List<ProjectMember> members = memberRepository.findByProjectId(projectId);
        Map<Long, User> users = userRepository.findAllById(members.stream().map(ProjectMember::getUserId).toList())
                .stream().collect(Collectors.toMap(User::getId, Function.identity()));
        return members.stream()
                .filter(m -> users.containsKey(m.getUserId()))
                .map(m -> {
                    User u = users.get(m.getUserId());
                    return new Member(u.getId(), u.getUsername(), u.getDisplayName(), m.getRole());
                })
                .sorted(Comparator.comparing(Member::role).thenComparing(Member::username))
                .toList();
    }

    public List<UserCandidate> search(String projectId, String query, User actor) {
        requireCanManage(projectId, actor, ProjectRole.MEMBER);
        String q = query == null ? "" : query.trim();
        return userRepository.search(q, PageRequest.of(0, 20)).stream()
                .map(u -> new UserCandidate(u.getId(), u.getUsername(), u.getDisplayName()))
                .toList();
    }

    @Transactional
    public Member add(String projectId, Long userId, ProjectRole role, User actor) {
        ProjectRole target = role != null ? role : ProjectRole.MEMBER;
        requireCanManage(projectId, actor, target);
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ApiException(404, "NOT_FOUND", "사용자를 찾을 수 없습니다."));
        if (memberRepository.findByProjectIdAndUserId(projectId, userId).isPresent()) {
            throw new ApiException(409, "STATE_CONFLICT", "이미 프로젝트 멤버입니다.");
        }
        memberRepository.save(ProjectMember.of(projectId, userId, target, actor.getId()));
        return new Member(user.getId(), user.getUsername(), user.getDisplayName(), target);
    }

    @Transactional
    public void changeRole(String projectId, Long userId, ProjectRole role, User actor) {
        requireAdmin(actor);
        if (role == null) {
            throw new ApiException(400, "VALIDATION_ERROR", "역할을 고르세요.");
        }
        ProjectMember member = find(projectId, userId);
        member.setRole(role);
        member.setUpdatedBy(actor.getId());
        memberRepository.save(member);
    }

    @Transactional
    public void remove(String projectId, Long userId, User actor) {
        ProjectMember member = find(projectId, userId);
        requireCanManage(projectId, actor, member.getRole());
        memberRepository.delete(member);
    }

    private ProjectMember find(String projectId, Long userId) {
        return memberRepository.findByProjectIdAndUserId(projectId, userId)
                .orElseThrow(() -> new ApiException(404, "NOT_FOUND", "프로젝트 멤버가 아닙니다."));
    }

    /** 관리자는 무엇이든, PM 은 팀원만 넣고 뺀다. */
    private void requireCanManage(String projectId, User actor, ProjectRole target) {
        if (isAdmin(actor)) {
            return;
        }
        if (target == ProjectRole.MEMBER && roleOf(projectId, actor).orElse(null) == ProjectRole.PM) {
            return;
        }
        throw new ApiException(403, "FORBIDDEN", target == ProjectRole.PM
                ? "PM 지정 · 해제는 관리자만 할 수 있습니다."
                : "팀원 추가 · 제외는 이 프로젝트의 PM 또는 관리자만 할 수 있습니다.");
    }

    private static void requireAdmin(User actor) {
        if (!isAdmin(actor)) {
            throw new ApiException(403, "FORBIDDEN", "PM 지정 · 해제는 관리자만 할 수 있습니다.");
        }
    }

    private static boolean isAdmin(User actor) {
        return actor != null && actor.getRole() == UserRole.ADMIN;
    }
}
