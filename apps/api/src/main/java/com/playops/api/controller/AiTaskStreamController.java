package com.playops.api.controller;

import com.playops.api.service.AiTaskStreamService;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
public class AiTaskStreamController {

    private final AiTaskStreamService stream;

    public AiTaskStreamController(AiTaskStreamService stream) {
        this.stream = stream;
    }

    /** AI 작업이 생기거나 바뀔 때마다 job 이벤트가 온다. 인증은 다른 /api 와 같다(Bearer). */
    @GetMapping(value = "/api/ai-tasks/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter stream() {
        return stream.subscribe();
    }
}
