package com.playops.api.util;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.playops.api.exception.ApiException;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

public final class ProjectEnvVariables {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {};

    private ProjectEnvVariables() {}

    public static Map<String, String> parse(String json) {
        if (json == null || json.isBlank()) {
            return Collections.emptyMap();
        }
        try {
            Map<String, Object> raw = MAPPER.readValue(json, MAP_TYPE);
            Map<String, String> result = new LinkedHashMap<>();
            for (Map.Entry<String, Object> entry : raw.entrySet()) {
                if (entry.getKey() == null || entry.getKey().isBlank()) {
                    continue;
                }
                Object value = entry.getValue();
                result.put(entry.getKey().trim(), value != null ? String.valueOf(value) : "");
            }
            return result;
        } catch (Exception e) {
            throw new ApiException(400, "envVariables must be a JSON object of string keys and values");
        }
    }

    public static void validate(String json) {
        parse(json);
    }

    /** 기존 환경변수 JSON 에 새 키 · 값을 병합해 JSON 문자열로 돌려준다. 기존 키는 그대로 보존한다. */
    public static String merge(String existingJson, Map<String, String> additions) {
        Map<String, String> merged = new LinkedHashMap<>();
        if (existingJson != null && !existingJson.isBlank()) {
            try {
                merged.putAll(parse(existingJson));
            } catch (ApiException ignored) {
                // 기존 값이 깨져 있으면 빈 맵에서 시작한다.
            }
        }
        if (additions != null) {
            for (Map.Entry<String, String> entry : additions.entrySet()) {
                if (entry.getKey() == null || entry.getKey().isBlank() || entry.getValue() == null) {
                    continue;
                }
                merged.put(entry.getKey().trim(), entry.getValue());
            }
        }
        try {
            return MAPPER.writeValueAsString(merged);
        } catch (Exception e) {
            throw new ApiException(500, "환경변수 직렬화 실패: " + e.getMessage());
        }
    }
}
