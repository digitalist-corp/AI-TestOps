package com.playops.api.service;

import com.playops.api.dto.NoticeDtos.Notice;
import com.playops.api.dto.NoticeDtos.NoticeRequest;
import com.playops.api.entity.BoardPost;
import com.playops.api.entity.User;
import com.playops.api.entity.UserRole;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.BoardPostRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;

/**
 * 공지사항(#116). 관리자만 쓰고 · 고치고 · 지우고 · 고정하며, 모두 읽는다.
 * 관리자 외에는 게시 기간 안의 공지만 보인다. 지우기는 deleted 표시(숨김)다.
 * 쓰기는 ProjectAccessInterceptor 가 경로로도 막지만, 여기서도 한 번 더 본다.
 */
@Service
public class NoticeService {

    private final BoardPostRepository repository;
    private final NotificationService notificationService;

    public NoticeService(BoardPostRepository repository, NotificationService notificationService) {
        this.repository = repository;
        this.notificationService = notificationService;
    }

    public List<Notice> list(User reader) {
        Instant now = Instant.now();
        return repository.findByTypeAndDeletedFalseOrderByPinnedDescCreatedAtDesc(BoardPost.NOTICE).stream()
                .filter(p -> isAdmin(reader) || p.shownAt(now))
                .map(Notice::from)
                .toList();
    }

    public Notice get(Long id, User reader) {
        BoardPost post = find(id);
        if (!isAdmin(reader) && !post.shownAt(Instant.now())) {
            throw new ApiException(404, "NOT_FOUND", "공지를 찾을 수 없습니다.");
        }
        return Notice.from(post);
    }

    @Transactional
    public Notice create(NoticeRequest request, User actor) {
        requireAdmin(actor);
        BoardPost post = new BoardPost();
        post.setType(BoardPost.NOTICE);
        post.setCreatedBy(actor.getUsername());
        apply(post, request);
        BoardPost saved = repository.save(post);
        notificationService.noticePosted(saved.getId(), saved.getTitle());
        return Notice.from(saved);
    }

    @Transactional
    public Notice update(Long id, NoticeRequest request, User actor) {
        requireAdmin(actor);
        BoardPost post = find(id);
        apply(post, request);
        post.setUpdatedBy(actor.getUsername());
        return Notice.from(repository.save(post));
    }

    @Transactional
    public void delete(Long id, User actor) {
        requireAdmin(actor);
        BoardPost post = find(id);
        post.setDeleted(true);
        post.setUpdatedBy(actor.getUsername());
        repository.save(post);
    }

    private static void apply(BoardPost post, NoticeRequest request) {
        String title = request == null || request.title() == null ? "" : request.title().trim();
        String content = request == null || request.content() == null ? "" : request.content().trim();
        if (title.isEmpty() || title.length() > 200) {
            throw new ApiException(400, "VALIDATION_ERROR", "제목은 1~200자로 입력하세요.");
        }
        if (content.isEmpty()) {
            throw new ApiException(400, "VALIDATION_ERROR", "내용을 입력하세요.");
        }
        if (request.visibleFrom() != null && request.visibleUntil() != null
                && !request.visibleUntil().isAfter(request.visibleFrom())) {
            throw new ApiException(400, "VALIDATION_ERROR", "게시 종료가 시작보다 뒤여야 합니다.");
        }
        post.setTitle(title);
        post.setContent(content);
        post.setPinned(Boolean.TRUE.equals(request.pinned()));
        post.setVisibleFrom(request.visibleFrom());
        post.setVisibleUntil(request.visibleUntil());
    }

    private BoardPost find(Long id) {
        return repository.findById(id)
                .filter(p -> BoardPost.NOTICE.equals(p.getType()) && !p.isDeleted())
                .orElseThrow(() -> new ApiException(404, "NOT_FOUND", "공지를 찾을 수 없습니다."));
    }

    private static void requireAdmin(User actor) {
        if (!isAdmin(actor)) {
            throw new ApiException(403, "FORBIDDEN", "공지는 관리자만 쓸 수 있습니다.");
        }
    }

    private static boolean isAdmin(User user) {
        return user != null && user.getRole() == UserRole.ADMIN;
    }
}
