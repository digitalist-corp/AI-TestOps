package com.playops.api.dto;

import com.playops.api.entity.BoardPost;

import java.time.Instant;

/** 공지사항(#116) 요청·응답. 게시 기간(visibleFrom · visibleUntil)은 비우면 제한 없음. */
public final class NoticeDtos {

    private NoticeDtos() {}

    public record NoticeRequest(String title, String content, Boolean pinned, Instant visibleFrom, Instant visibleUntil) {}

    public record Notice(Long id, String title, String content, boolean pinned, Instant visibleFrom,
                         Instant visibleUntil, String createdBy, Instant createdAt, Instant updatedAt) {
        public static Notice from(BoardPost p) {
            return new Notice(p.getId(), p.getTitle(), p.getContent(), p.isPinned(), p.getVisibleFrom(),
                    p.getVisibleUntil(), p.getCreatedBy(), p.getCreatedAt(), p.getUpdatedAt());
        }
    }
}
