package com.playops.api.chat.tools;

import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * AI 가 쓴 SQL 을 DB 에 보내기 전에 거르는 1차 검사.
 *
 * 진짜 방어선은 DB 쪽(읽기 전용 트랜잭션 + ai_readonly 역할 + ai_ro 뷰)이다. 이 검사는 그 앞에서
 * "읽기용 쿼리 한 문장" 이 아닌 것을 일찍 돌려보내 모델에게 이유를 알려 주는 역할이다.
 * 특히 JDBC 드라이버는 세미콜론으로 이어 붙인 여러 문장을 PreparedStatement 에서도 그대로 보내므로,
 * 여러 문장은 반드시 여기서 막는다.
 *
 * 문자열 · 따옴표 식별자 · 달러 인용 · 주석 안의 글자는 SQL 코드가 아니므로 세미콜론이나 단어로 세지 않는다.
 */
final class SqlGuard {

    /** 읽기 쿼리 안에 끼어 데이터를 바꾸거나 범위 설정을 건드릴 수 있는 단어. (WITH x AS (DELETE ...) 같은 꼴) */
    private static final Set<String> FORBIDDEN_WORDS = Set.of("INSERT", "UPDATE", "DELETE", "MERGE", "SET_CONFIG");

    /** $$ 또는 $태그$ — $1 같은 번호 인자는 태그가 아니다. */
    private static final Pattern DOLLAR_TAG =
            Pattern.compile("\\$(?:[A-Za-z_\\u0080-\\uFFFF][A-Za-z0-9_\\u0080-\\uFFFF]*)?\\$");

    private SqlGuard() {
    }

    /** 검사에 걸렸을 때. 메시지는 모델에게 그대로 보여 준다. */
    static final class Rejected extends RuntimeException {
        Rejected(String message) {
            super(message);
        }
    }

    /**
     * 읽기용 쿼리 한 문장인지 확인하고, 실행할 SQL(맨 끝 세미콜론과 그 뒤 공백 · 주석을 뗀 것)을 돌려준다.
     *
     * @throws Rejected 읽기용 한 문장이 아닐 때
     */
    static String validate(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new Rejected("sql 이 비어 있습니다.");
        }
        int n = raw.length();
        int i = 0;
        int endOfStatement = -1;
        String firstWord = null;
        int lastWordEnd = -1;
        String lastWord = null;

        while (i < n) {
            char c = raw.charAt(i);

            if (c == '-' && i + 1 < n && raw.charAt(i + 1) == '-') {
                i = skipLineComment(raw, i);
                continue;
            }
            if (c == '/' && i + 1 < n && raw.charAt(i + 1) == '*') {
                i = skipBlockComment(raw, i);
                continue;
            }
            if (Character.isWhitespace(c)) {
                i++;
                continue;
            }
            if (c == ';') {
                if (endOfStatement < 0) {
                    endOfStatement = i;
                }
                i++;
                continue;
            }

            // 여기부터는 모두 "SQL 코드". 세미콜론 뒤에 코드가 나오면 두 번째 문장이다.
            if (endOfStatement >= 0) {
                throw new Rejected("한 번에 한 문장만 실행할 수 있습니다. 세미콜론(;) 뒤에 다른 문장이 있습니다.");
            }

            // 첫 코드가 단어가 아니면(괄호 · 따옴표 · 숫자 …) SELECT/WITH 로 시작한 것이 아니다.
            if (firstWord == null && !isWordStart(c)) {
                throw new Rejected("SELECT 또는 WITH 로 시작하는 조회 쿼리만 쓸 수 있습니다.");
            }

            if (c == '\'') {
                // E'...' 문자열만 백슬래시가 이스케이프다. 다른 문자열에서 백슬래시를 이스케이프로 보면
                // DB 와 해석이 어긋나 세미콜론을 숨길 수 있다.
                boolean escapeString = lastWordEnd == i && "E".equalsIgnoreCase(lastWord);
                i = skipQuoted(raw, i, '\'', escapeString, "작은따옴표(')");
                continue;
            }
            if (c == '"') {
                i = skipQuoted(raw, i, '"', false, "큰따옴표(\")");
                continue;
            }
            if (c == '$') {
                Matcher tag = DOLLAR_TAG.matcher(raw).region(i, n);
                if (tag.lookingAt()) {
                    String delimiter = tag.group();
                    int close = raw.indexOf(delimiter, i + delimiter.length());
                    if (close < 0) {
                        throw new Rejected("달러 인용(" + delimiter + ")이 닫히지 않았습니다.");
                    }
                    i = close + delimiter.length();
                    continue;
                }
            }
            if (c == '?') {
                throw new Rejected("물음표(?)는 쓸 수 없습니다. 값은 쿼리에 직접 적고, JSON 연산자 대신 함수를 쓰세요.");
            }
            if (isWordStart(c)) {
                int end = i + 1;
                while (end < n && isWordPart(raw.charAt(end))) {
                    end++;
                }
                String word = raw.substring(i, end);
                String upper = word.toUpperCase(Locale.ROOT);
                if (firstWord == null) {
                    firstWord = upper;
                    // 첫 단어부터 틀렸다면 나머지를 볼 필요 없이 "무엇으로 시작해야 하는지" 를 알려 준다.
                    if (!firstWord.equals("SELECT") && !firstWord.equals("WITH")) {
                        throw new Rejected("SELECT 또는 WITH 로 시작하는 조회 쿼리만 쓸 수 있습니다. (시작 단어: " + firstWord + ")");
                    }
                }
                if (FORBIDDEN_WORDS.contains(upper) || isSessionLockFunction(upper)) {
                    throw new Rejected("읽기 전용입니다. " + upper + " 는 쓸 수 없습니다.");
                }
                lastWord = word;
                lastWordEnd = end;
                i = end;
                continue;
            }
            i++;
        }

        if (firstWord == null) {
            throw new Rejected("sql 이 비어 있습니다. (주석만 있습니다)");
        }
        return (endOfStatement >= 0 ? raw.substring(0, endOfStatement) : raw).trim();
    }

    /**
     * pg_advisory_lock 같은 세션 단위 잠금은 PUBLIC 이 쓸 수 있고 롤백해도 풀리지 않는다.
     * 연결 풀로 돌아간 연결에 잠금이 남아 다른 요청을 막을 수 있어 막는다. (트랜잭션 단위 pg_advisory_xact_* 도 같이 막힌다)
     */
    private static boolean isSessionLockFunction(String upperWord) {
        return upperWord.startsWith("PG_ADVISORY") || upperWord.startsWith("PG_TRY_ADVISORY");
    }

    private static boolean isWordStart(char c) {
        return Character.isLetter(c) || c == '_';
    }

    private static boolean isWordPart(char c) {
        return Character.isLetterOrDigit(c) || c == '_' || c == '$';
    }

    private static int skipLineComment(String sql, int start) {
        int end = sql.indexOf('\n', start);
        return end < 0 ? sql.length() : end + 1;
    }

    /** PostgreSQL 의 블록 주석은 중첩된다. */
    private static int skipBlockComment(String sql, int start) {
        int depth = 0;
        int i = start;
        int n = sql.length();
        while (i < n) {
            if (sql.startsWith("/*", i)) {
                depth++;
                i += 2;
            } else if (sql.startsWith("*/", i)) {
                depth--;
                i += 2;
                if (depth == 0) {
                    return i;
                }
            } else {
                i++;
            }
        }
        throw new Rejected("주석(/* */)이 닫히지 않았습니다.");
    }

    /** 여는 따옴표 자리(start)에서 시작해 닫는 따옴표 다음 자리를 돌려준다. 따옴표를 두 번 쓰면 따옴표 글자다. */
    private static int skipQuoted(String sql, int start, char quote, boolean backslashEscapes, String name) {
        int i = start + 1;
        int n = sql.length();
        while (i < n) {
            char c = sql.charAt(i);
            if (backslashEscapes && c == '\\') {
                i += 2;
                continue;
            }
            if (c == quote) {
                if (i + 1 < n && sql.charAt(i + 1) == quote) {
                    i += 2;
                    continue;
                }
                return i + 1;
            }
            i++;
        }
        throw new Rejected(name + " 가 닫히지 않았습니다.");
    }
}
