package com.playops.api.service;

import com.playops.api.entity.Project;
import com.playops.api.entity.ScenarioCaseSetting;
import com.playops.api.repository.ScenarioCaseSettingRepository;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class PlaywrightScenarioServiceTest {

    @Test
    void enabledSpecPathsExcludesDisabledSpecFiles() {
        FileStorageService fileStorageService = mock(FileStorageService.class);
        ProjectService projectService = mock(ProjectService.class);
        ScenarioCaseSettingRepository repository = mock(ScenarioCaseSettingRepository.class);
        PlaywrightScenarioService service = new PlaywrightScenarioService(
                fileStorageService,
                projectService,
                repository
        );

        when(projectService.getProject("demo")).thenReturn(new Project());
        when(fileStorageService.listFiles("demo")).thenReturn(List.of(
                "tests/menu.spec.ts",
                "tests/disabled.spec.ts",
                "README.md"
        ));
        when(repository.findByProjectId("demo")).thenReturn(List.of(disabledSpec("tests/disabled.spec.ts")));

        assertThat(service.enabledSpecPaths("demo")).containsExactly("tests/menu.spec.ts");
    }

    @Test
    void disabledGrepPatternsIgnoreDisabledSpecsAndKeepDisabledCasesAndGroups() {
        FileStorageService fileStorageService = mock(FileStorageService.class);
        ProjectService projectService = mock(ProjectService.class);
        ScenarioCaseSettingRepository repository = mock(ScenarioCaseSettingRepository.class);
        PlaywrightScenarioService service = new PlaywrightScenarioService(
                fileStorageService,
                projectService,
                repository
        );

        ScenarioCaseSetting describe = disabledCase("tests/menu.spec.ts", "결제(카드)");
        describe.setNodeType("DESCRIBE");
        when(repository.findByProjectId("demo")).thenReturn(List.of(
                disabledSpec("tests/menu.spec.ts"),
                disabledCase("tests/menu.spec.ts", "menu smoke"),
                describe,
                disabledCase("tests/other.spec.ts", "other smoke")
        ));

        // JS 정규식 (#135): 케이스는 제목 끝까지, 묶음은 그 아래 전부
        assertThat(service.disabledGrepPatterns("demo", List.of("tests/menu.spec.ts")))
                .containsExactly("(?:^| )menu smoke(?: @\\S+)*$", "(?:^| )결제\\(카드\\)(?: |$)");
    }

    private ScenarioCaseSetting disabledSpec(String specPath) {
        ScenarioCaseSetting setting = new ScenarioCaseSetting();
        setting.setProjectId("demo");
        setting.setNodeType("SPEC");
        setting.setSpecPath(specPath);
        setting.setGrepFilter("");
        setting.setEnabled(false);
        return setting;
    }

    private ScenarioCaseSetting disabledCase(String specPath, String grep) {
        ScenarioCaseSetting setting = new ScenarioCaseSetting();
        setting.setProjectId("demo");
        setting.setNodeType("TEST");
        setting.setSpecPath(specPath);
        setting.setGrepFilter(grep);
        setting.setEnabled(false);
        return setting;
    }
}
