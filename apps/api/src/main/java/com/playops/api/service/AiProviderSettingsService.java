package com.playops.api.service;

import com.playops.api.dto.AiProviderSettingsRequest;
import com.playops.api.dto.AiProviderSettingsResponse;
import com.playops.api.entity.AiModelProvider;
import com.playops.api.entity.AiProviderSettings;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.AiProviderSettingsRepository;
import org.springframework.stereotype.Service;

/**
 * 관리자가 등록하는 플랫폼 공용 AI 공급자 키(Claude/GPT) 관리.
 * 평문 키는 절대 응답으로 재노출하지 않는다 — 마스킹된 상태만 반환한다.
 */
@Service
public class AiProviderSettingsService {

    private static final Long SETTINGS_ID = 1L;

    private final AiProviderSettingsRepository repository;
    private final SecretCipherService cipherService;

    public AiProviderSettingsService(AiProviderSettingsRepository repository, SecretCipherService cipherService) {
        this.repository = repository;
        this.cipherService = cipherService;
    }

    private AiProviderSettings loadOrCreate() {
        return repository.findById(SETTINGS_ID).orElseGet(AiProviderSettings::new);
    }

    public AiProviderSettingsResponse getMaskedSettings() {
        AiProviderSettings settings = loadOrCreate();
        String claudePlain = decryptOrNull(settings.getClaudeApiKeyEncrypted());
        String openaiPlain = decryptOrNull(settings.getOpenaiApiKeyEncrypted());
        AiProviderSettingsResponse response = new AiProviderSettingsResponse(
                claudePlain != null,
                claudePlain != null ? SecretCipherService.mask(claudePlain) : "",
                openaiPlain != null,
                openaiPlain != null ? SecretCipherService.mask(openaiPlain) : "",
                settings.getClaudeWorkspaceId(),
                settings.getUpdatedAt()
        );
        response.setDefaultProvider(getDefaultProvider().name());
        response.setClaudeInputPrice(settings.getClaudeInputPrice());
        response.setClaudeOutputPrice(settings.getClaudeOutputPrice());
        response.setOpenaiInputPrice(settings.getOpenaiInputPrice());
        response.setOpenaiOutputPrice(settings.getOpenaiOutputPrice());
        return response;
    }

    /** 화면에서 공급자를 고르지 않았을 때 쓸 공급자. 설정이 없으면 Claude. */
    public AiModelProvider getDefaultProvider() {
        AiModelProvider configured = loadOrCreate().getDefaultProvider();
        return configured != null ? configured : AiModelProvider.CLAUDE;
    }

    /** 단가(100만 토큰당 USD). 입력하지 않았으면 0으로 본다. */
    public double inputPrice(AiModelProvider provider) {
        AiProviderSettings settings = loadOrCreate();
        Double value = provider == AiModelProvider.CLAUDE
                ? settings.getClaudeInputPrice() : settings.getOpenaiInputPrice();
        return value != null ? value : 0d;
    }

    public double outputPrice(AiModelProvider provider) {
        AiProviderSettings settings = loadOrCreate();
        Double value = provider == AiModelProvider.CLAUDE
                ? settings.getClaudeOutputPrice() : settings.getOpenaiOutputPrice();
        return value != null ? value : 0d;
    }

    public AiProviderSettingsResponse updateSettings(AiProviderSettingsRequest request) {
        AiProviderSettings settings = loadOrCreate();
        if (request.getClaudeApiKey() != null && !request.getClaudeApiKey().isBlank()) {
            settings.setClaudeApiKeyEncrypted(cipherService.encrypt(request.getClaudeApiKey().trim()));
        }
        if (request.getOpenaiApiKey() != null && !request.getOpenaiApiKey().isBlank()) {
            settings.setOpenaiApiKeyEncrypted(cipherService.encrypt(request.getOpenaiApiKey().trim()));
        }
        if (request.getClaudeWorkspaceId() != null) {
            String trimmed = request.getClaudeWorkspaceId().trim();
            settings.setClaudeWorkspaceId(trimmed.isEmpty() ? null : trimmed);
        }
        if (request.getDefaultProvider() != null && !request.getDefaultProvider().isBlank()) {
            try {
                settings.setDefaultProvider(AiModelProvider.valueOf(request.getDefaultProvider().trim().toUpperCase()));
            } catch (IllegalArgumentException e) {
                throw new ApiException(400, "알 수 없는 AI 공급자입니다: " + request.getDefaultProvider());
            }
        }
        if (request.getClaudeInputPrice() != null) settings.setClaudeInputPrice(request.getClaudeInputPrice());
        if (request.getClaudeOutputPrice() != null) settings.setClaudeOutputPrice(request.getClaudeOutputPrice());
        if (request.getOpenaiInputPrice() != null) settings.setOpenaiInputPrice(request.getOpenaiInputPrice());
        if (request.getOpenaiOutputPrice() != null) settings.setOpenaiOutputPrice(request.getOpenaiOutputPrice());
        repository.save(settings);
        return getMaskedSettings();
    }

    /** LlmGatewayService 등 내부 호출 전용 — 평문 키를 반환한다. 설정되지 않았으면 예외를 던진다. */
    public String getDecryptedKey(AiModelProvider provider) {
        AiProviderSettings settings = loadOrCreate();
        String encrypted = switch (provider) {
            case CLAUDE -> settings.getClaudeApiKeyEncrypted();
            case GPT -> settings.getOpenaiApiKeyEncrypted();
        };
        String plain = decryptOrNull(encrypted);
        if (plain == null) {
            throw new ApiException(400, provider + " API 키가 관리자 설정에 등록되어 있지 않습니다.");
        }
        return plain;
    }

    /** 공급자 자동 선택용 — 해당 공급자의 키가 등록되어 있는지만 확인한다. 예외를 던지지 않는다. */
    public boolean hasKey(AiModelProvider provider) {
        try {
            AiProviderSettings settings = loadOrCreate();
            String encrypted = switch (provider) {
                case CLAUDE -> settings.getClaudeApiKeyEncrypted();
                case GPT -> settings.getOpenaiApiKeyEncrypted();
            };
            return decryptOrNull(encrypted) != null;
        } catch (Exception e) {
            return false;
        }
    }

    /** LlmGatewayService 전용 — 워크스페이스 연결형 Claude 키에 필요한 workspace id. 없으면 null. */
    public String getClaudeWorkspaceIdOrNull() {
        return loadOrCreate().getClaudeWorkspaceId();
    }

    private String decryptOrNull(String encrypted) {
        if (encrypted == null || encrypted.isBlank()) {
            return null;
        }
        return cipherService.decrypt(encrypted);
    }
}
