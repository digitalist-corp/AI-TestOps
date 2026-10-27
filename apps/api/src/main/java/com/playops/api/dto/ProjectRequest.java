package com.playops.api.dto;

import com.playops.api.entity.PackageManager;
import com.playops.api.entity.ProjectServerType;
import com.playops.api.entity.RunnerLifecycle;

public record ProjectRequest(
        String projectId,
        String projectName,
        Integer displayOrder,
        ProjectServerType serverType,
        String description,
        String testPurpose,
        String managerName,
        String managerContact,
        String nodeVersion,
        String playwrightVersion,
        PackageManager packageManager,
        String installCommand,
        String testCommand,
        String workingDirectory,
        String envVariables,
        Boolean loginEnvRequired,
        // 로그인/설정 선행 시나리오. null이면 값 유지, ""(빈 문자열)이면 해제.
        String loginSetupSpecPath,
        Integer storageStateMaxAgeMinutes,
        Integer timeout,
        Integer parallelLimit,
        String baseUrl,
        RunnerLifecycle runnerLifecycle,
        Boolean dockerEnabled,
        String templateId,
        Boolean scaffoldOnCreate,
        String repositoryUrl,
        String repositoryBranch,
        // write-only: 응답으로는 절대 돌려주지 않는다. null이면 기존 토큰 유지, ""(빈 문자열)이면 연동 해제.
        String repositoryToken,
        // 구조 분석이 읽을 앱 소스 저장소. 등록할 때만 쓴다 (등록 직후 분석을 시작한다). 이후 변경은 구조 탭에서 한다.
        String sourceRepositoryUrl,
        String sourceRepositoryBranch,
        String sourceRepositoryToken
) {}
