package com.playops.api.chat;

import com.playops.api.llm.LlmToolSpec;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * 스프링에 등록된 ChatTool 을 이름으로 모아 둔다. 도구를 새로 만들면 @Component 만 붙이면 되고 여기는 고치지 않는다.
 * 이름이 겹치면 모델이 어느 쪽을 부를지 알 수 없으므로 서버가 뜨지 않게 막는다.
 */
@Component
public class ChatToolRegistry {

    private final Map<String, ChatTool> tools = new LinkedHashMap<>();

    public ChatToolRegistry(List<ChatTool> chatTools) {
        List<ChatTool> sorted = new ArrayList<>(chatTools);
        sorted.sort((a, b) -> a.spec().name().compareTo(b.spec().name()));
        for (ChatTool tool : sorted) {
            String name = tool.spec().name();
            if (tools.putIfAbsent(name, tool) != null) {
                throw new IllegalStateException("채팅 도구 이름이 겹칩니다: " + name);
            }
        }
    }

    public Optional<ChatTool> find(String name) {
        return Optional.ofNullable(name == null ? null : tools.get(name));
    }

    public Collection<ChatTool> all() {
        return tools.values();
    }

    public Set<String> names() {
        return tools.keySet();
    }

    /** 모델에게 줄 전체 도구 정의. */
    public List<LlmToolSpec> specs() {
        return tools.values().stream().map(ChatTool::spec).toList();
    }

    /** 고른 권한 단계의 도구 정의만. */
    public List<LlmToolSpec> specs(Set<ToolTier> tiers) {
        return tools.values().stream().filter(tool -> tiers.contains(tool.tier())).map(ChatTool::spec).toList();
    }
}
