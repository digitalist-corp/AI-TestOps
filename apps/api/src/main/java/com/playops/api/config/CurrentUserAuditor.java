package com.playops.api.config;

import com.playops.api.entity.User;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.domain.AuditorAware;
import org.springframework.data.jpa.repository.config.EnableJpaAuditing;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;

import java.util.Optional;

/**
 * 수정자 · 수정일(#118): @CreatedBy · @LastModifiedBy 칸을 지금 요청한 사용자 id 로 채운다.
 * AuthInterceptor 가 넣어 둔 request 속성 currentUser 만 본다. 스케줄러 · 러너 콜백처럼 요청이나 사용자가 없으면
 * 비어 있음을 돌려주고, 그때 Spring Data 는 칸을 건드리지 않는다 (저장은 실패하지 않는다).
 */
@Configuration
@EnableJpaAuditing(auditorAwareRef = "currentUserAuditor")
public class CurrentUserAuditor implements AuditorAware<Long> {

    @Override
    public Optional<Long> getCurrentAuditor() {
        RequestAttributes attrs = RequestContextHolder.getRequestAttributes();
        Object user = attrs == null ? null : attrs.getAttribute("currentUser", RequestAttributes.SCOPE_REQUEST);
        return user instanceof User u ? Optional.ofNullable(u.getId()) : Optional.empty();
    }
}
