package com.playops.api.recorder;

import com.playops.api.entity.User;
import com.playops.api.exception.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 클릭으로 테스트 만들기(녹화) API. 모양은 docs/design/recorder-contract.md 의 REST 절을 따른다.
 * 프로젝트 접근 권한을 먼저 보고, 내 세션이 아니면 404 다.
 */
@RestController
@RequestMapping("/api/projects/{projectId}/recorder/sessions")
public class RecorderController {

    private final RecorderService recorderService;

    public RecorderController(RecorderService recorderService) {
        this.recorderService = recorderService;
    }

    @PostMapping
    public RecorderDtos.RecorderState create(@PathVariable String projectId,
                                             @RequestBody(required = false) RecorderDtos.CreateSessionRequest body,
                                             HttpServletRequest request) {
        return recorderService.create(projectId, requireUser(request), body);
    }

    @GetMapping("/{sid}")
    public RecorderDtos.RecorderState get(@PathVariable String projectId, @PathVariable String sid,
                                          HttpServletRequest request) {
        return recorderService.get(projectId, sid, requireUser(request));
    }

    @GetMapping("/{sid}/screenshot")
    public ResponseEntity<byte[]> screenshot(@PathVariable String projectId, @PathVariable String sid,
                                             HttpServletRequest request) {
        byte[] jpeg = recorderService.screenshot(projectId, sid, requireUser(request));
        return ResponseEntity.ok()
                .contentType(MediaType.IMAGE_JPEG)
                .cacheControl(CacheControl.noStore())
                .body(jpeg);
    }

    @PostMapping("/{sid}/actions")
    public RecorderDtos.RecorderState action(@PathVariable String projectId, @PathVariable String sid,
                                             @RequestBody Map<String, Object> body, HttpServletRequest request) {
        return recorderService.action(projectId, sid, requireUser(request), body);
    }

    @PutMapping("/{sid}/steps")
    public RecorderDtos.RecorderState steps(@PathVariable String projectId, @PathVariable String sid,
                                            @RequestBody RecorderDtos.StepsRequest body, HttpServletRequest request) {
        return recorderService.putSteps(projectId, sid, requireUser(request), body == null ? null : body.steps());
    }

    @GetMapping("/{sid}/code")
    public RecorderDtos.CodeResponse code(@PathVariable String projectId, @PathVariable String sid,
                                          @RequestParam(required = false) String title, HttpServletRequest request) {
        return recorderService.code(projectId, sid, requireUser(request), title);
    }

    @PostMapping("/{sid}/save")
    public RecorderDtos.SaveResponse save(@PathVariable String projectId, @PathVariable String sid,
                                          @RequestBody RecorderDtos.SaveRequest body, HttpServletRequest request) {
        return recorderService.save(projectId, sid, requireUser(request), body);
    }

    @DeleteMapping("/{sid}")
    public ResponseEntity<Void> delete(@PathVariable String projectId, @PathVariable String sid,
                                       HttpServletRequest request) {
        recorderService.close(projectId, sid, requireUser(request));
        return ResponseEntity.noContent().build();
    }

    private User requireUser(HttpServletRequest request) {
        User user = (User) request.getAttribute("currentUser");
        if (user == null) {
            throw new ApiException(401, "UNAUTHENTICATED", "Authentication required");
        }
        return user;
    }
}
