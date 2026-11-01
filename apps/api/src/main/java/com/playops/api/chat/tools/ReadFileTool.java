package com.playops.api.chat.tools;

import com.playops.api.chat.ChatTool;
import com.playops.api.chat.ChatToolContext;
import com.playops.api.chat.ChatToolOutput;
import com.playops.api.chat.ToolDisplay;
import com.playops.api.chat.ToolTier;
import com.playops.api.llm.LlmToolCall;
import com.playops.api.llm.LlmToolSpec;
import com.playops.api.service.FileStorageService;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

/** 프로젝트 안의 파일 내용 읽기. */
@Component
public class ReadFileTool implements ChatTool {

    private final FileStorageService fileStorageService;

    public ReadFileTool(FileStorageService fileStorageService) {
        this.fileStorageService = fileStorageService;
    }

    @Override
    public LlmToolSpec spec() {
        return new LlmToolSpec(
                "read_file",
                "프로젝트 안의 파일 내용을 읽는다. 테스트 코드를 고치기 전에 반드시 먼저 읽어 현재 내용을 확인한다.",
                LlmToolSpec.schema(
                        CoreToolSupport.withProjectId(Map.of(
                                "path", LlmToolSpec.string("프로젝트 기준 상대 경로. 예: tests/login.spec.ts"))),
                        "path"));
    }

    @Override
    public ToolTier tier() {
        return ToolTier.READ;
    }

    @Override
    public ChatToolOutput execute(LlmToolCall call, ChatToolContext context) {
        String path = call.arg("path");
        if (path == null) {
            return ChatToolOutput.failed("path 인자가 필요합니다.");
        }
        String content = CoreToolSupport.truncate(fileStorageService.readFile(context.projectIdFor(call), path));
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("path", path);
        String language = CoreToolSupport.languageOf(path);
        if (language != null) {
            data.put("language", language);
        }
        data.put("content", content);
        return ChatToolOutput.ok(content, path, ToolDisplay.of("code", data));
    }
}
