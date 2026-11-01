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

import java.util.List;
import java.util.Map;

/** 프로젝트에 있는 파일 목록. */
@Component
public class ListFilesTool implements ChatTool {

    /** 화면 목록에 보여 줄 최대 개수. 모델에게는 글자 상한까지 다 준다. */
    private static final int MAX_DISPLAY_ITEMS = 200;

    private final FileStorageService fileStorageService;

    public ListFilesTool(FileStorageService fileStorageService) {
        this.fileStorageService = fileStorageService;
    }

    @Override
    public LlmToolSpec spec() {
        return new LlmToolSpec(
                "list_files",
                "프로젝트에 있는 파일 목록을 본다. 어떤 spec 파일이 있는지, 폴더 구조가 어떤지 확인할 때 쓴다.",
                LlmToolSpec.schema(CoreToolSupport.withProjectId(Map.of())));
    }

    @Override
    public ToolTier tier() {
        return ToolTier.READ;
    }

    @Override
    public ChatToolOutput execute(LlmToolCall call, ChatToolContext context) {
        List<String> files = fileStorageService.listFiles(context.projectIdFor(call));
        if (files.isEmpty()) {
            return ChatToolOutput.ok("프로젝트에 파일이 없습니다. 아직 초기화되지 않았을 수 있습니다.", "파일 없음");
        }
        List<Map<String, Object>> items = files.stream()
                .limit(MAX_DISPLAY_ITEMS)
                .map(path -> Map.<String, Object>of("label", path))
                .toList();
        return ChatToolOutput.ok(
                CoreToolSupport.truncate(String.join("\n", files)),
                files.size() + "개 파일",
                ToolDisplay.of("list", Map.of("items", items)));
    }
}
