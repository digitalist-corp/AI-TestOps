package com.playops.api.config;

import com.playops.api.dto.PlanDtos.ItemPatch;
import com.playops.api.dto.PlanDtos.PlanItem;
import com.playops.api.entity.Project;
import com.playops.api.entity.User;
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
    private final String loginUsername;
    private final String guestUsername;

    public DemoDataSeeder(ProjectRepository projectRepository, ProjectService projectService,
                          PlaywrightTemplateService templateService, PlanService planService,
                          UserRepository userRepository,
                          @Value("${LOGIN_USERNAME:admin}") String loginUsername,
                          @Value("${GUEST_USERNAME:guest}") String guestUsername) {
        this.projectRepository = projectRepository;
        this.projectService = projectService;
        this.templateService = templateService;
        this.planService = planService;
        this.userRepository = userRepository;
        this.loginUsername = loginUsername;
        this.guestUsername = guestUsername;
    }

    @Override
    public void run(String... args) {
        try {
            Project project = projectRepository.findById(PROJECT).orElse(null);
            if (project == null) return;
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
            projectRepository.save(project);
            seedPlan();
            log.info("시연 프로젝트 {} 기본 데이터를 채웠습니다.", PROJECT);
        } catch (IOException | RuntimeException e) {
            log.warn("시연 프로젝트 기본 데이터를 채우지 못했습니다: {}", e.getMessage());
        }
    }

    /** 실패할 케이스는 게스트(팀원) · 높음 · 어제 마감(기한 지남), 나머지는 게스트 · 관리자 번갈아 · 다음 주까지. */
    private void seedPlan() {
        Long guest = userRepository.findByUsername(guestUsername).map(User::getId).orElse(null);
        Long admin = userRepository.findByUsername(loginUsername).map(User::getId).orElse(null);
        LocalDate today = LocalDate.now(ZoneId.of("Asia/Seoul"));
        List<PlanItem> items = planService.get(PROJECT).items();
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
