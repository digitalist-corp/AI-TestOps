package com.playops.api.repository;

import com.playops.api.entity.BoardPost;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface BoardPostRepository extends JpaRepository<BoardPost, Long> {
    /** 고정 먼저, 최신순 */
    List<BoardPost> findByTypeAndDeletedFalseOrderByPinnedDescCreatedAtDesc(String type);
}
