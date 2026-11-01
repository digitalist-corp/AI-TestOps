package com.playops.api.chat.tools;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.sql.Timestamp;
import java.util.List;

/**
 * sql_query 가 돌려받은 결과 표.
 *
 * @param rows      최대 200행. 칸 값은 화면에 그대로 실을 수 있게 문자열 · 숫자 · 불리언 · null 만 쓴다
 * @param truncated 200행보다 더 있었는지
 */
record SqlResult(List<String> columns, List<List<Object>> rows, boolean truncated) {

    /** 칸 하나가 너무 길면(예: 로그 본문) 표가 터지므로 이 길이에서 자른다. */
    static final int MAX_CELL_CHARS = 1000;

    /** DB 가 돌려준 값을 문자열 · 숫자 · 불리언 · null 로 바꾼다. */
    static Object cell(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Boolean || value instanceof Integer || value instanceof Long
                || value instanceof Short || value instanceof Byte || value instanceof BigInteger
                || value instanceof BigDecimal) {
            return value;
        }
        if (value instanceof Double d) {
            return Double.isFinite(d) ? d : String.valueOf(d);
        }
        if (value instanceof Float f) {
            return Float.isFinite(f) ? f : String.valueOf(f);
        }
        if (value instanceof Timestamp t) {
            return t.toInstant().toString();
        }
        if (value instanceof byte[] bytes) {
            return "(바이너리 " + bytes.length + "바이트)";
        }
        String text = String.valueOf(value);
        return text.length() <= MAX_CELL_CHARS ? text : text.substring(0, MAX_CELL_CHARS) + "…";
    }
}
