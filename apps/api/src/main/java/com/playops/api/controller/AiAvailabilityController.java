package com.playops.api.controller;

import com.playops.api.entity.AiModelProvider;
import com.playops.api.service.AiProviderSettingsService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * AI 기능을 지금 쓸 수 있는지 화면이 미리 물어보는 곳.
 *
 * 키 자체는 돌려주지 않고 "등록되어 있는가"만 알려준다. 등록 화면에서 AI 생성을
 * 켜기 전에 확인해, 키가 없는데 요청을 보내고 기다리는 일을 막는다.
 */
@RestController
@RequestMapping("/api/ai/availability")
public class AiAvailabilityController {

    private final AiProviderSettingsService aiProviderSettingsService;

    public AiAvailabilityController(AiProviderSettingsService aiProviderSettingsService) {
        this.aiProviderSettingsService = aiProviderSettingsService;
    }

    public record AiAvailabilityResponse(boolean claude, boolean gpt, boolean anyConfigured) {}

    @GetMapping
    public AiAvailabilityResponse get() {
        boolean claude = aiProviderSettingsService.hasKey(AiModelProvider.CLAUDE);
        boolean gpt = aiProviderSettingsService.hasKey(AiModelProvider.GPT);
        return new AiAvailabilityResponse(claude, gpt, claude || gpt);
    }
}
