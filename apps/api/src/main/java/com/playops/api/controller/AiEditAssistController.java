package com.playops.api.controller;

import com.playops.api.dto.AiBootstrapCredentialsRequest;
import com.playops.api.dto.AiBootstrapRequest;
import com.playops.api.dto.AiBootstrapResponse;
import com.playops.api.dto.AiEditAssistRequest;
import com.playops.api.dto.AiEditAssistResponse;
import com.playops.api.dto.AiEditAssistVerifyRequest;
import com.playops.api.dto.AiEditAssistVerifyResponse;
import com.playops.api.service.AiBootstrapService;
import com.playops.api.service.AiEditAssistService;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class AiEditAssistController {

    private final AiEditAssistService aiEditAssistService;
    private final AiBootstrapService aiBootstrapService;

    public AiEditAssistController(AiEditAssistService aiEditAssistService, AiBootstrapService aiBootstrapService) {
        this.aiEditAssistService = aiEditAssistService;
        this.aiBootstrapService = aiBootstrapService;
    }

    @PostMapping("/api/projects/{projectId}/ai/edit-assist")
    public AiEditAssistResponse editAssist(@PathVariable String projectId, @RequestBody AiEditAssistRequest body) {
        String content = aiEditAssistService.editFile(
                projectId, body.filePath(), body.currentContent(), body.instruction());
        return new AiEditAssistResponse(content);
    }

    @PostMapping("/api/projects/{projectId}/ai/edit-assist/verify")
    public AiEditAssistVerifyResponse verify(@PathVariable String projectId, @RequestBody AiEditAssistVerifyRequest body) {
        return aiEditAssistService.verifyEdit(projectId, body.filePath(), body.proposedContent(), body.specPath());
    }

    /**
     * 프로젝트 등록 직후 첫 테스트 생성을 시작하고 바로 돌아온다.
     * 사이트 탐색 → 코드 생성 → 실행 → 실패 시 자율 교정은 서버에서 이어지고, 진행 상황은 GET 으로 확인한다.
     */
    @PostMapping("/api/projects/{projectId}/ai/bootstrap")
    public AiBootstrapResponse bootstrap(@PathVariable String projectId, @RequestBody AiBootstrapRequest body) {
        return aiBootstrapService.start(projectId, body.instruction(), body.provider());
    }

    @GetMapping({"/api/projects/{projectId}/ai/bootstrap/{bootstrapId}", "/api/ai/bootstrap/{bootstrapId}"})
    public AiBootstrapResponse bootstrapStatus(
            @PathVariable(required = false) String projectId,
            @PathVariable String bootstrapId
    ) {
        return aiBootstrapService.status(projectId, bootstrapId);
    }

    @PostMapping({"/api/projects/{projectId}/ai/bootstrap/{bootstrapId}/credentials", "/api/ai/bootstrap/{bootstrapId}/credentials"})
    public AiBootstrapResponse bootstrapCredentials(
            @PathVariable(required = false) String projectId,
            @PathVariable String bootstrapId,
            @RequestBody AiBootstrapCredentialsRequest body
    ) {
        return aiBootstrapService.submitCredentials(projectId, bootstrapId, body);
    }

    @GetMapping({"/api/projects/{projectId}/ai/bootstrap/{bootstrapId}/screens/{file}", "/api/ai/bootstrap/{bootstrapId}/screens/{file}"})
    public ResponseEntity<Resource> bootstrapScreen(
            @PathVariable(required = false) String projectId,
            @PathVariable String bootstrapId,
            @PathVariable String file
    ) {
        return ResponseEntity.ok()
                .contentType(MediaType.IMAGE_JPEG)
                .body(new FileSystemResource(aiBootstrapService.screenshotFile(projectId, bootstrapId, file)));
    }
}
