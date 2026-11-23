package com.playops.api.service;

import com.playops.api.config.PlayOpsProperties;
import com.playops.api.dto.AppFixDtos.View;
import com.playops.api.dto.DefectDtos.Defect;
import com.playops.api.dto.DefectDtos.DefectRun;
import com.playops.api.entity.AiModelProvider;
import com.playops.api.entity.AppFixProposal;
import com.playops.api.entity.Project;
import com.playops.api.entity.ProjectMember;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.AppFixProposalRepository;
import com.playops.api.repository.ProjectMemberRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.util.ReflectionTestUtils;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AppFixProposalServiceTest {

    private static final String SHA = "0123456789abcdef0123456789abcdef01234567";
    private static final String URL = "https://github.com/acme/shop";
    private static final String ERROR = """
            Error: expect(locator).toHaveText(expected) failed
            Expected string: "합계 3"
            Received string: "합계 2"
            cookie: sid=abc123
            """;

    private final AppFixProposalRepository proposals = mock(AppFixProposalRepository.class);
    private final ProjectMemberRepository members = mock(ProjectMemberRepository.class);
    private final DefectService defects = mock(DefectService.class);
    private final ProjectService projects = mock(ProjectService.class);
    private final GitRepositoryService git = mock(GitRepositoryService.class);
    private final DockerRunnerService docker = mock(DockerRunnerService.class);
    private final StepRecordService steps = mock(StepRecordService.class);
    private final LlmGatewayService llm = mock(LlmGatewayService.class);
    private final AiProviderSettingsService providers = mock(AiProviderSettingsService.class);
    private final AppFixProposalService self = mock(AppFixProposalService.class);
    private final com.playops.api.repository.UserRepository users = mock(com.playops.api.repository.UserRepository.class);

    @TempDir
    Path storage;

    private AppFixProposalService service;
    private Project project;

    @BeforeEach
    void setUp() {
        service = new AppFixProposalService(proposals, members, defects, projects, git, docker, steps, new ScreenFinder(),
                llm, providers, new PlayOpsProperties("p", storage.toString(), false, null), users, self);
        project = new Project();
        project.setProjectId("shop");
        project.setEnvVariables("{\"LOGIN_PASSWORD\":\"s3cr3t-pass\"}");
        when(projects.getProject("shop")).thenReturn(project);
        when(members.findByProjectIdAndUserId("shop", 7L)).thenReturn(Optional.of(new ProjectMember()));
        when(defects.find("shop", "tests/cart.spec.ts", "합계")).thenReturn(defect("APP_CODE"));
        when(steps.steps("shop", 41L)).thenReturn(new StepRecordService.StepsResponse(true, List.of(
                new StepRecordService.CaseSteps("tests/cart.spec.ts", "cart.spec.ts > 장바구니 > 합계", "FAILED", 1, List.of(
                        new StepRecordService.Step("https://shop.test/cart?session=zz 로 이동", "pw:api", "PASSED", null, 0L),
                        new StepRecordService.Step("'합계' 확인", "expect", "FAILED", "Received string: \"합계 2\"", 10L)),
                        List.of()))));
        when(proposals.saveAndFlush(any())).thenAnswer(inv -> withId(inv.getArgument(0)));
        when(proposals.save(any())).thenAnswer(inv -> inv.getArgument(0));
        when(docker.directoryContainerPath(any())).thenAnswer(inv -> inv.getArgument(0).toString());
        when(docker.directoryVolumeArgs(any())).thenReturn(List.of());
        when(git.validateAndNormalize(URL)).thenReturn("acme/shop");
        when(llm.defaultProvider()).thenReturn(AiModelProvider.CLAUDE);
        when(providers.hasKey(AiModelProvider.CLAUDE)).thenReturn(true);
    }

    private static Defect defect(String category) {
        return new Defect("tests/cart.spec.ts", "합계", "합계", "장바구니", "OPEN", null, null, 1,
                41L, Instant.now(), 41L, Instant.now(), null, null, ERROR, List.of(),
                List.of(new DefectRun(41L, "FAILED", Instant.now(), null)), category);
    }

    private static AppFixProposal withId(AppFixProposal p) {
        if (p.getId() == null) ReflectionTestUtils.setField(p, "id", 5L);
        return p;
    }

    private AppFixProposal created() {
        ArgumentCaptor<AppFixProposal> saved = ArgumentCaptor.forClass(AppFixProposal.class);
        verify(proposals).saveAndFlush(saved.capture());
        AppFixProposal p = saved.getValue();
        when(proposals.findById(p.getId())).thenReturn(Optional.of(p));
        return p;
    }

    // ── 권한 · 분류 · 중복 ──

    @Test
    void outsidersCannotReadOrRequest() {
        assertThatThrownBy(() -> service.get("shop", "tests/cart.spec.ts", "합계", 99L, false))
                .isInstanceOf(ApiException.class).hasFieldOrPropertyWithValue("status", 403);
        assertThatThrownBy(() -> service.request("shop", "tests/cart.spec.ts", "합계", null, 99L, false))
                .isInstanceOf(ApiException.class).hasFieldOrPropertyWithValue("status", 403);
        verify(proposals, never()).saveAndFlush(any());
    }

    @Test
    void adminFollowsTheExistingPolicyWithoutMembership() {
        View view = service.get("shop", "tests/cart.spec.ts", "합계", 1L, true);
        assertThat(view.category()).isEqualTo("APP_CODE");
        assertThat(view.proposal()).isNull();
    }

    @Test
    void legacyAnalysisChatAdminIsRecognizedFromTheAuthenticatedUserId() {
        com.playops.api.entity.User admin = new com.playops.api.entity.User();
        admin.setId(1L);
        admin.setRole(com.playops.api.entity.UserRole.ADMIN);
        when(users.findById(1L)).thenReturn(Optional.of(admin));
        // 예전 AI 분석 채팅(POST /api/ai/chat)과 같은 진입점: 인증된 사용자 id 만 넘기고 관리자 여부는 false 로 둔다
        AiChatToolService legacy = new AiChatToolService(new com.playops.api.chat.ChatToolRegistry(
                List.of(new com.playops.api.chat.tools.GetAppFixProposalTool(service))));
        com.playops.api.llm.LlmToolCall call = new com.playops.api.llm.LlmToolCall("c1", "get_app_fix_proposal",
                Map.of("specPath", "tests/cart.spec.ts", "grep", "합계"));

        com.playops.api.llm.LlmToolResult asAdmin = legacy.execute(call, new AiChatToolService.ToolContext("shop", 1L, null));
        com.playops.api.llm.LlmToolResult asOutsider = legacy.execute(call, new AiChatToolService.ToolContext("shop", 99L, null));

        assertThat(asAdmin.error()).as(asAdmin.content()).isFalse();
        assertThat(asAdmin.content()).contains("APP_CODE");
        assertThat(asOutsider.error()).isTrue();
        assertThat(asOutsider.content()).contains("멤버가 아닙니다");
    }

    @Test
    void onlyCodeOrApiCandidatesGetAProposal() {
        when(defects.find("shop", "tests/cart.spec.ts", "합계")).thenReturn(defect("TEST"));
        assertThatThrownBy(() -> service.request("shop", "tests/cart.spec.ts", "합계", null, 7L, false))
                .isInstanceOf(ApiException.class).hasFieldOrPropertyWithValue("status", 409);
    }

    @Test
    void sameFailureAndSourceShaReusesTheProposal() {
        project.setSourceRepositoryUrl(URL);
        when(git.remoteHeadSha("shop", URL, null)).thenReturn(SHA);
        AppFixProposal existing = withId(new AppFixProposal());
        existing.setStatus(AppFixProposal.ANALYZING);
        when(proposals.findByIdentityKey(anyString())).thenReturn(Optional.of(existing));

        View view = service.request("shop", "tests/cart.spec.ts", "합계", 41L, 7L, false);

        assertThat(view.proposal().id()).isEqualTo(5L);
        verify(proposals, never()).saveAndFlush(any());
        verify(self, never()).runAsync(any());
    }

    @Test
    void concurrentDuplicateFallsBackToTheFirstOne() {
        AppFixProposal first = withId(new AppFixProposal());
        first.setStatus(AppFixProposal.ANALYZING);
        when(proposals.findByIdentityKey(anyString())).thenReturn(Optional.empty(), Optional.of(first));
        doThrow(new DataIntegrityViolationException("uk")).when(proposals).saveAndFlush(any());

        View view = service.request("shop", "tests/cart.spec.ts", "합계", null, 7L, false);

        assertThat(view.proposal().id()).isEqualTo(5L);
        verify(self, never()).runAsync(any());
    }

    @Test
    void failedProposalCanBeRequestedAgain() {
        AppFixProposal failed = withId(new AppFixProposal());
        failed.setStatus(AppFixProposal.FAILED);
        failed.setErrorMessage("모델 응답 시간 초과");
        when(proposals.findByIdentityKey(anyString())).thenReturn(Optional.of(failed));
        when(proposals.retry(eq(5L), eq(7L), any(), any())).thenReturn(1);

        View view = service.request("shop", "tests/cart.spec.ts", "합계", null, 7L, false);

        assertThat(view.proposal().status()).isEqualTo(AppFixProposal.ANALYZING);
        assertThat(view.proposal().errorMessage()).isNull();
        verify(self).runAsync(5L);
    }

    @Test
    void onlyOneOfTwoRetriesOfTheSameFailedRowStartsAnalysis() {
        AppFixProposal failed = withId(new AppFixProposal());
        failed.setStatus(AppFixProposal.FAILED);
        AppFixProposal already = withId(new AppFixProposal());
        already.setStatus(AppFixProposal.ANALYZING);
        when(proposals.findByIdentityKey(anyString())).thenReturn(Optional.of(failed));
        when(proposals.retry(eq(5L), eq(7L), any(), any())).thenReturn(0);
        when(proposals.findById(5L)).thenReturn(Optional.of(already));

        View view = service.request("shop", "tests/cart.spec.ts", "합계", null, 7L, false);

        assertThat(view.proposal().status()).isEqualTo(AppFixProposal.ANALYZING);
        verify(self, never()).runAsync(any());
    }

    @Test
    void caseWithoutDescribeStillGivesEvidence() {
        Defect noDescribe = new Defect("tests/cart.spec.ts", "합계", "합계", null, "OPEN", null, null, 1,
                41L, Instant.now(), 41L, Instant.now(), null, null, ERROR, List.of(),
                List.of(new DefectRun(41L, "FAILED", Instant.now(), null)), "APP_CODE");
        when(defects.find("shop", "tests/cart.spec.ts", "합계")).thenReturn(noDescribe);

        service.request("shop", "tests/cart.spec.ts", "합계", null, 7L, false);

        assertThat(created().getEvidence()).contains("케이스: 합계");
    }

    @Test
    void theRepositoryAndAppRootUsedAreFixedToTheProposal() {
        publicMonorepo(SHA);
        when(llm.chat(any(), anyString(), anyString(), anyString(), eq("shop"))).thenReturn("{\"summary\":\"s\"}");
        service.request("shop", "tests/cart.spec.ts", "합계", null, 7L, false);
        AppFixProposal p = created();
        String firstKey = p.getIdentityKey();
        assertThat(p.getSourceRepository()).isEqualTo("acme/shop");
        assertThat(p.getAppRoot()).isEqualTo("apps/shop");

        // 요청 뒤 프로젝트 설정이 바뀌어도 이 작업은 요청 때의 저장소 · 앱 폴더로 분석한다
        project.setSourceRepositoryUrl("https://github.com/other/repo");
        project.setSourceAppRoot("apps/admin");
        service.runAsync(p.getId());
        verify(git).fetchCommit(eq("shop"), eq(URL), eq(SHA), anyString(), any());
        assertThat(p.getAppRoot()).isEqualTo("apps/shop");

        // 바뀐 설정은 다른 작업이다: 조회하면 이전 수정안, 다시 요청하면 새 키
        when(proposals.findFirstByProjectIdAndSpecPathAndGrepOrderByIdDesc("shop", "tests/cart.spec.ts", "합계"))
                .thenReturn(Optional.of(p));
        when(git.validateAndNormalize("https://github.com/other/repo")).thenReturn("other/repo");
        assertThat(service.get("shop", "tests/cart.spec.ts", "합계", 7L, false).stale()).isTrue();
        verify(git, never()).remoteHeadSha(eq("shop"), eq("https://github.com/other/repo"), any());
        when(git.remoteHeadSha("shop", "https://github.com/other/repo", null)).thenReturn(SHA);
        service.request("shop", "tests/cart.spec.ts", "합계", null, 7L, false);
        ArgumentCaptor<AppFixProposal> again = ArgumentCaptor.forClass(AppFixProposal.class);
        verify(proposals, org.mockito.Mockito.times(2)).saveAndFlush(again.capture());
        assertThat(again.getValue().getIdentityKey()).isNotEqualTo(firstKey);
    }

    @Test
    void symlinksAreNotReadAndAnAppRootOutsideTheCheckoutIsRefused() throws Exception {
        Path outside = Files.createDirectories(storage.resolve("outside"));
        Files.writeString(outside.resolve("secret.ts"), "export const leaked = '합계 OUTSIDE-SECRET';\n");
        publicMonorepo(SHA);
        doAnswer(inv -> {
            Path dir = Path.of((String) inv.getArgument(3));
            write(dir, ".git/HEAD", SHA + "\n");
            write(dir, "apps/shop/app/cart/page.tsx", "export default function Cart() { return <p>합계</p>; }\n");
            Files.createSymbolicLink(dir.resolve("apps/shop/app/cart/leak.ts"), outside.resolve("secret.ts"));
            Files.createSymbolicLink(dir.resolve("apps/linked"), outside);
            return null;
        }).when(git).fetchCommit(eq("shop"), eq(URL), eq(SHA), anyString(), any());
        ArgumentCaptor<String> prompt = ArgumentCaptor.forClass(String.class);
        when(llm.chat(any(), anyString(), prompt.capture(), anyString(), eq("shop"))).thenReturn("{\"summary\":\"s\"}");

        service.request("shop", "tests/cart.spec.ts", "합계", null, 7L, false);
        service.runAsync(created().getId());
        assertThat(prompt.getValue()).contains("apps/shop/app/cart/page.tsx").doesNotContain("OUTSIDE-SECRET", "leak.ts");

        project.setSourceAppRoot("apps/linked");
        when(proposals.findByIdentityKey(anyString())).thenReturn(Optional.empty());
        service.request("shop", "tests/cart.spec.ts", "합계", null, 7L, false);
        ArgumentCaptor<AppFixProposal> second = ArgumentCaptor.forClass(AppFixProposal.class);
        verify(proposals, org.mockito.Mockito.times(2)).saveAndFlush(second.capture());
        AppFixProposal linked = second.getValue();
        when(proposals.findById(linked.getId())).thenReturn(Optional.of(linked));
        service.runAsync(linked.getId());

        assertThat(prompt.getValue()).doesNotContain("OUTSIDE-SECRET");
        assertThat(linked.getLimitation()).contains("앱 폴더");
    }

    @Test
    void aFullAnalysisQueueIsRecordedAsFailedSoItCanBeRequestedAgain() {
        doThrow(new org.springframework.core.task.TaskRejectedException("full")).when(self).runAsync(5L);

        View view = service.request("shop", "tests/cart.spec.ts", "합계", null, 7L, false);

        assertThat(view.proposal().status()).isEqualTo(AppFixProposal.FAILED);
        assertThat(view.proposal().errorMessage()).contains("대기열");
        verify(proposals).save(any());
    }

    @Test
    void onStartupOnlyAnalysesLeftFromBeforeTheRestartFail() {
        service.failInterrupted();
        ArgumentCaptor<Instant> before = ArgumentCaptor.forClass(Instant.class);
        verify(proposals).failInterrupted(before.capture(), anyString(), any());
        assertThat(before.getValue()).isBeforeOrEqualTo(Instant.now());
    }

    @Test
    void anOlderFailedRunIsNotTheBasis() {
        assertThatThrownBy(() -> service.request("shop", "tests/cart.spec.ts", "합계", 12L, 7L, false))
                .isInstanceOf(ApiException.class).hasFieldOrPropertyWithValue("status", 409);
    }

    @Test
    void evidenceIsStoredWithoutCredentialsQueryStringsOrEnvValues() {
        service.request("shop", "tests/cart.spec.ts", "합계", null, 7L, false);
        AppFixProposal p = created();

        assertThat(p.getEvidence()).contains("합계 2", "https://shop.test/cart").doesNotContain("abc123", "session=zz", "s3cr3t-pass");
        assertThat(p.getRequestedBy()).isEqualTo(7L);
        verify(self).runAsync(5L);
    }

    @Test
    void evidenceUsesTheStepsOfThisCaseNotOfACaseWhoseTitleEndsTheSame() {
        when(steps.steps("shop", 41L)).thenReturn(new StepRecordService.StepsResponse(true, List.of(
                new StepRecordService.CaseSteps("tests/cart.spec.ts", "cart.spec.ts > 장바구니 > 총합계", "FAILED", 0, List.of(
                        new StepRecordService.Step("다른 케이스의 단계", "expect", "FAILED", null, 0L)), List.of()),
                new StepRecordService.CaseSteps("tests/cart.spec.ts", "cart.spec.ts > 장바구니 > 합계", "FAILED", 0, List.of(
                        new StepRecordService.Step("이 케이스의 단계", "expect", "FAILED", null, 0L)), List.of()))));

        service.request("shop", "tests/cart.spec.ts", "합계", null, 7L, false);

        assertThat(created().getEvidence()).contains("이 케이스의 단계").doesNotContain("다른 케이스의 단계");
    }

    @Test
    void anUnreadableSourceFileIsSkippedInsteadOfFailingTheAnalysis() {
        publicMonorepo(SHA);
        org.mockito.Mockito.doAnswer(inv -> {
            Path dir = Path.of((String) inv.getArgument(3));
            write(dir, ".git/HEAD", SHA + "\n");
            write(dir, "apps/shop/app/cart/page.tsx",
                    "export default function Cart({ items }) {\n  const count = items.length - 1;\n  return <p>합계 {count}</p>;\n}\n");
            // 빌드된 파일 같은 UTF-8 이 아닌 소스
            Path bad = dir.resolve("apps/shop/app/cart/legacy.js");
            Files.write(bad, new byte[]{(byte) 0xC3, (byte) 0x28, 'c', 'a', 'r', 't'});
            return null;
        }).when(git).fetchCommit(eq("shop"), eq(URL), eq(SHA), anyString(), any());
        when(llm.chat(any(), anyString(), anyString(), anyString(), eq("shop"))).thenReturn("""
                {"summary":"s","edits":[{"path":"apps/shop/app/cart/page.tsx","find":"items.length - 1","replace":"items.length"}]}
                """);
        service.request("shop", "tests/cart.spec.ts", "합계", null, 7L, false);
        AppFixProposal p = created();

        service.runAsync(p.getId());

        assertThat(p.getStatus()).isEqualTo(AppFixProposal.DIFF_READY);
    }

    // ── 진단만 ──

    @Test
    void urlOnlyProjectGivesDiagnosisOnly() {
        when(llm.chat(any(), anyString(), anyString(), anyString(), eq("shop")))
                .thenReturn("{\"summary\":\"합계 계산이 1 적다\",\"causes\":[],\"checks\":[\"장바구니 합계 계산\"],\"edits\":[]}");
        service.request("shop", "tests/cart.spec.ts", "합계", null, 7L, false);
        AppFixProposal p = created();

        service.runAsync(p.getId());

        assertThat(p.getStatus()).isEqualTo(AppFixProposal.DIAGNOSIS_ONLY);
        assertThat(p.getLimitation()).contains("웹주소만");
        assertThat(p.getSummary()).contains("합계 계산");
        verify(git, never()).remoteHeadSha(any(), any(), any());
    }

    @Test
    void inaccessibleRepositoryGivesDiagnosisOnly() {
        project.setSourceRepositoryUrl(URL);
        when(git.remoteHeadSha("shop", URL, null)).thenThrow(new ApiException(502, "공개 저장소 acme/shop 을 읽지 못했습니다."));
        when(llm.chat(any(), anyString(), anyString(), anyString(), eq("shop"))).thenReturn("{\"summary\":\"s\"}");
        service.request("shop", "tests/cart.spec.ts", "합계", null, 7L, false);
        AppFixProposal p = created();
        service.runAsync(p.getId());

        assertThat(p.getSourceSha()).isNull();
        assertThat(p.getStatus()).isEqualTo(AppFixProposal.DIAGNOSIS_ONLY);
        assertThat(p.getLimitation()).contains("공개 저장소");
        verify(git, never()).fetchCommit(any(), any(), any(), any(), any());
    }

    @Test
    void dockerUnavailableIsExplainedAsAnEnvironmentLimitNotAPrivateRepository() {
        project.setSourceRepositoryUrl(URL);
        when(git.remoteHeadSha("shop", URL, null))
                .thenThrow(new ApiException(409, "Docker가 비활성화되어 있어 GitHub 샌드박스를 준비할 수 없습니다."));

        service.request("shop", "tests/cart.spec.ts", "합계", null, 7L, false);

        assertThat(created().getLimitation()).contains("Docker가 비활성화").doesNotContain("비공개");
    }

    @Test
    void aDiagnosisMadeWithoutAiIsAnalyzedAgainOnceAKeyIsRegistered() {
        when(providers.hasKey(AiModelProvider.CLAUDE)).thenReturn(false);
        service.request("shop", "tests/cart.spec.ts", "합계", null, 7L, false);
        AppFixProposal p = created();
        service.runAsync(p.getId());
        assertThat(p.getStatus()).isEqualTo(AppFixProposal.DIAGNOSIS_ONLY);
        assertThat(p.getSummary()).isNull();
        when(proposals.findByIdentityKey(anyString())).thenReturn(Optional.of(p));

        // 키가 아직 없으면 같은 진단을 그대로 쓴다
        service.request("shop", "tests/cart.spec.ts", "합계", null, 7L, false);
        verify(proposals, never()).retry(any(), any(), any(), any());

        // 키를 등록하면 같은 실패 · 기준의 행을 다시 분석한다. 한계 문구는 요청 때(소스 없음)의 것으로 되돌린다
        when(providers.hasKey(AiModelProvider.CLAUDE)).thenReturn(true);
        ArgumentCaptor<String> limitation = ArgumentCaptor.forClass(String.class);
        when(proposals.retry(eq(5L), eq(7L), limitation.capture(), any())).thenReturn(1);

        View view = service.request("shop", "tests/cart.spec.ts", "합계", null, 7L, false);

        assertThat(view.proposal().status()).isEqualTo(AppFixProposal.ANALYZING);
        assertThat(limitation.getValue()).contains("웹주소만").doesNotContain("AI 설정");
        verify(self, org.mockito.Mockito.times(2)).runAsync(5L);
    }

    @Test
    void withoutAiKeyOnlyTheEvidenceIsShown() {
        when(providers.hasKey(AiModelProvider.CLAUDE)).thenReturn(false);
        service.request("shop", "tests/cart.spec.ts", "합계", null, 7L, false);
        AppFixProposal p = created();
        service.runAsync(p.getId());

        assertThat(p.getStatus()).isEqualTo(AppFixProposal.DIAGNOSIS_ONLY);
        assertThat(p.getLimitation()).contains("AI");
        verify(llm, never()).chat(any(), anyString(), anyString(), anyString(), anyString());
    }

    // ── 공개 저장소의 diff ──

    private void publicMonorepo(String headSha) {
        project.setSourceRepositoryUrl(URL);
        // 앱이 둘인 모노레포: 프로젝트 소스 설정의 앱 폴더만 본다
        project.setSourceAppRoot("apps/shop");
        when(git.remoteHeadSha("shop", URL, null)).thenReturn(SHA);
        doAnswer(inv -> {
            Path dir = Path.of((String) inv.getArgument(3));
            write(dir, ".git/HEAD", headSha + "\n");
            write(dir, "package.json", "{\"private\":true}");
            write(dir, "apps/shop/package.json", "{\"dependencies\":{\"next\":\"14.0.0\"}}");
            write(dir, "apps/shop/app/cart/page.tsx",
                    "export default function Cart({ items }) {\n  const count = items.length - 1;\n  return <p>합계 {count}</p>;\n}\n");
            write(dir, "apps/shop/.env.local", "SECRET=nope");
            write(dir, "apps/admin/package.json", "{\"dependencies\":{\"next\":\"14.0.0\"}}");
            write(dir, "apps/admin/app/cart/page.tsx", "export default function AdminCart() { return <p>합계</p>; }\n");
            return null;
        }).when(git).fetchCommit(eq("shop"), eq(URL), eq(SHA), anyString(), any());
    }

    private static void write(Path dir, String path, String content) throws Exception {
        Path file = dir.resolve(path);
        Files.createDirectories(file.getParent());
        Files.writeString(file, content);
    }

    @Test
    void publicMonorepoGivesAReviewDiffAtTheExactSha() {
        publicMonorepo(SHA);
        ArgumentCaptor<String> prompt = ArgumentCaptor.forClass(String.class);
        when(llm.chat(any(), anyString(), prompt.capture(), anyString(), eq("shop"))).thenReturn("""
                {"summary":"합계에서 1을 뺀다","causes":["apps/shop/app/cart/page.tsx:2 — items.length - 1"],"checks":[],
                 "edits":[{"path":"apps/shop/app/cart/page.tsx","find":"items.length - 1","replace":"items.length"}]}
                """);
        service.request("shop", "tests/cart.spec.ts", "합계", null, 7L, false);
        AppFixProposal p = created();

        service.runAsync(p.getId());

        assertThat(p.getStatus()).isEqualTo(AppFixProposal.DIFF_READY);
        assertThat(p.getVerification()).isEqualTo(AppFixProposal.DIFF_APPLIES);
        assertThat(p.getSourceSha()).isEqualTo(SHA);
        assertThat(p.getSourceRepository()).isEqualTo("acme/shop");
        assertThat(p.getAppRoot()).isEqualTo("apps/shop");
        assertThat(p.getFiles()).contains("apps/shop/app/cart/page.tsx", "-  const count = items.length - 1;", "+  const count = items.length;");
        assertThat(prompt.getValue()).contains("apps/shop/app/cart/page.tsx")
                .doesNotContain("apps/admin", "SECRET=nope", "abc123", "s3cr3t-pass");
        assertThat(Files.exists(storage.resolve("app-fix").resolve("5"))).isFalse();
    }

    @Test
    void aDifferentCheckedOutCommitIsNotUsed() {
        publicMonorepo("ffffffffffffffffffffffffffffffffffffffff");
        when(llm.chat(any(), anyString(), anyString(), anyString(), eq("shop"))).thenReturn("{\"summary\":\"s\"}");
        service.request("shop", "tests/cart.spec.ts", "합계", null, 7L, false);
        AppFixProposal p = created();
        service.runAsync(p.getId());

        assertThat(p.getStatus()).isEqualTo(AppFixProposal.DIAGNOSIS_ONLY);
        assertThat(p.getLimitation()).contains("기준 커밋");
    }

    @Test
    void editsOutsideTheCandidatesOrNotMatchingAreDropped() {
        publicMonorepo(SHA);
        when(llm.chat(any(), anyString(), anyString(), anyString(), eq("shop"))).thenReturn("""
                {"summary":"s","edits":[
                  {"path":"apps/admin/app/cart/page.tsx","find":"합계","replace":"총합"},
                  {"path":"apps/shop/app/cart/page.tsx","find":"없는 코드","replace":"x"}]}
                """);
        service.request("shop", "tests/cart.spec.ts", "합계", null, 7L, false);
        AppFixProposal p = created();
        service.runAsync(p.getId());

        assertThat(p.getStatus()).isEqualTo(AppFixProposal.DIAGNOSIS_ONLY);
        assertThat(p.getFiles()).isNull();
        assertThat(p.getLimitation()).contains("적용할 수 있는");
    }

    @Test
    void unexpectedErrorsEndAsFailedWithTheReason() {
        when(llm.chat(any(), anyString(), anyString(), anyString(), eq("shop"))).thenThrow(new RuntimeException("모델 응답 시간 초과"));
        service.request("shop", "tests/cart.spec.ts", "합계", null, 7L, false);
        AppFixProposal p = created();
        service.runAsync(p.getId());

        assertThat(p.getStatus()).isEqualTo(AppFixProposal.FAILED);
        assertThat(p.getErrorMessage()).contains("시간 초과");
    }

    @Test
    void readShowsTheLatestProposalAndMarksAnOlderRunAsStale() {
        AppFixProposal old = withId(new AppFixProposal());
        old.setStatus(AppFixProposal.DIFF_READY);
        old.setExecutionId(30L);
        old.setFiles("[{\"path\":\"a.ts\",\"diff\":\"--- a/a.ts\"}]");
        when(proposals.findFirstByProjectIdAndSpecPathAndGrepOrderByIdDesc("shop", "tests/cart.spec.ts", "합계"))
                .thenReturn(Optional.of(old));

        View view = service.get("shop", "tests/cart.spec.ts", "합계", 7L, false);

        assertThat(view.stale()).isTrue();
        assertThat(view.latestFailedExecutionId()).isEqualTo(41L);
        assertThat(view.proposal().files()).extracting("path").containsExactly("a.ts");
    }
}
