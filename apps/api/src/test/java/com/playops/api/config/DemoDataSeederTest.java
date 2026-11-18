package com.playops.api.config;

import com.playops.api.dto.PlanDtos.ItemPatch;
import com.playops.api.dto.PlanDtos.PlanItem;
import com.playops.api.dto.PlanDtos.PlanResponse;
import com.playops.api.entity.Project;
import com.playops.api.repository.ProjectRepository;
import com.playops.api.repository.UserRepository;
import com.playops.api.service.PlanService;
import com.playops.api.service.PlaywrightTemplateService;
import com.playops.api.service.ProjectService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 시연 spec 갱신 (#142): 예전에 넣은 그대로일 때만 새 버전으로 바꾸고, 사람이 고친 파일은 둔다. */
class DemoDataSeederTest {

    @TempDir
    Path dir;

    private PlanService planService;
    private PlaywrightTemplateService templateService;
    private DemoDataSeeder seeder;

    @BeforeEach
    void setUp() {
        ProjectRepository projects = mock(ProjectRepository.class);
        when(projects.findById("example.com")).thenReturn(Optional.of(new Project()));
        ProjectService projectService = mock(ProjectService.class);
        when(projectService.getProjectPath("example.com")).thenReturn(dir);
        planService = mock(PlanService.class);
        when(planService.get("example.com")).thenReturn(new PlanResponse(List.of(
                new PlanItem("tests/demo.spec.ts", "시연 확인 문의하기 링크가 보인다", "문의하기 링크가 보인다", "시연 확인", 1,
                        true, true, null, null, null, null, null, null, null, null, null)), null));
        templateService = mock(PlaywrightTemplateService.class);
        seeder = new DemoDataSeeder(projects, projectService, templateService, planService, mock(UserRepository.class), "admin", "guest");
    }

    private Path demo() throws Exception {
        Path demo = dir.resolve("tests/demo.spec.ts");
        Files.createDirectories(demo.getParent());
        return demo;
    }

    @Test
    void oldSeededSpecIsReplacedAndPlanReseeded() throws Exception {
        Path demo = demo();
        Files.copy(getClass().getResourceAsStream("/demo/demo.spec.v1.ts"), demo);
        assertThat(DemoDataSeeder.sha256(demo)).isEqualTo(DemoDataSeeder.OLD_DEMO_SHA256);

        seeder.run();

        assertThat(Files.readString(demo)).contains("안내 링크가 보인다").doesNotContain("본문 제목이 보인다");
        verify(planService).patch(eq("example.com"), any(ItemPatch.class));
        verify(templateService, never()).scaffold(any(), any(), any(), org.mockito.ArgumentMatchers.anyBoolean());
    }

    @Test
    void specEditedByPeopleIsLeftAlone() throws Exception {
        Path demo = demo();
        Files.writeString(demo, "// 사람이 고친 시연 spec\n");

        seeder.run();

        assertThat(Files.readString(demo)).isEqualTo("// 사람이 고친 시연 spec\n");
        verify(planService, never()).patch(any(), any());
    }
}
