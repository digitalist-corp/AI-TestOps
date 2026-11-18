package com.playops.api.repository;

import com.playops.api.entity.User;
import com.playops.api.entity.UserRole;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface UserRepository extends JpaRepository<User, Long> {
    Optional<User> findByUsername(String username);
    boolean existsByUsername(String username);
    boolean existsByRole(com.playops.api.entity.UserRole role);
    long countByRole(UserRole role);
    long countByRoleAndEnabledTrue(UserRole role);

    /** 멤버 추가 화면의 사용자 검색: 아이디 · 이름 부분 일치 */
    @Query("select u from User u where u.enabled = true and (lower(u.username) like lower(concat('%', :q, '%'))"
            + " or lower(coalesce(u.displayName, '')) like lower(concat('%', :q, '%'))) order by u.username")
    List<User> search(@Param("q") String q, Pageable pageable);
}
