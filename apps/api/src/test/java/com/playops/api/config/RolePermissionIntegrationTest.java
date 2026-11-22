package com.playops.api.config;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

/**
 * 관리자 · PM · 팀원 권한을 실제 앱(인터셉터 · 컨트롤러 · H2 DB)으로 확인한다 (#105).
 * 시드: admin 은 모든 데모 프로젝트의 PM, 게스트는 example.com 팀원.
 */
@SpringBootTest(properties = {
        "spring.flyway.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:roles;MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect",
        "playops.docker-enabled=false",
        "playops.projects-root=build/tmp/roles-projects",
        "playops.storage-root=build/tmp/roles-storage",
        "LOGIN_USERNAME=admin",
        "LOGIN_PASSWORD=admin-test-pass-1"
})
@AutoConfigureMockMvc
class RolePermissionIntegrationTest {

    @Autowired
    MockMvc mvc;

    @Autowired
    ObjectMapper json;

    @Autowired
    com.playops.api.repository.ExecutionRepository executions;

    @Autowired
    com.playops.api.repository.SiteAnalysisRunRepository analysisRuns;

    @Autowired
    com.playops.api.repository.ScenarioCaseSettingRepository planRows;

    @Autowired
    com.playops.api.repository.ExecutionCaseResultRepository caseResults;

    @Autowired
    com.playops.api.repository.AiJobRepository aiJobs;

    /** 러너 없이 실행 요청까지만 확인하려고 러너 확인만 건너뛴다. */
    @org.springframework.boot.test.mock.mockito.SpyBean
    com.playops.api.service.ProjectService projectService;

    private static int signups;
    private String admin;
    private String member;
    private long memberId;

    private JsonNode call(MockHttpServletRequestBuilder req, String token, int expectStatus) throws Exception {
        if (token != null) req.header("Authorization", "Bearer " + token);
        var res = mvc.perform(req.contentType(MediaType.APPLICATION_JSON)).andReturn().getResponse();
        assertThat(res.getStatus()).as(res.getContentAsString()).isEqualTo(expectStatus);
        String body = res.getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        return body.isBlank() ? null : json.readTree(body);
    }

    private int status(MockHttpServletRequestBuilder req, String token) throws Exception {
        req.header("Authorization", "Bearer " + token);
        return mvc.perform(req.contentType(MediaType.APPLICATION_JSON)).andReturn().getResponse().getStatus();
    }

    /**
     * 앱이 뜨기 전에 프로젝트 폴더를 비운다. 지난 실행의 시연 spec 이 남아 있으면 DemoDataSeeder 가
     * 계획 칸(담당자 · 마감일)을 채우지 않아 두 번째 실행부터 실패한다.
     */
    @org.junit.jupiter.api.BeforeAll
    static void cleanProjectsRoot() throws Exception {
        org.springframework.util.FileSystemUtils.deleteRecursively(java.nio.file.Path.of("build/tmp/roles-projects"));
    }

    @BeforeEach
    void setUp() throws Exception {
        admin = call(post("/api/auth/login").content("{\"username\":\"admin\",\"password\":\"admin-test-pass-1\"}"), null, 200)
                .get("token").asText();
        String name = "m" + UUID.randomUUID().toString().substring(0, 8);
        // 가입은 IP당 분당 5회라 테스트마다 다른 주소에서 가입한다
        JsonNode signup = call(post("/api/auth/signup").header("X-Forwarded-For", "10.9.0." + (++signups))
                .content("{\"username\":\"" + name + "\",\"name\":\"팀원\",\"password\":\"password123\"}"), null, 200);
        member = signup.get("token").asText();
        memberId = signup.get("user").get("id").asLong();
        call(post("/api/projects/example.com/members").content("{\"userId\":" + memberId + ",\"role\":\"MEMBER\"}"), admin, 200);
    }

    private List<String> projectIds(String token) throws Exception {
        List<String> ids = new ArrayList<>();
        call(get("/api/projects"), token, 200).forEach(p -> ids.add(p.get("projectId").asText()));
        return ids;
    }

    @Test
    void teamMemberSeesOnlyTheirProjects() throws Exception {
        assertThat(projectIds(member)).containsExactly("example.com");
        assertThat(projectIds(admin)).contains("example.com", "google.com", "naver.com");
    }

    @Test
    void teamMemberCannotOpenAnotherProject() throws Exception {
        assertThat(status(get("/api/projects/google.com"), member)).isEqualTo(403);
        assertThat(status(get("/api/projects/google.com/plan"), member)).isEqualTo(403);
        assertThat(status(get("/api/projects/example.com"), member)).isEqualTo(200);
    }

    @Test
    void teamMemberSeesDefectsOfTheirProjectOnly() throws Exception {
        JsonNode defects = call(get("/api/projects/example.com/defects"), member, 200);
        assertThat(defects.has("open")).isTrue();
        assertThat(status(get("/api/projects/google.com/defects"), member)).isEqualTo(403);
    }

    @Test
    void teamMemberRerunsDefectsLinkedToTheFailedRun() throws Exception {
        org.mockito.Mockito.doNothing().when(projectService).ensureDockerRunnerRunning(org.mockito.ArgumentMatchers.any());
        var spec = projectService.getProjectPath("example.com").resolve("tests/defect-rerun.spec.ts");
        java.nio.file.Files.createDirectories(spec.getParent());
        java.nio.file.Files.writeString(spec, "import { test } from '@playwright/test';\ntest('결함 다시 실행 확인', async () => {});\n");
        JsonNode item = null;
        for (JsonNode i : call(get("/api/projects/example.com/plan"), member, 200).get("items")) {
            if (i.get("title").asText().equals("결함 다시 실행 확인")) item = i;
        }
        assertThat(item).isNotNull();
        var failed = new com.playops.api.entity.Execution();
        failed.setProjectId("example.com");
        failed.setStatus(com.playops.api.entity.ExecutionStatus.FAILED);
        failed = executions.save(failed);
        var result = new com.playops.api.entity.ExecutionCaseResult();
        result.setExecutionId(failed.getId());
        result.setSpecPath(item.get("specPath").asText());
        result.setCaseTitle(item.get("title").asText());
        result.setStatus("FAILED");
        caseResults.save(result);

        assertThat(status(post("/api/projects/google.com/defects/rerun").content("{}"), member)).isEqualTo(403);
        JsonNode run = call(post("/api/projects/example.com/defects/rerun").content("{}"), member, 200);
        assertThat(run.get("rerunOf").asLong()).isEqualTo(failed.getId());
        assertThat(run.get("caseTitle").asText()).isEqualTo("결함 다시 실행 1건");
        assertThat(executions.findById(run.get("id").asLong()).orElseThrow().getRerunOf()).isEqualTo(failed.getId());
    }

    @Test
    void teamMemberReadsStepsOfTheirProjectsRunsOnly() throws Exception {
        var mine = new com.playops.api.entity.Execution();
        mine.setProjectId("example.com");
        mine.setStatus(com.playops.api.entity.ExecutionStatus.PASSED); // 끝난 실행 — 남겨 두면 같은 프로젝트 실행이 409
        mine = executions.save(mine);
        var other = new com.playops.api.entity.Execution();
        other.setProjectId("google.com");
        other.setStatus(com.playops.api.entity.ExecutionStatus.PASSED);
        other = executions.save(other);

        JsonNode steps = call(get("/api/projects/example.com/executions/" + mine.getId() + "/steps"), member, 200);
        assertThat(steps.get("recorded").asBoolean()).isFalse();
        assertThat(status(get("/api/projects/google.com/executions/" + other.getId() + "/steps"), member)).isEqualTo(403);
        // 내 프로젝트 주소로 다른 프로젝트 실행을 물어도 보이지 않는다
        assertThat(status(get("/api/projects/example.com/executions/" + other.getId() + "/steps"), member)).isEqualTo(404);
    }

    /** 시연 데이터 (#87): 기본 점검 3 + 시연 2, 계획 칸이 채워지고 실패할 케이스는 기한 지남 · 높음 */
    @Test
    void demoProjectIsSeededWithPlanColumns() throws Exception {
        JsonNode items = call(get("/api/projects/example.com/plan"), member, 200).get("items");
        List<String> titles = new ArrayList<>();
        items.forEach(i -> titles.add(i.get("title").asText()));
        assertThat(titles).contains("첫 화면이 열린다", "첫 화면에 스크립트 오류가 없다", "첫 화면의 내부 링크가 열린다",
                "안내 링크가 보인다", "문의하기 링크가 보인다",
                "첫 화면 제목이 보인다"); // 미작성 시연 계획 (계획 우선 흐름)
        for (JsonNode i : items) {
            if (i.get("title").asText().equals("결함 다시 실행 확인")) continue; // 다른 테스트가 만든 파일
            assertThat(i.get("assigneeUserId").isNull()).as(i.get("title").asText()).isFalse();
            assertThat(i.get("dueDate").isNull()).isFalse();
            if (i.get("title").asText().equals("문의하기 링크가 보인다")) {
                assertThat(java.time.LocalDate.parse(i.get("dueDate").asText())).isBefore(java.time.LocalDate.now(java.time.ZoneId.of("Asia/Seoul")));
                assertThat(i.get("priority").asText()).isEqualTo("HIGH");
            }
        }
    }

    /**
     * 화면에서 팀원에게 숨긴 쓰기(화면 지도 · AI 작업)를 서버도 막는지 (3차 권한 화면 정리).
     * 화면만 숨기고 서버가 열려 있으면 숨김은 의미가 없다.
     */
    @Test
    void teamMemberCannotChangeTheScreenMapOrAiJobs() throws Exception {
        String base = "/api/projects/example.com";
        assertThat(status(post(base + "/sitemap/node").content("{\"routeKey\":\"/x\"}"), member)).isEqualTo(403);
        assertThat(status(patch(base + "/sitemap/node").content("{\"routeKey\":\"/x\",\"note\":\"n\"}"), member)).isEqualTo(403);
        assertThat(status(delete(base + "/sitemap/node").param("route", "/x"), member)).isEqualTo(403);
        assertThat(status(post(base + "/sitemap/analyze-url").content("{}"), member)).isEqualTo(403);
        assertThat(status(post(base + "/sitemap/analyze").content("{}"), member)).isEqualTo(403);
        assertThat(status(post(base + "/ai-jobs").content("{}"), member)).isEqualTo(403);
        assertThat(status(post(base + "/ai-jobs/template-generate").content("{}"), member)).isEqualTo(403);

        var job = new com.playops.api.entity.AiJob();
        job.setProjectId("example.com");
        job.setJobType(com.playops.api.entity.AiJobType.values()[0]);
        job.setStatus(com.playops.api.entity.AiJobStatus.PROPOSED);
        job = aiJobs.save(job);
        for (String action : List.of("approve", "reject", "proceed", "dismiss")) {
            assertThat(status(post("/api/ai-jobs/" + job.getId() + "/" + action).content("{}"), member)).as(action).isEqualTo(403);
        }
        // 보기는 된다
        assertThat(status(get(base + "/sitemap"), member)).isEqualTo(200);
    }

    /** 같은 프로젝트가 실행 중이면 새 실행 요청은 409, 결함 다시 실행도 같은 지점 (3차 3번) */
    @Test
    void aSecondRunOfTheSameProjectIsRejected() throws Exception {
        var running = new com.playops.api.entity.Execution();
        running.setProjectId("naver.com");
        running.setStatus(com.playops.api.entity.ExecutionStatus.RUNNING);
        running = executions.save(running);
        try {
            var res = mvc.perform(post("/api/projects/naver.com/executions").header("Authorization", "Bearer " + admin)
                    .contentType(MediaType.APPLICATION_JSON).content("{}")).andReturn().getResponse();
            assertThat(res.getStatus()).isEqualTo(409);
            assertThat(res.getContentAsString(java.nio.charset.StandardCharsets.UTF_8)).contains("이미 실행 중입니다");
        } finally {
            running.setStatus(com.playops.api.entity.ExecutionStatus.FAILED);
            executions.save(running);
        }
    }

    @Test
    void teamMemberCannotEditThePlan() throws Exception {
        assertThat(status(patch("/api/projects/example.com/plan/items")
                .content("{\"specPath\":\"a.spec.ts\",\"grep\":\"x\",\"assignee\":\"나\"}"), member)).isEqualTo(403);
        assertThat(status(put("/api/projects/example.com").content("{}"), member)).isEqualTo(403);
        // 계획 우선 흐름의 계획 행 쓰기도 PM 이상
        String plan = "/api/projects/example.com/plan";
        assertThat(status(post(plan + "/entries").content("{\"title\":\"팀원이 쓴 계획\"}"), member)).isEqualTo(403);
        assertThat(status(post(plan + "/entries/bulk").content("{\"entries\":[]}"), member)).isEqualTo(403);
        assertThat(status(patch(plan + "/entries/1").content("{}"), member)).isEqualTo(403);
        assertThat(status(delete(plan + "/entries/1"), member)).isEqualTo(403);
        assertThat(status(put(plan + "/entries/1/link").content("{}"), member)).isEqualTo(403);
        assertThat(status(post(plan + "/entries/1/generate"), member)).isEqualTo(403);
        assertThat(status(post(plan + "/entries/generate").content("{\"planIds\":[1]}"), member)).isEqualTo(403);
        assertThat(status(post(plan + "/link-suggestions"), member)).isEqualTo(403);
    }

    /** 계획 우선 흐름: PM 이 계획 행을 만들면 미작성 행으로 보이고, 지우면 사라진다 (H2 에서 엔티티 · 컨트롤러까지). */
    @Test
    void pmCreatesAnUnwrittenPlanEntry() throws Exception {
        String plan = "/api/projects/example.com/plan";
        JsonNode created = call(post(plan + "/entries").content("{\"title\":\"장바구니가 비어 있다\",\"screenRouteKey\":\"/cart\","
                + "\"expected\":\"빈 장바구니 문구\",\"assigneeUserId\":" + memberId + ",\"dueDate\":\"2026-11-30\",\"priority\":\"LOW\"}"),
                admin, 200);
        long planId = created.get("planId").asLong();
        try {
            assertThat(created.get("stage").asText()).isEqualTo("UNWRITTEN");
            JsonNode res = call(get(plan), member, 200);
            JsonNode row = null;
            for (JsonNode i : res.get("items")) if (i.get("planId").asLong() == planId) row = i;
            assertThat(row).isNotNull();
            assertThat(row.get("stage").asText()).isEqualTo("UNWRITTEN");
            assertThat(row.get("specPath").asText()).isEmpty();
            assertThat(row.get("expected").asText()).isEqualTo("빈 장바구니 문구");
            assertThat(res.get("summary").get("unwritten").asInt()).isGreaterThanOrEqualTo(1);
            assertThat(res.get("screens").toString()).contains("/cart");
            call(patch(plan + "/entries/" + planId).content("{\"title\":\"장바구니가 비어 있음\",\"assigneeUserId\":" + memberId
                    + ",\"dueDate\":\"2026-11-30\"}"), admin, 204);
            call(post(plan + "/entries").content("{\"title\":\"태그 @smoke\"}"), admin, 400);
        } finally {
            call(delete(plan + "/entries/" + planId), admin, 204);
        }
        call(delete(plan + "/entries/" + planId), admin, 404);
    }

    @Test
    void teamMemberCannotManageUsersOrRunners() throws Exception {
        assertThat(status(post("/api/users").content("{\"username\":\"x\",\"password\":\"password123\"}"), member)).isEqualTo(403);
        assertThat(status(get("/api/users"), member)).isEqualTo(403);
        assertThat(status(get("/api/projects/docker/runners"), member)).isEqualTo(403);
        assertThat(status(delete("/api/projects/example.com"), member)).isEqualTo(403);
    }

    /**
     * "게스트로 시작"은 비밀번호 없이 누구나 들어오는 공용 계정이라 둘러보기만 한다 (자체 리뷰 1위).
     * 시연 실행을 취소하거나 AI 비용을 쓰지 못하게 서버가 막는다. 자기 알림 비우기 · 로그아웃은 된다.
     */
    @Test
    void guestCanOnlyLookAround() throws Exception {
        String guest = call(post("/api/auth/guest"), null, 200).get("token").asText();

        call(get("/api/projects/example.com"), guest, 200);
        JsonNode run = call(post("/api/projects/example.com/executions").content("{}"), guest, 403);
        assertThat(run.get("error").get("code").asText()).isEqualTo("GUEST_READ_ONLY");
        for (MockHttpServletRequestBuilder write : List.of(
                post("/api/projects/example.com/execution/1/cancel"),
                post("/api/ai/chat").content("{\"message\":\"hi\"}"),
                delete("/api/ai/chat/sessions/1"),
                put("/api/projects/example.com").content("{}"),
                delete("/api/notifications-settings"))) {
            assertThat(call(write, guest, 403).get("error").get("code").asText()).isEqualTo("GUEST_READ_ONLY");
        }

        assertThat(status(delete("/api/notifications"), guest)).isEqualTo(204);
        assertThat(status(post("/api/auth/logout"), guest)).isEqualTo(204);
    }

    /** 'AI로 만들기' 의 spec 경로가 프로젝트 밖(절대 경로)을 가리키면 거절한다 (자체 리뷰 2위). */
    @Test
    void aiGeneratedSpecPathMustStayInsideTheProject() throws Exception {
        for (String path : List.of("/etc/cron.d/x.spec.ts", "tests/../../x.spec.ts")) {
            JsonNode res = call(post("/api/projects/example.com/ai-jobs/template-generate")
                    .content("{\"targetSpecPath\":\"" + path + "\",\"instruction\":\"첫 화면\"}"), admin, 400);
            assertThat(res.get("message").asText()).as(path).contains("프로젝트 안");
        }
        // 같은 구멍의 다른 입구: 실패 수정(CODE_FIX) 작업 · 편집 도움 확인 실행. 러너가 root 로 경로를 그대로 쓴다.
        JsonNode fix = call(post("/api/projects/example.com/ai-jobs")
                .content("{\"targetSpecPath\":\"../other/tests/x.spec.ts\",\"instruction\":\"고쳐\"}"), admin, 400);
        assertThat(fix.get("message").asText()).contains("프로젝트 안");
        JsonNode verify = call(post("/api/projects/example.com/ai/edit-assist/verify")
                .content("{\"filePath\":\"/tmp/x.spec.ts\",\"proposedContent\":\"x\"}"), admin, 400);
        assertThat(verify.get("message").asText()).contains("프로젝트 안");
    }

    /** AI 제공자 키는 관리자만 보고 바꾼다 (3-1 보안). 팀원도, 프로젝트 PM 도 403. */
    @Test
    void aiProviderSettingsAreAdminOnly() throws Exception {
        assertThat(status(get("/api/admin/ai-provider-settings"), member)).isEqualTo(403);
        assertThat(status(put("/api/admin/ai-provider-settings").content("{}"), member)).isEqualTo(403);

        call(patch("/api/projects/example.com/members/" + memberId).content("{\"role\":\"PM\"}"), admin, 200);
        assertThat(status(get("/api/admin/ai-provider-settings"), member)).isEqualTo(403);
        assertThat(status(put("/api/admin/ai-provider-settings").content("{}"), member)).isEqualTo(403);

        assertThat(status(get("/api/admin/ai-provider-settings"), admin)).isEqualTo(200);
    }

    @Test
    void pmCanEditThePlanButNotDeleteTheProject() throws Exception {
        call(patch("/api/projects/example.com/members/" + memberId).content("{\"role\":\"PM\"}"), admin, 200);

        assertThat(status(patch("/api/projects/example.com/plan/items")
                .content("{\"specPath\":\"a.spec.ts\",\"grep\":\"x\",\"assignee\":\"나\"}"), member)).isNotEqualTo(403);
        assertThat(status(delete("/api/projects/example.com"), member)).isEqualTo(403);
    }

    @Test
    void meReturnsGlobalAndProjectRoles() throws Exception {
        JsonNode me = call(get("/api/auth/me"), member, 200);

        assertThat(me.get("role").asText()).isEqualTo("USER");
        assertThat(me.get("projects").get(0).get("projectId").asText()).isEqualTo("example.com");
        assertThat(me.get("projects").get(0).get("role").asText()).isEqualTo("MEMBER");
    }

    @Test
    void pathParametersCannotSlipPastTheChecks() throws Exception {
        assertThat(status(get("/api;x/users"), member)).isEqualTo(400);
        assertThat(status(get("/api;x/projects/google.com/plan"), member)).isEqualTo(400);
        assertThat(status(get("/api/projects;x/google.com"), member)).isEqualTo(400);
    }

    @Test
    void teamMemberCannotAnalyzeAnotherProjectsExecution() throws Exception {
        com.playops.api.entity.Execution other = new com.playops.api.entity.Execution();
        other.setProjectId("google.com");
        other.setStatus(com.playops.api.entity.ExecutionStatus.FAILED);
        long id = executions.saveAndFlush(other).getId();

        assertThat(status(post("/api/ai/analyze").content("{\"executionId\":" + id + "}"), member)).isEqualTo(403);
    }

    @Test
    void runningAnalysesShowOnlyMyProjects() throws Exception {
        for (String projectId : new String[] {"example.com", "google.com"}) {
            com.playops.api.entity.SiteAnalysisRun run = new com.playops.api.entity.SiteAnalysisRun();
            run.setProjectId(projectId);
            analysisRuns.saveAndFlush(run);
        }
        List<String> ids = new ArrayList<>();
        call(get("/api/sitemap/running"), member, 200).forEach(r -> ids.add(r.get("projectId").asText()));

        assertThat(ids).contains("example.com").doesNotContain("google.com");
    }

    @Test
    void onlyAdminsWriteNoticesAndEveryoneIsNotified() throws Exception {
        assertThat(status(post("/api/notices").content("{\"title\":\"팀원 공지\",\"content\":\"x\"}"), member)).isEqualTo(403);

        JsonNode notice = call(post("/api/notices").content("{\"title\":\"점검 안내\",\"content\":\"11/20 점검\"}"), admin, 200);
        long id = notice.get("id").asLong();

        assertThat(status(put("/api/notices/" + id).content("{\"title\":\"x\",\"content\":\"y\"}"), member)).isEqualTo(403);
        assertThat(status(delete("/api/notices/" + id), member)).isEqualTo(403);
        List<String> titles = new ArrayList<>();
        call(get("/api/notices"), member, 200).forEach(n -> titles.add(n.get("title").asText()));
        assertThat(titles).contains("점검 안내");
        List<String> links = new ArrayList<>();
        call(get("/api/notifications"), member, 200).forEach(n -> links.add(n.get("link").asText()));
        assertThat(links).contains("/notices/" + id);
    }

    @Test
    void pmSetsProjectPeriodAndStatusButTeamMemberCannot() throws Exception {
        // 시연 프로젝트는 '실행' 상태로 채워진다 (3-1)
        assertThat(call(get("/api/projects/example.com"), member, 200).get("status").asText()).isEqualTo("RUNNING");
        assertThat(status(put("/api/projects/example.com").content("{\"status\":\"CLOSED\"}"), member)).isEqualTo(403);

        call(patch("/api/projects/example.com/members/" + memberId).content("{\"role\":\"PM\"}"), admin, 200);
        JsonNode saved = call(put("/api/projects/example.com")
                .content("{\"status\":\"RUNNING\",\"startDate\":\"2026-11-01\",\"endDate\":\"2026-12-01\"}"), member, 200);
        assertThat(saved.get("status").asText()).isEqualTo("RUNNING");
        assertThat(saved.get("startDate").asText()).isEqualTo("2026-11-01");
        assertThat(saved.get("endDate").asText()).isEqualTo("2026-12-01");

        // 시작일만 바꿔도 남아 있는 종료일과 비교한다
        assertThat(status(put("/api/projects/example.com").content("{\"startDate\":\"2026-12-02\"}"), member)).isEqualTo(400);
        assertThat(status(put("/api/projects/example.com").content("{\"endDate\":\"12월\"}"), member)).isEqualTo(400);

        JsonNode cleared = call(put("/api/projects/example.com").content("{\"endDate\":\"\"}"), member, 200);
        assertThat(cleared.get("endDate").isNull()).isTrue();
        assertThat(cleared.get("startDate").asText()).isEqualTo("2026-11-01");
    }

    @Test
    void planRowAndProjectRememberWhoChangedThemLast() throws Exception {
        call(patch("/api/projects/example.com/members/" + memberId).content("{\"role\":\"PM\"}"), admin, 200);
        String row = "{\"specPath\":\"tests/audit.spec.ts\",\"grep\":\"감사\",\"assignee\":\"나\"}";
        assertThat(status(patch("/api/projects/example.com/plan/items").content(row), member)).isEqualTo(204);

        var saved = planRows.findByProjectIdAndNodeTypeAndSpecPathAndGrepFilter("example.com", "TEST", "tests/audit.spec.ts", "감사").orElseThrow();
        assertThat(saved.getCreatedBy()).isEqualTo(memberId);
        assertThat(saved.getUpdatedBy()).isEqualTo(memberId);

        long adminId = call(get("/api/auth/me"), admin, 200).get("id").asLong();
        assertThat(status(patch("/api/projects/example.com/plan/items").content(row.replace("나", "관리자")), admin)).isEqualTo(204);
        saved = planRows.findById(saved.getId()).orElseThrow();
        assertThat(saved.getCreatedBy()).isEqualTo(memberId);
        assertThat(saved.getUpdatedBy()).isEqualTo(adminId);

        JsonNode project = call(put("/api/projects/example.com").content("{\"description\":\"감사 확인\"}"), member, 200);
        assertThat(project.get("updatedBy").asLong()).isEqualTo(memberId);
        assertThat(project.get("updatedByName").asText()).isEqualTo("팀원");
    }

    @Test
    void newProjectsGetASequentialIdUnrelatedToTheirName() throws Exception {
        String body = "{\"projectId\":\"shop\",\"projectName\":\"%s\",\"baseUrl\":\"https://shop.example.com\",\"scaffoldOnCreate\":false}";
        String first = call(post("/api/projects").content(body.formatted("쇼핑몰 결제")), admin, 200).get("projectId").asText();
        String second = call(post("/api/projects").content(body.formatted("shop")), admin, 200).get("projectId").asText();

        assertThat(first).matches("P\\d{4,}");
        assertThat(second).matches("P\\d{4,}");
        assertThat(Integer.parseInt(second.substring(1))).isEqualTo(Integer.parseInt(first.substring(1)) + 1);
        assertThat(projectIds(admin)).contains(first, second).doesNotContain("shop");
    }
}
