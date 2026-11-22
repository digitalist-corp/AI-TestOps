package com.playops.api.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.playops.api.dto.AiJobResponse;
import com.playops.api.dto.PlanDtos.EntryPatch;
import com.playops.api.dto.PlanDtos.EntryRequest;
import com.playops.api.dto.PlanDtos.LinkSuggestion;
import com.playops.api.dto.PlanDtos.PlanItem;
import com.playops.api.entity.AiJob;
import com.playops.api.entity.PlanEntry;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.PlanEntryRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 계획 행 쓰기 (계획 우선 흐름): 만들기 · 고치기 · 지우기 · 테스트 연결 · AI 생성 · 연결 추천.
 * 연결 규칙(계획 칸 복사 · 자동 연결)은 PlanService 에 있다.
 */
@Service
public class PlanEntryService {

    private static final Logger log = LoggerFactory.getLogger(PlanEntryService.class);
    static final int MAX_BULK = 200;
    static final int MAX_GENERATE = 10;
    private static final int MAX_SCREEN = 500;
    private static final String FEATURE = "계획 연결 추천";
    private static final String SUGGEST_SYSTEM = """
            너는 테스트 계획 행과 이미 있는 Playwright 테스트를 짝짓는 도우미다.
            계획 행(plans)마다 같은 것을 확인하는 테스트(tests)가 있으면 짝을 고른다. 확실하지 않으면 고르지 않는다.
            계획 행 하나에 테스트 하나, 테스트 하나에 계획 행 하나만. 목록에 없는 planId · specPath · grep 은 쓰지 않는다.
            JSON 객체 하나만 출력한다 (설명 · 코드 블록 없이):
            {"suggestions":[{"planId":1,"specPath":"tests/a.spec.ts","grep":"테스트 grep","reason":"짝으로 본 이유 한국어 한 문장"}]}
            """;

    private final PlanService planService;
    private final PlanEntryRepository entryRepository;
    private final ProjectService projectService;
    private final AiJobService aiJobService;
    private final LlmGatewayService llmGatewayService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public PlanEntryService(PlanService planService, PlanEntryRepository entryRepository, ProjectService projectService,
                            AiJobService aiJobService, LlmGatewayService llmGatewayService) {
        this.planService = planService;
        this.entryRepository = entryRepository;
        this.projectService = projectService;
        this.aiJobService = aiJobService;
        this.llmGatewayService = llmGatewayService;
    }

    public PlanItem create(String projectId, EntryRequest request) {
        projectService.getProject(projectId);
        PlanEntry e = entryRepository.save(newEntry(projectId, request));
        return PlanService.unwrittenItem(e, null, Map.of(), null);
    }

    @Transactional
    public int createAll(String projectId, List<EntryRequest> requests) {
        if (requests == null || requests.isEmpty()) throw new ApiException(400, "VALIDATION_ERROR", "만들 계획 행이 없습니다.");
        if (requests.size() > MAX_BULK) {
            throw new ApiException(400, "VALIDATION_ERROR", "계획 행은 한 번에 " + MAX_BULK + "개까지 만들 수 있습니다.");
        }
        projectService.getProject(projectId);
        List<PlanEntry> entries = new ArrayList<>();
        for (EntryRequest r : requests) entries.add(newEntry(projectId, r));
        entryRepository.saveAll(entries);
        return entries.size();
    }

    private PlanEntry newEntry(String projectId, EntryRequest r) {
        if (r == null) throw new ApiException(400, "VALIDATION_ERROR", "계획 행이 비어 있습니다.");
        PlanEntry e = new PlanEntry();
        e.setProjectId(projectId);
        e.setTitle(PlanService.checkTitle(r.title()));
        e.setScreenRouteKey(checkScreen(r.screenRouteKey()));
        e.setExpected(PlanService.blankToNull(r.expected()));
        e.setPriority(PlanService.checkPriority(r.priority()));
        e.setDueDate(r.dueDate());
        if (r.assigneeUserId() != null) {
            e.setAssigneeUserId(r.assigneeUserId());
            e.setAssignee(planService.assigneeName(projectId, r.assigneeUserId()));
        }
        return e;
    }

    /**
     * title · enabled 는 null 이면 유지, 나머지는 보낸 값으로 덮어쓴다(null = 비움).
     * 작성됨(연결된) 행은 제목을 바꿀 수 없고(테스트 제목과 어긋나므로), 계획 칸은 케이스 행이 원본이라 무시한다.
     */
    public void update(String projectId, Long planId, EntryPatch patch) {
        PlanEntry e = planService.entry(projectId, planId);
        if (patch.title() != null) {
            String title = PlanService.checkTitle(patch.title());
            if (!title.equals(e.getTitle())) {
                if (e.isLinked()) {
                    throw new ApiException(400, "VALIDATION_ERROR", "테스트가 연결된 계획은 제목을 바꿀 수 없습니다. 연결을 끊고 바꾸세요.");
                }
                e.setTitle(title);
                e.setAutoLink(true); // 제목을 고쳤으면 그 제목의 테스트에 다시 자동으로 잇는다
            }
        }
        e.setScreenRouteKey(checkScreen(patch.screenRouteKey()));
        e.setExpected(PlanService.blankToNull(patch.expected()));
        if (!e.isLinked()) {
            String priority = PlanService.checkPriority(patch.priority());
            String assignee = patch.assigneeUserId() == null ? null : planService.assigneeName(projectId, patch.assigneeUserId());
            if (patch.enabled() != null) e.setEnabled(patch.enabled());
            e.setAssigneeUserId(patch.assigneeUserId());
            e.setAssignee(assignee);
            e.setDueDate(patch.dueDate());
            e.setPriority(priority);
        }
        entryRepository.save(e);
    }

    /** 계획 행만 지운다. 연결된 테스트 파일은 그대로 두고, 그 테스트는 계획 행 없는 항목으로 남는다. */
    public void delete(String projectId, Long planId) {
        entryRepository.delete(planService.entry(projectId, planId));
    }

    @Transactional
    public void link(String projectId, Long planId, String specPath, String grep) {
        PlanEntry e = planService.entry(projectId, planId);
        String path = PlanService.checkPath(specPath);
        if (grep == null || grep.isBlank()) throw new ApiException(400, "VALIDATION_ERROR", "연결할 테스트를 고르세요.");
        if (e.isLinked() && path.equals(e.getSpecPath()) && grep.equals(e.getGrepFilter())) return;
        boolean exists = planService.tracked(projectId).stream().map(PlanService.Tracked::item)
                .anyMatch(i -> !PlanService.unwritten(i) && i.specPath().equals(path) && i.grep().equals(grep));
        if (!exists) throw new ApiException(404, "NOT_FOUND", "연결할 테스트를 찾을 수 없습니다.");
        // tracked 가 자동 연결을 했을 수 있으니 다시 읽는다
        PlanEntry fresh = planService.entry(projectId, planId);
        if (fresh.isLinked() && path.equals(fresh.getSpecPath()) && grep.equals(fresh.getGrepFilter())) return;
        boolean taken = entryRepository.findByProjectIdOrderByIdAsc(projectId).stream()
                .anyMatch(o -> !o.getId().equals(planId) && path.equals(o.getSpecPath()) && grep.equals(o.getGrepFilter()));
        if (taken) throw new ApiException(409, "CONFLICT", "이 테스트는 이미 다른 계획에 연결되어 있습니다.");
        planService.link(projectId, fresh, path, grep);
    }

    public void unlink(String projectId, Long planId) {
        planService.unlink(projectId, planService.entry(projectId, planId));
    }

    // ── AI 생성 ──

    /** 미작성 계획 행 하나의 테스트를 AI 로 만든다. 기존 TEMPLATE_GENERATE 작업 — 사람이 검토 · 승인하면 파일로 반영되고 자동 연결된다. */
    public AiJobResponse generate(String projectId, Long planId, Long requestedBy) {
        PlanEntry e = generatable(projectId, planId);
        return AiJobResponse.from(startJob(projectId, e, requestedBy));
    }

    public List<AiJobResponse> generateAll(String projectId, List<Long> planIds, Long requestedBy) {
        if (planIds == null || planIds.isEmpty()) throw new ApiException(400, "VALIDATION_ERROR", "생성할 계획 행을 고르세요.");
        Set<Long> ids = new LinkedHashSet<>(planIds);
        if (ids.size() > MAX_GENERATE) {
            throw new ApiException(400, "VALIDATION_ERROR", "AI 생성은 한 번에 " + MAX_GENERATE + "개까지 할 수 있습니다.");
        }
        List<PlanEntry> entries = ids.stream().map(id -> generatable(projectId, id)).toList(); // 하나라도 안 되면 아무것도 시작하지 않는다
        return entries.stream().map(e -> AiJobResponse.from(startJob(projectId, e, requestedBy))).toList();
    }

    private PlanEntry generatable(String projectId, Long planId) {
        PlanEntry e = planService.entry(projectId, planId);
        if (e.isLinked()) throw new ApiException(409, "CONFLICT", "이미 테스트가 연결된 계획입니다: " + e.getTitle());
        return e;
    }

    private AiJob startJob(String projectId, PlanEntry e, Long requestedBy) {
        AiJob job = aiJobService.createTemplateGenerateJob(projectId, PlanService.planSpecPath(e.getId()), instruction(e),
                e.getScreenRouteKey() != null ? List.of(e.getScreenRouteKey()) : null, requestedBy);
        e.setAiJobId(job.getId());
        e.setAutoLink(true);
        entryRepository.save(e);
        return job;
    }

    static String instruction(PlanEntry e) {
        StringBuilder s = new StringBuilder("계획: ").append(e.getTitle()).append('\n');
        if (e.getExpected() != null && !e.getExpected().isBlank()) s.append("확인할 내용: ").append(e.getExpected().trim()).append('\n');
        s.append("test 하나만 작성하고, test 제목은 정확히 '").append(e.getTitle()).append("' 로 한다.");
        return s.toString();
    }

    // ── 연결 추천 ──

    /** 미연결 계획 행과 계획 행 없는 테스트를 LLM 에 주고 짝을 받는다. 자동 반영하지 않는다. 짝지을 것이 없으면 LLM 을 부르지 않는다. */
    public List<LinkSuggestion> suggest(String projectId) {
        List<PlanItem> items = planService.tracked(projectId).stream().map(PlanService.Tracked::item).toList();
        List<PlanItem> plans = items.stream().filter(PlanService::unwritten).toList();
        List<PlanItem> tests = items.stream().filter(i -> !PlanService.unwritten(i) && i.planId() == null).toList();
        if (plans.isEmpty() || tests.isEmpty()) return List.of();

        ObjectNode input = objectMapper.createObjectNode();
        ArrayNode planArray = input.putArray("plans");
        for (PlanItem p : plans) {
            ObjectNode n = planArray.addObject();
            n.put("planId", p.planId());
            n.put("title", p.title());
            if (p.expected() != null) n.put("expected", p.expected());
            if (p.screenRouteKey() != null) n.put("screen", p.screenRouteKey());
        }
        ArrayNode testArray = input.putArray("tests");
        for (PlanItem t : tests) {
            ObjectNode n = testArray.addObject();
            n.put("specPath", t.specPath());
            n.put("grep", t.grep());
            n.put("title", t.title());
            if (!t.describePath().isEmpty()) n.put("describePath", t.describePath());
        }
        String answer = llmGatewayService.chat(null, SUGGEST_SYSTEM, input.toString(), FEATURE, projectId);
        return parseSuggestions(answer, plans, tests);
    }

    /** 모델의 답에서 목록에 있는 짝만 남긴다. 읽을 수 없으면 빈 목록. 계획 행 · 테스트는 한 번씩만. */
    static List<LinkSuggestion> parseSuggestions(String answer, List<PlanItem> plans, List<PlanItem> tests) {
        JsonNode list;
        try {
            int start = answer == null ? -1 : answer.indexOf('{');
            int end = answer == null ? -1 : answer.lastIndexOf('}');
            if (start < 0 || end <= start) return List.of();
            list = new ObjectMapper().readTree(answer.substring(start, end + 1)).path("suggestions");
        } catch (Exception e) {
            log.warn("연결 추천 답을 읽을 수 없습니다: {}", e.getMessage());
            return List.of();
        }
        if (!list.isArray()) return List.of();
        Set<Long> planIds = new HashSet<>();
        plans.forEach(p -> planIds.add(p.planId()));
        Map<String, PlanItem> byKey = new HashMap<>();
        tests.forEach(t -> byKey.put(PlanService.key(t.specPath(), t.grep()), t));
        Set<Long> usedPlans = new HashSet<>();
        Set<String> usedTests = new HashSet<>();
        List<LinkSuggestion> out = new ArrayList<>();
        for (JsonNode s : list) {
            long planId = s.path("planId").asLong(-1); // 숫자든 "12" 같은 글자든
            String key = PlanService.key(s.path("specPath").asText(""), s.path("grep").asText(""));
            PlanItem test = byKey.get(key);
            if (!planIds.contains(planId) || test == null || usedPlans.contains(planId) || usedTests.contains(key)) continue;
            usedPlans.add(planId);
            usedTests.add(key);
            String reason = s.path("reason").asText("");
            out.add(new LinkSuggestion(planId, test.specPath(), test.grep(), test.title(), reason.isBlank() ? null : reason));
        }
        return out;
    }

    private static String checkScreen(String screen) {
        String s = PlanService.blankToNull(screen);
        if (s != null && s.length() > MAX_SCREEN) throw new ApiException(400, "VALIDATION_ERROR", "화면 키가 너무 깁니다.");
        return s;
    }
}
