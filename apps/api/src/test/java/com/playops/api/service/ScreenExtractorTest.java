package com.playops.api.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.playops.api.entity.AiModelProvider;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ScreenExtractorTest {

    private static final String LOGIN = """
            export function LoginPage() {
              return (
                <form>
                  <label htmlFor="email">이메일</label>
                  <input id="email" data-testid="login-email" placeholder="you@example.com" />
                  <input type="password" aria-label="비밀번호" />
                  <button type="submit">로그인</button>
                  <Link to="/signup">회원가입</Link>
                </form>
              );
            }
            """;

    private final LlmGatewayService gateway = mock(LlmGatewayService.class);
    private final ScreenExtractor extractor = new ScreenExtractor(gateway);
    private final Map<String, String> bundle = new LinkedHashMap<>(Map.of("src/pages/LoginPage.tsx", LOGIN));
    private final List<String> routes = List.of("/login", "/signup");

    private ScreenExtractor.Extraction validate(String json) throws IOException {
        return extractor.validate(new ObjectMapper().readTree(json), routes, bundle);
    }

    @Test
    void keepsOnlyWhatIsLiterallyInTheSource() throws IOException {
        ScreenExtractor.Extraction result = validate("""
                {"title":"로그인","authRequired":false,"elements":[
                  {"kind":"input","role":"textbox","name":"이메일","testId":"login-email","label":"이메일",
                   "placeholder":"you@example.com","file":"src/pages/LoginPage.tsx"},
                  {"kind":"button","role":"button","name":"로그인","text":"로그인","file":"src/pages/LoginPage.tsx"},
                  {"kind":"button","role":"button","name":"구글로 로그인","testId":"google-login"},
                  {"kind":"input","role":"hacker","name":"비밀번호","testId":"submit"}
                ],"links":[{"to":"/signup","label":"회원가입"},{"to":"/admin","label":"관리자"}]}
                """);

        assertThat(result.elements()).hasSize(3);
        Map<String, Object> email = result.elements().get(0);
        assertThat(email).containsEntry("testId", "login-email").containsEntry("file", "src/pages/LoginPage.tsx")
                .containsEntry("line", 5);
        // 지어낸 요소("구글로 로그인")는 통째로 빠진다.
        assertThat(result.elements()).noneMatch(e -> "구글로 로그인".equals(e.get("name")));
        // "submit" 은 type="submit" 에는 있지만 data-testid 로 쓰인 적이 없으므로 testId 로 인정하지 않는다.
        Map<String, Object> password = result.elements().get(2);
        assertThat(password).containsEntry("name", "비밀번호").containsEntry("testId", null).containsEntry("role", null);
        // 알려진 화면으로 가는 링크만 남는다.
        assertThat(result.links()).extracting(l -> l.get("to")).containsExactly("/signup");
    }

    @Test
    void reportsLineWhereValueIsWrittenAsAttributeOrTextNotWhereItFirstAppears() {
        String source = "const onChangeEmail = () => {};\nconst x = 1;\n<input placeholder=\"Email\" />\n<button>Email 보내기</button>";
        assertThat(ScreenExtractor.lineOf(source, "Email")).isEqualTo(3);
        assertThat(ScreenExtractor.lineOf("a\nb\n<button>저장</button>", "저장")).isEqualTo(3);
    }

    @Test
    void retriesOnceWhenAnswerIsNotJsonThenGivesUp() {
        when(gateway.chat(any(), anyString(), anyString(), anyString(), anyString())).thenReturn("죄송합니다, 못 하겠습니다.");

        assertThatThrownBy(() -> extractor.extract(AiModelProvider.CLAUDE, "p", "/login", routes, bundle))
                .isInstanceOf(IllegalStateException.class);
        verify(gateway, times(2)).chat(eq(AiModelProvider.CLAUDE), anyString(), anyString(), eq("구조 분석"), eq("p"));
    }

    @Test
    void acceptsAnswerWrappedInCodeFence() {
        when(gateway.chat(any(), anyString(), anyString(), anyString(), anyString())).thenReturn(
                "```json\n{\"title\":null,\"elements\":[{\"kind\":\"button\",\"role\":\"button\",\"name\":\"로그인\"}],\"links\":[]}\n```");

        assertThat(extractor.extract(AiModelProvider.CLAUDE, "p", "/login", routes, bundle).elements()).hasSize(1);
    }

    @Test
    void bundlesScreenFileWithLocalImportsAndHashChangesOnlyWhenContentChanges(@TempDir Path repo) throws IOException {
        Files.createDirectories(repo.resolve("src/pages"));
        Files.createDirectories(repo.resolve("src/components"));
        Files.writeString(repo.resolve("src/pages/Login.tsx"),
                "import { Field } from '@/components/Field';\nimport React from 'react';\nexport const Login = () => <Field />;");
        Files.writeString(repo.resolve("src/components/Field.tsx"),
                "import { Deep } from './Deep';\nexport const Field = () => <Deep />;");
        Files.writeString(repo.resolve("src/components/Deep.tsx"),
                "import { TooDeep } from './TooDeep';\nexport const Deep = () => null;");
        Files.writeString(repo.resolve("src/components/TooDeep.tsx"), "export const TooDeep = () => null;");

        Map<String, String> first = extractor.bundle(repo, "", "src/pages/Login.tsx");
        assertThat(first.keySet()).containsExactly(
                "src/pages/Login.tsx", "src/components/Field.tsx", "src/components/Deep.tsx");
        assertThat(extractor.hash(extractor.bundle(repo, "", "src/pages/Login.tsx"))).isEqualTo(extractor.hash(first));

        Files.writeString(repo.resolve("src/components/Deep.tsx"), "export const Deep = () => <button>변경</button>;");
        assertThat(extractor.hash(extractor.bundle(repo, "", "src/pages/Login.tsx"))).isNotEqualTo(extractor.hash(first));
    }
}
