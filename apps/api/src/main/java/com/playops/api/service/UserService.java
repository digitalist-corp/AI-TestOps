package com.playops.api.service;

import com.playops.api.dto.UserAuditLogResponse;
import com.playops.api.dto.UserRequest;
import com.playops.api.dto.UserResponse;
import com.playops.api.dto.UserUpdateRequest;
import com.playops.api.entity.User;
import com.playops.api.entity.UserAuditAction;
import com.playops.api.entity.UserAuditLog;
import com.playops.api.entity.UserRole;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.UserAuditLogRepository;
import com.playops.api.repository.UserRepository;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class UserService {

    private static final String PROTECTED_USERNAME = "admin";

    private final UserRepository userRepository;
    private final UserAuditLogRepository userAuditLogRepository;
    private final PasswordEncoder passwordEncoder;
    private final AuthService authService;

    public UserService(
            UserRepository userRepository,
            UserAuditLogRepository userAuditLogRepository,
            PasswordEncoder passwordEncoder,
            AuthService authService
    ) {
        this.userRepository = userRepository;
        this.userAuditLogRepository = userAuditLogRepository;
        this.passwordEncoder = passwordEncoder;
        this.authService = authService;
    }

    public List<UserResponse> findAll() {
        return userRepository.findAll().stream()
                .map(UserResponse::from)
                .toList();
    }

    public List<UserAuditLogResponse> listAuditLog() {
        return userAuditLogRepository.findTop200ByOrderByCreatedAtDesc().stream()
                .map(UserAuditLogResponse::from)
                .toList();
    }

    @Transactional
    public UserResponse create(UserRequest request, User actingUser) {
        if (request.username() == null || request.username().isBlank()) {
            throw new ApiException(400, "VALIDATION_ERROR", "Username is required");
        }
        String username = request.username().trim();
        if (username.length() > 100) {
            throw new ApiException(400, "VALIDATION_ERROR", "Username must be 1-100 characters");
        }
        if (request.password() == null || request.password().isBlank()) {
            throw new ApiException(400, "VALIDATION_ERROR", "Password is required");
        }
        validatePasswordForRegistration(request.password());
        if (userRepository.existsByUsername(username)) {
            throw new ApiException(409, "STATE_CONFLICT", "Username already exists");
        }

        User user = new User();
        user.setUsername(username);
        user.setPassword(passwordEncoder.encode(request.password()));
        user.setRole(request.role() != null ? request.role() : UserRole.USER);
        user.setEnabled(request.enabled() == null || request.enabled());
        User saved = userRepository.save(user);
        audit(actingUser, UserAuditAction.CREATED, saved, "역할: " + saved.getRole());
        return UserResponse.from(saved);
    }

    @Transactional
    public UserResponse update(Long id, UserUpdateRequest request, User actingUser) {
        User user = userRepository.findById(id)
                .orElseThrow(() -> new ApiException(404, "NOT_FOUND", "User not found"));

        boolean revokeSessions = false;

        if (request.role() != null && request.role() != user.getRole()) {
            if (PROTECTED_USERNAME.equals(user.getUsername())) {
                throw new ApiException(403, "FORBIDDEN", "admin 계정의 역할은 변경할 수 없습니다.");
            }
            if (user.getRole() == UserRole.ADMIN && request.role() != UserRole.ADMIN) {
                requireNotLastAdmin(user, "마지막 관리자 계정의 역할은 변경할 수 없습니다.");
            }
            UserRole previousRole = user.getRole();
            user.setRole(request.role());
            revokeSessions = true;
            audit(actingUser, UserAuditAction.ROLE_CHANGED, user, previousRole + " -> " + request.role());
        }

        if (request.enabled() != null && request.enabled() != user.isEnabled()) {
            if (!request.enabled()) {
                if (PROTECTED_USERNAME.equals(user.getUsername())) {
                    throw new ApiException(403, "FORBIDDEN", "admin 계정은 비활성화할 수 없습니다.");
                }
                if (actingUser != null && actingUser.getId() != null && actingUser.getId().equals(user.getId())) {
                    throw new ApiException(400, "VALIDATION_ERROR", "본인 계정은 비활성화할 수 없습니다.");
                }
                if (user.getRole() == UserRole.ADMIN) {
                    requireNotLastAdmin(user, "마지막 관리자 계정은 비활성화할 수 없습니다.");
                }
                revokeSessions = true;
            }
            user.setEnabled(request.enabled());
            audit(actingUser, UserAuditAction.ENABLED_CHANGED, user, "enabled=" + request.enabled());
        }

        if (request.password() != null && !request.password().isBlank()) {
            validatePasswordForRegistration(request.password());
            user.setPassword(passwordEncoder.encode(request.password()));
            revokeSessions = true;
            audit(actingUser, UserAuditAction.PASSWORD_RESET, user, null);
        }

        User saved = userRepository.save(user);
        if (revokeSessions) {
            authService.revokeAllSessions(saved.getId());
        }
        return UserResponse.from(saved);
    }

    private void validatePasswordForRegistration(String password) {
        AuthService.validatePasswordUtf8Length(password);
        if (password.length() < 10) {
            throw new ApiException(400, "VALIDATION_ERROR", "비밀번호는 최소 10자 이상이어야 합니다.");
        }
    }

    @Transactional
    public void delete(Long id, User actingUser) {
        User user = userRepository.findById(id)
                .orElseThrow(() -> new ApiException(404, "User not found"));
        if (PROTECTED_USERNAME.equals(user.getUsername())) {
            throw new ApiException(403, "Cannot delete admin user");
        }
        if (actingUser != null && actingUser.getId() != null && actingUser.getId().equals(user.getId())) {
            throw new ApiException(400, "본인 계정은 삭제할 수 없습니다.");
        }
        if (user.getRole() == UserRole.ADMIN) {
            requireNotLastAdmin(user, "마지막 관리자 계정은 삭제할 수 없습니다.");
        }
        audit(actingUser, UserAuditAction.DELETED, user, null);
        authService.revokeAllSessions(user.getId());
        userRepository.delete(user);
    }

    @Transactional
    public void revokeAllSessions(Long id, User actingUser) {
        User user = userRepository.findById(id)
                .orElseThrow(() -> new ApiException(404, "User not found"));
        authService.revokeAllSessions(user.getId());
        audit(actingUser, UserAuditAction.SESSIONS_REVOKED, user, null);
    }

    private void requireNotLastAdmin(User user, String message) {
        if (userRepository.countByRoleAndEnabledTrue(UserRole.ADMIN) <= 1) {
            throw new ApiException(400, "VALIDATION_ERROR", message);
        }
    }

    public void recordAccessDenied(User actingUser, String projectId, String resourceType, String resourceId, String detail) {
        UserAuditLog log = new UserAuditLog();
        log.setActorUserId(actingUser != null ? actingUser.getId() : null);
        log.setActorUsername(actingUser != null ? actingUser.getUsername() : null);
        log.setAction(UserAuditAction.ACCESS_DENIED);
        log.setProjectId(projectId);
        log.setResourceType(resourceType);
        log.setResourceId(resourceId);
        log.setOutcome("DENIED");
        log.setDetail(detail);
        userAuditLogRepository.save(log);
    }

    public void recordAuditEvent(
            User actingUser,
            UserAuditAction action,
            String projectId,
            String resourceType,
            String resourceId,
            String outcome,
            String detail
    ) {
        UserAuditLog log = new UserAuditLog();
        log.setActorUserId(actingUser != null ? actingUser.getId() : null);
        log.setActorUsername(actingUser != null ? actingUser.getUsername() : null);
        log.setAction(action);
        log.setProjectId(projectId);
        log.setResourceType(resourceType);
        log.setResourceId(resourceId);
        log.setOutcome(outcome != null ? outcome : "SUCCESS");
        log.setDetail(detail);
        userAuditLogRepository.save(log);
    }

    private void audit(User actingUser, UserAuditAction action, User target, String detail) {
        UserAuditLog log = new UserAuditLog();
        log.setActorUserId(actingUser != null ? actingUser.getId() : null);
        log.setActorUsername(actingUser != null ? actingUser.getUsername() : null);
        log.setAction(action);
        log.setTargetUserId(target.getId());
        log.setTargetUsername(target.getUsername());
        log.setDetail(detail);
        userAuditLogRepository.save(log);
    }
}
