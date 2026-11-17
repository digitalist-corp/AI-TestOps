package com.playops.api.service;

import com.playops.api.dto.NoticeDtos.NoticeRequest;
import com.playops.api.entity.BoardPost;
import com.playops.api.entity.User;
import com.playops.api.entity.UserRole;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.BoardPostRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/** 공지: 관리자만 쓰고, 모두 읽는다. 새 공지는 모든 사용자에게 알린다. 지우면 숨김(deleted). */
class NoticeServiceTest {

    private BoardPostRepository repository;
    private NotificationService notifications;
    private NoticeService service;
    private final User admin = user(1L, "admin", UserRole.ADMIN);
    private final User member = user(3L, "kim", UserRole.USER);

    private static User user(Long id, String name, UserRole role) {
        User u = new User();
        u.setId(id);
        u.setUsername(name);
        u.setRole(role);
        return u;
    }

    @BeforeEach
    void setUp() {
        repository = mock(BoardPostRepository.class);
        notifications = mock(NotificationService.class);
        when(repository.save(any(BoardPost.class))).thenAnswer(inv -> {
            BoardPost p = inv.getArgument(0);
            if (p.getId() == null) p.setId(10L);
            return p;
        });
        service = new NoticeService(repository, notifications);
    }

    private static BoardPost notice(Long id, boolean visible, Instant from, Instant until) {
        BoardPost p = new BoardPost();
        p.setId(id);
        p.setType(BoardPost.NOTICE);
        p.setTitle("공지 " + id);
        p.setContent("내용");
        p.setVisible(visible);
        p.setVisibleFrom(from);
        p.setVisibleUntil(until);
        p.setCreatedBy("admin");
        return p;
    }

    @Test
    void adminPostsANoticeAndEveryoneIsNotified() {
        var created = service.create(new NoticeRequest("점검 안내", "11/20 점검", true, null, null), admin);

        assertThat(created.title()).isEqualTo("점검 안내");
        assertThat(created.pinned()).isTrue();
        verify(repository).save(argThat(p -> BoardPost.NOTICE.equals(p.getType()) && "admin".equals(p.getCreatedBy())));
        verify(notifications).noticePosted(10L, "점검 안내");
    }

    @Test
    void teamMemberCannotWrite() {
        assertThatThrownBy(() -> service.create(new NoticeRequest("x", "y", false, null, null), member))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getStatus()).isEqualTo(403));
        verify(notifications, never()).noticePosted(any(), any());
    }

    @Test
    void titleAndContentAreRequired() {
        assertThatThrownBy(() -> service.create(new NoticeRequest(" ", "y", false, null, null), admin))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getStatus()).isEqualTo(400));
    }

    @Test
    void readersSeeOnlyNoticesInTheirVisibleWindow() {
        Instant now = Instant.now();
        when(repository.findByTypeAndDeletedFalseOrderByPinnedDescCreatedAtDesc(BoardPost.NOTICE)).thenReturn(List.of(
                notice(1L, true, null, null),
                notice(2L, false, null, null),
                notice(3L, true, now.plusSeconds(3600), null),
                notice(4L, true, null, now.minusSeconds(60))));

        assertThat(service.list(member)).extracting(n -> n.id()).containsExactly(1L);
        assertThat(service.list(admin)).extracting(n -> n.id()).containsExactly(1L, 2L, 3L, 4L);
    }

    @Test
    void deleteHidesTheNotice() {
        BoardPost existing = notice(5L, true, null, null);
        when(repository.findById(5L)).thenReturn(Optional.of(existing));

        service.delete(5L, admin);

        assertThat(existing.isDeleted()).isTrue();
        verify(repository).save(existing);
    }
}
