package com.playops.api.config;

import com.playops.api.dto.PlanDtos.ItemPatch;
import com.playops.api.dto.PlanDtos.PlanItem;
import com.playops.api.entity.PlanEntry;
import com.playops.api.entity.Project;
import com.playops.api.entity.ProjectStatus;
import com.playops.api.entity.User;
import org.springframework.security.crypto.password.PasswordEncoder;
import com.playops.api.repository.ProjectMemberRepository;
import com.playops.api.entity.UserRole;
import com.playops.api.entity.ProjectRole;
import com.playops.api.entity.ProjectMember;
import com.playops.api.repository.PlanEntryRepository;
import com.playops.api.repository.ProjectRepository;
import com.playops.api.repository.UserRepository;
import com.playops.api.service.PlanService;
import com.playops.api.service.PlaywrightTemplateService;
import com.playops.api.service.ProjectService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.HexFormat;
import java.util.List;
import java.util.stream.Stream;

/**
 * 시연 프로젝트(example.com) 기본 데이터 (#87). 테스트 파일이 하나도 없을 때만 채운다 — 이미 쓰는 프로젝트는 건드리지 않는다.
 * - 기본 점검 템플릿(3건) + 시연 spec(통과 1 · 실제로 실패하는 1)
 * - 계획 칸: 담당자(게스트 · 관리자) · 마감일(하나는 기한 지남) · 우선순위
 * - 미작성 계획 행 3개 (계획 우선 흐름) — 계획 행이 하나도 없을 때만. 테스트 파일과 따로 채운다.
 * - 러너 켜기 (일회용). 결함은 실행 결과로 생기므로 배포 뒤 한 번 실행한다 (deploy-test.yml)
 * DataLoader(멤버 · 게스트) 다음에 돈다. 실패해도 서버 기동은 막지 않는다.
 * 시연 프로젝트의 spec 을 모두 지우면 다음 기동 때 다시 채운다 (시연용이라 의도된 동작).
 */
@Component
@Order(20)
public class DemoDataSeeder implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(DemoDataSeeder.class);
    static final String PROJECT = "example.com";
    static final String FAILING = "문의하기 링크가 보인다";
    /**
     * 예전에 넣은 시연 spec (#87 첫 버전, '본문 제목이 보인다' — example.com 에서 제목이 사라져 실패, #142)의 SHA-256.
     * 내용이 이것과 같을 때만 새 버전으로 바꾼다 — 사람이 고친 파일은 건드리지 않는다.
     */
    static final String OLD_DEMO_SHA256 = "6cbfd2b48a358dd057d2dfe91b7390b77088c30bbef2faccdd0b3dc1b2615999";

    private final ProjectRepository projectRepository;
    private final ProjectService projectService;
    private final PlaywrightTemplateService templateService;
    private final PlanService planService;
    private final UserRepository userRepository;
    private final ProjectMemberRepository memberRepository;
    private final PlanEntryRepository entryRepository;
    private final PasswordEncoder passwordEncoder;
    private final String loginUsername;
    private final String guestUsername;
    private final String demoPmUsername;
    private final String demoPmPassword;

    public DemoDataSeeder(ProjectRepository projectRepository, ProjectService projectService,
                          PlaywrightTemplateService templateService, PlanService planService,
                          UserRepository userRepository, ProjectMemberRepository memberRepository,
                          PlanEntryRepository entryRepository, PasswordEncoder passwordEncoder,
                          @Value("${LOGIN_USERNAME:admin}") String loginUsername,
                          @Value("${GUEST_USERNAME:guest}") String guestUsername,
                          @Value("${DEMO_PM_USERNAME:demo-pm}") String demoPmUsername,
                          @Value("${DEMO_PM_PASSWORD:}") String demoPmPassword) {
        this.projectRepository = projectRepository;
        this.projectService = projectService;
        this.templateService = templateService;
        this.planService = planService;
        this.userRepository = userRepository;
        this.memberRepository = memberRepository;
        this.entryRepository = entryRepository;
        this.passwordEncoder = passwordEncoder;
        this.loginUsername = loginUsername;
        this.guestUsername = guestUsername;
        this.demoPmUsername = demoPmUsername;
        this.demoPmPassword = demoPmPassword;
    }

    @Override
    public void run(String... args) {
        try {
            Project project = projectRepository.findById(PROJECT).orElse(null);
            if (project == null) return;
            // 시연 PM 은 시연 파일과 따로 — 한쪽이 실패해도 다른 쪽은 채운다
            try {
                seedDemoPm();
            } catch (RuntimeException e) {
                log.warn("시연 PM 계정을 준비하지 못했습니다: {}", e.getMessage());
            }
            try {
                seedPlanEntries();
            } catch (RuntimeException e) {
                log.warn("시연 계획 행을 채우지 못했습니다: {}", e.getMessage());
            }
            Path dir = projectService.getProjectPath(PROJECT);
            Path demo = dir.resolve("tests/demo.spec.ts");
            if (Files.isRegularFile(demo) && OLD_DEMO_SHA256.equals(sha256(demo))) {
                copyDemoSpec(demo);
                seedPlan();
                log.info("시연 프로젝트 {} 의 시연 spec 을 새 버전으로 바꿨습니다.", PROJECT);
                return;
            }
            if (hasSpecFiles(dir)) return;
            templateService.scaffold(dir, project, "default", false);
            copyDemoSpec(demo);
            project.setDockerEnabled(true);
            project.setStatus(ProjectStatus.RUNNING); // 시연은 진행 중인 프로젝트로 보인다 (3-1)
            projectRepository.save(project);
            seedPlan();
            log.info("시연 프로젝트 {} 기본 데이터를 채웠습니다.", PROJECT);
        } catch (IOException | RuntimeException e) {
            log.warn("시연 프로젝트 기본 데이터를 채우지 못했습니다: {}", e.getMessage());
        }
    }

    static final String DEMO_PM_NAME = "시연 PM";

    /**
     * 시연용 PM 계정 (3차 5번). 시연은 계정 전환 없이 이 계정 하나로 한다. 비밀번호는 .env(DEMO_PM_PASSWORD)로만 받고, 비면 만들지 않는다.
     * .env 의 값이 바뀌면 다음 기동에 반영한다. 같은 아이디의 다른 사람 계정(표시 이름이 '시연 PM'이 아님)은 건드리지 않는다.
     */
    private void seedDemoPm() {
        if (demoPmPassword == null || demoPmPassword.isBlank() || demoPmUsername.isBlank()) return;
        User user = userRepository.findByUsername(demoPmUsername).orElse(null);
        if (user == null) {
            user = new User();
            user.setUsername(demoPmUsername);
            user.setDisplayName(DEMO_PM_NAME);
            user.setRole(UserRole.USER);
            user.setPassword(passwordEncoder.encode(demoPmPassword));
            user = userRepository.save(user);
        } else if (!DEMO_PM_NAME.equals(user.getDisplayName())) {
            log.warn("아이디 {} 는 다른 사람 계정이라 시연 PM 으로 쓰지 않습니다. DEMO_PM_USERNAME 을 바꾸세요.", demoPmUsername);
            return;
        } else if (!passwordEncoder.matches(demoPmPassword, user.getPassword())) {
            user.setPassword(passwordEncoder.encode(demoPmPassword));
            userRepository.save(user);
        }
        Long id = user.getId();
        if (memberRepository.findByProjectIdAndUserId(PROJECT, id).isEmpty()) {
            memberRepository.save(ProjectMember.of(PROJECT, id, ProjectRole.PM, null));
        }
    }

    /** 실패할 케이스는 게스트(팀원) · 높음 · 어제 마감(기한 지남), 나머지는 게스트 · 관리자 번갈아 · 다음 주까지. */
    private void seedPlan() {
        Long guest = userRepository.findByUsername(guestUsername).map(User::getId).orElse(null);
        Long admin = userRepository.findByUsername(loginUsername).map(User::getId).orElse(null);
        LocalDate today = LocalDate.now(ZoneId.of("Asia/Seoul"));
        List<PlanItem> items = planService.get(PROJECT).items().stream().filter(i -> !PlanService.unwritten(i)).toList();
        String[] priorities = {"MEDIUM", "LOW", "MEDIUM", "HIGH"};
        int n = 0;
        for (PlanItem item : items) {
            boolean failing = FAILING.equals(item.title());
            Long owner = failing || n % 2 == 0 ? (guest != null ? guest : admin) : admin;
            planService.patch(PROJECT, new ItemPatch(item.specPath(), item.grep(), null, null,
                    failing ? today.minusDays(1) : today.plusDays(2L + n),
                    failing ? "HIGH" : priorities[n % priorities.length], owner));
            if (!failing) n++;
        }
    }

    /** 시연 계획 행: 제목 · 확인할 내용 (모두 example.com 에서 실제로 확인할 수 있는 것). 기존 테스트 제목과 겹치지 않아 미작성으로 보인다. */
    static final List<String[]> PLAN_ENTRIES = List.of(
            new String[] {"첫 화면 제목이 보인다", "첫 화면 맨 위에 'Example Domain' 제목이 보인다."},
            new String[] {"안내 페이지가 열린다", "첫 화면의 'Learn more' 링크를 누르면 IANA 안내 페이지로 이동하고, 주소에 iana.org 가 들어 있다."},
            new String[] {"첫 화면 설명 문구가 보인다", "제목 아래에 이 도메인이 문서 예시용이라는 설명 문단이 보인다."});

    /** 계획 행이 하나도 없을 때만 미작성 계획 3개를 넣는다 (PM 이 계획을 먼저 세운 모습). 담당자 · 마감일을 채워 계획 표 칸이 비지 않게 한다. */
    private void seedPlanEntries() {
        if (!entryRepository.findByProjectIdOrderByIdAsc(PROJECT).isEmpty()) return;
        User guest = userRepository.findByUsername(guestUsername).orElse(null);
        User admin = userRepository.findByUsername(loginUsername).orElse(null);
        LocalDate today = LocalDate.now(ZoneId.of("Asia/Seoul"));
        String[] priorities = {"HIGH", "MEDIUM", "LOW"};
        List<PlanEntry> entries = new java.util.ArrayList<>();
        for (int i = 0; i < PLAN_ENTRIES.size(); i++) {
            User owner = i % 2 == 0 && guest != null ? guest : admin;
            PlanEntry e = new PlanEntry();
            e.setProjectId(PROJECT);
            e.setTitle(PLAN_ENTRIES.get(i)[0]);
            e.setExpected(PLAN_ENTRIES.get(i)[1]);
            e.setScreenRouteKey("/");
            e.setPriority(priorities[i]);
            e.setDueDate(today.plusDays(3L + i));
            if (owner != null) {
                e.setAssigneeUserId(owner.getId());
                e.setAssignee(owner.getDisplayName() != null && !owner.getDisplayName().isBlank()
                        ? owner.getDisplayName() : owner.getUsername());
            }
            entries.add(e);
        }
        entryRepository.saveAll(entries);
        log.info("시연 프로젝트 {} 에 미작성 계획 {}개를 넣었습니다.", PROJECT, entries.size());
    }

    private void copyDemoSpec(Path target) throws IOException {
        try (InputStream in = getClass().getResourceAsStream("/demo/example.com/demo.spec.ts")) {
            Files.createDirectories(target.getParent());
            Files.copy(in, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    static String sha256(Path file) throws IOException {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(file)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    static boolean hasSpecFiles(Path dir) throws IOException {
        if (!Files.isDirectory(dir)) return false;
        try (Stream<Path> files = Files.walk(dir)) {
            return files.filter(p -> !p.toString().contains("node_modules"))
                    .anyMatch(p -> p.getFileName().toString().matches(".*\\.(spec|test)\\.[jt]sx?$"));
        }
    }
}
