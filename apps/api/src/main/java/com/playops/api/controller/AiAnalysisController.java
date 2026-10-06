package com.playops.api.controller;

import com.playops.api.dto.AiAnalysisRequest;
import com.playops.api.dto.AiAnalysisResponse;
import com.playops.api.dto.AiChatRequest;
import com.playops.api.dto.AiChatResponse;
import com.playops.api.entity.User;
import com.playops.api.service.AiAnalysisService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/ai")
public class AiAnalysisController {

    private final AiAnalysisService aiAnalysisService;

    public AiAnalysisController(AiAnalysisService aiAnalysisService) {
        this.aiAnalysisService = aiAnalysisService;
    }

    @PostMapping("/analyze")
    public ResponseEntity<AiAnalysisResponse> analyze(@RequestBody AiAnalysisRequest request) {
        AiAnalysisResponse response = aiAnalysisService.analyze(request);
        return ResponseEntity.ok(response);
    }

    /**
     * 채팅은 도구를 통해 AI 작업을 만들 수 있으므로, 누가 요청했는지 함께 넘긴다.
     * 만들어진 작업의 요청자가 비어 있으면 나중에 승인 이력을 사람에게 연결할 수 없다.
     */
    @PostMapping("/chat")
    public ResponseEntity<AiChatResponse> chat(@RequestBody AiChatRequest request,
                                               HttpServletRequest servletRequest) {
        User user = (User) servletRequest.getAttribute("currentUser");
        return ResponseEntity.ok(aiAnalysisService.chat(request, user != null ? user.getId() : null));
    }
}
