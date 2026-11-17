package com.playops.api.controller;

import com.playops.api.entity.User;
import com.playops.api.entity.UserRole;
import com.playops.api.service.AiTaskStreamService;
import com.playops.api.service.ProjectMemberService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
public class AiTaskStreamController {

    private final AiTaskStreamService stream;
    private final ProjectMemberService memberService;

    public AiTaskStreamController(AiTaskStreamService stream, ProjectMemberService memberService) {
        this.stream = stream;
        this.memberService = memberService;
    }

    /** AI 작업이 생기거나 바뀔 때마다 job 이벤트가 온다. 인증은 다른 /api 와 같다(Bearer). */
    @GetMapping(value = "/api/ai-tasks/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter stream(HttpServletRequest request) {
        User user = (User) request.getAttribute("currentUser");
        // 관리자는 모든 작업, 그 밖에는 멤버인 프로젝트의 작업만. 멤버가 바뀌어도 바로 반영되도록 보낼 때마다 본다.
        if (user == null || user.getRole() == UserRole.ADMIN) {
            return stream.subscribe(projectId -> true);
        }
        return stream.subscribe(projectId -> memberService.roleOf(projectId, user).isPresent());
    }
}
