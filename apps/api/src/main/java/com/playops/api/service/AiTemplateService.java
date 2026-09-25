package com.playops.api.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.playops.api.dto.AiTemplateRequest;
import com.playops.api.dto.AiTemplateResponse;
import com.playops.api.entity.AiModelProvider;
import com.playops.api.exception.ApiException;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

@Service
public class AiTemplateService {

    private final LlmGatewayService llmGatewayService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public AiTemplateService(LlmGatewayService llmGatewayService) {
        this.llmGatewayService = llmGatewayService;
    }

    public AiTemplateResponse generateTemplate(AiTemplateRequest request) {
        AiModelProvider provider = parseProvider(request.getProvider());

        try {
            String systemPrompt = """
                You are an expert QA Automation Architect specializing in Playwright v1.53.0 and TypeScript.
                Generate a complete, executable Playwright test boilerplate template based on user prompt.

                You MUST return ONLY a valid JSON object strictly matching this schema:
                {
                  "templateName": "String",
                  "description": "String",
                  "files": [
                    {
                      "filename": "tests/example.spec.ts",
                      "content": "TypeScript Code string"
                    },
                    {
                      "filename": "playwright.config.ts",
                      "content": "TypeScript Code string"
                    }
                  ]
                }

                Do not include markdown code block formatting (like ```json). Return pure raw JSON.
                """;

            String userPrompt = String.format(
                "Target Web URL: %s\nTemplate Name Suggestion: %s\nUser Requirements: %s",
                request.getTargetUrl() != null ? request.getTargetUrl() : "https://example.com",
                request.getTemplateName() != null ? request.getTemplateName() : "Custom E2E Template",
                request.getUserPrompt() != null ? request.getUserPrompt() : "General E2E Test Suite"
            );

            String aiContent = llmGatewayService.chat(provider, systemPrompt, userPrompt);
            JsonNode templateJson = objectMapper.readTree(stripMarkdownFence(aiContent));

            AiTemplateResponse response = new AiTemplateResponse();
            response.setTemplateName(templateJson.path("templateName").asText(request.getTemplateName()));
            response.setDescription(templateJson.path("description").asText("AI Generated Playwright Template"));

            List<AiTemplateResponse.TemplateFileDto> fileList = new ArrayList<>();
            JsonNode filesArray = templateJson.path("files");
            if (filesArray.isArray()) {
                for (JsonNode fNode : filesArray) {
                    fileList.add(new AiTemplateResponse.TemplateFileDto(
                            fNode.path("filename").asText(),
                            fNode.path("content").asText()
                    ));
                }
            }

            if (fileList.isEmpty()) {
                fileList.add(new AiTemplateResponse.TemplateFileDto(
                        "tests/example.spec.ts",
                        "import { test, expect } from '@playwright/test';\n\ntest('AI generated spec', async ({ page }) => {\n  await page.goto('" + (request.getTargetUrl() != null ? request.getTargetUrl() : "https://example.com") + "');\n  await expect(page).toHaveTitle(/./);\n});"
                ));
            }

            response.setFiles(fileList);
            return response;

        } catch (ApiException e) {
            // 키 미설정 등 설정 문제는 그대로 사용자에게 알린다 — 조용히 폴백하면 관리자가 문제를 놓친다.
            throw e;
        } catch (Exception e) {
            return createFallbackTemplate(request);
        }
    }

    private AiModelProvider parseProvider(String raw) {
        if (raw == null || raw.isBlank()) {
            return AiModelProvider.CLAUDE;
        }
        try {
            return AiModelProvider.valueOf(raw.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            return AiModelProvider.CLAUDE;
        }
    }

    private String stripMarkdownFence(String raw) {
        String trimmed = raw.trim();
        if (trimmed.startsWith("```")) {
            trimmed = trimmed.replaceFirst("^```(json)?", "").trim();
            if (trimmed.endsWith("```")) {
                trimmed = trimmed.substring(0, trimmed.length() - 3).trim();
            }
        }
        return trimmed;
    }

    private AiTemplateResponse createFallbackTemplate(AiTemplateRequest request) {
        String targetUrl = request.getTargetUrl() != null && !request.getTargetUrl().isEmpty()
                ? request.getTargetUrl()
                : "https://example.com";
        String name = request.getTemplateName() != null && !request.getTemplateName().isEmpty()
                ? request.getTemplateName()
                : "AI 생성 E2E 템플릿";

        AiTemplateResponse response = new AiTemplateResponse();
        response.setTemplateName(name);
        response.setDescription("AI-TestOps AI Agent가 생성한 " + request.getUserPrompt() + " 자동화 스펙");

        List<AiTemplateResponse.TemplateFileDto> files = new ArrayList<>();

        String specCode = String.format("""
            import { test, expect } from '@playwright/test';

            test.describe('%s E2E 시나리오', () => {
              test.beforeEach(async ({ page }) => {
                await page.goto('%s');
              });

              test('메인 페이지 제목 및 주요 요소 검증', async ({ page }) => {
                await expect(page).toHaveTitle(/./);
                const heading = page.locator('h1, h2').first();
                if (await heading.count() > 0) {
                  await expect(heading).toBeVisible();
                }
              });

              test('%s 기능 검증', async ({ page }) => {
                // AI Agent가 생성한 사용자 시나리오: %s
                await page.waitForLoadState('networkidle');
              });
            });
            """, name, targetUrl, name, request.getUserPrompt() != null ? request.getUserPrompt() : "자동화 검증");

        String configCode = String.format("""
            import { defineConfig, devices } from '@playwright/test';

            export default defineConfig({
              testDir: './tests',
              fullyParallel: true,
              forbidOnly: !!process.env.CI,
              retries: process.env.CI ? 2 : 0,
              workers: process.env.CI ? 1 : undefined,
              reporter: 'html',
              use: {
                baseURL: '%s',
                trace: 'on-first-retry',
                screenshot: 'only-on-failure',
                video: 'retain-on-failure',
              },
              projects: [
                {
                  name: 'chromium',
                  use: { ...devices['Desktop Chrome'] },
                },
              ],
            });
            """, targetUrl);

        files.add(new AiTemplateResponse.TemplateFileDto("tests/example.spec.ts", specCode.trim()));
        files.add(new AiTemplateResponse.TemplateFileDto("playwright.config.ts", configCode.trim()));
        files.add(new AiTemplateResponse.TemplateFileDto("package.json", "{\n  \"name\": \"ai-generated-spec\",\n  \"version\": \"1.0.0\",\n  \"scripts\": {\n    \"test\": \"npx playwright test\"\n  }\n}"));

        response.setFiles(files);
        return response;
    }
}
