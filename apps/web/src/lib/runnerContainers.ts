import type { RunnerContainer } from '@/types';

type ContainerProject = Pick<RunnerContainer, 'projectId' | 'projectName' | 'knownProject' | 'containerType'>;

/** 컨테이너가 어느 프로젝트 것인지 — Runner 는 프로젝트 하나, AI-TestOps · DB 는 모든 프로젝트가 같이 쓴다 */
export function containerProjectLabel(c: ContainerProject): string {
  if (c.containerType === 'PLAYOPS' || c.containerType === 'DB') return '모든 프로젝트 (시스템)';
  if (c.knownProject) return `${c.projectName || c.projectId} (${c.projectId})`;
  return c.projectId ? `연결된 프로젝트 없음 (${c.projectId})` : '연결된 프로젝트 없음';
}

export function deleteConfirmMessage(containers: (ContainerProject & { name: string })[]): string {
  const lines = containers.map((c) => c.knownProject
    ? `· ${c.name} — ${containerProjectLabel(c)} 프로젝트와 연결되어 있습니다.`
    : `· ${c.name} — ${containerProjectLabel(c)}`);
  return `선택한 컨테이너 ${containers.length}개를 삭제합니다.\n\n${lines.join('\n')}\n\n`
    + '연결된 프로젝트는 다음 테스트 실행 때 Runner 를 새로 만듭니다. 그래도 지우시겠습니까?';
}
