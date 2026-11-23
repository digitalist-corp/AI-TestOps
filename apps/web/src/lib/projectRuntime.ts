import { api } from '@/api/client';
import type { Project } from '@/types';

export const SERVER_RUN_UNAVAILABLE_MESSAGE =
  "이 방식은 지금 테스트를 실행할 수 없어요. '일회용 러너'로 바꿔 주세요.";

function normalizeVersion(value: string) {
  return value.trim().replace(/^[~^]/, '').replace(/^v/i, '');
}

export function extractPlaywrightVersion(packageJson: string): string | null {
  try {
    const parsed = JSON.parse(packageJson) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    return parsed.devDependencies?.['@playwright/test']
      ?? parsed.dependencies?.['@playwright/test']
      ?? parsed.peerDependencies?.['@playwright/test']
      ?? null;
  } catch {
    return null;
  }
}

export function buildPlaywrightMismatchMessage(project: Project, sourceVersion: string | null) {
  if (!sourceVersion) return null;
  const configured = normalizeVersion(project.playwrightVersion);
  const source = normalizeVersion(sourceVersion);
  if (!configured || configured === source) return null;
  return `Playwright 버전 불일치: 프로젝트 설정 ${project.playwrightVersion}, package.json ${sourceVersion}`;
}

export async function getPlaywrightMismatchMessage(project: Project) {
  try {
    const packageJson = await api.readProjectFile(project.projectId, 'package.json');
    return buildPlaywrightMismatchMessage(project, extractPlaywrightVersion(packageJson.content));
  } catch {
    return null;
  }
}

export async function confirmPlaywrightVersion(project: Project, action: string) {
  const message = await getPlaywrightMismatchMessage(project);
  if (!message) return true;
  return window.confirm(`${message}\n\n${action}을 계속 진행하시겠습니까?`);
}
