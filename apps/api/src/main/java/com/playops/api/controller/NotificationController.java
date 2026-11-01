package com.playops.api.controller;

import com.playops.api.entity.Notification;
import com.playops.api.entity.User;
import com.playops.api.service.NotificationService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.List;

/** 우상단 알림 창. 자기 알림만 보고 지울 수 있다. */
@RestController
@RequestMapping("/api/notifications")
public class NotificationController {

    private final NotificationService notificationService;

    public NotificationController(NotificationService notificationService) {
        this.notificationService = notificationService;
    }

    public record NotificationResponse(Long id, String kind, String level, String title, String message,
                                       String link, String projectId, Instant createdAt) {
        static NotificationResponse of(Notification n) {
            return new NotificationResponse(n.getId(), n.getKind(), n.getLevel(), n.getTitle(), n.getMessage(),
                    n.getLink(), n.getProjectId(), n.getCreatedAt());
        }
    }

    @GetMapping
    public List<NotificationResponse> list(HttpServletRequest request) {
        return notificationService.list(currentUserId(request)).stream().map(NotificationResponse::of).toList();
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id, HttpServletRequest request) {
        notificationService.delete(currentUserId(request), id);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping
    public ResponseEntity<Void> deleteAll(HttpServletRequest request) {
        notificationService.deleteAll(currentUserId(request));
        return ResponseEntity.noContent().build();
    }

    private static Long currentUserId(HttpServletRequest request) {
        return ((User) request.getAttribute("currentUser")).getId();
    }
}
