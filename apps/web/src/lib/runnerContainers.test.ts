import { describe, expect, it } from 'vitest';
import { containerProjectLabel, deleteConfirmMessage } from '@/lib/runnerContainers';

const base = { projectId: '', projectName: null, knownProject: false, containerType: 'RUNNER' };

describe('Runner 컨테이너 — 어느 프로젝트 것인지', () => {
  it('프로젝트 Runner 는 이름과 ID, 시스템 컨테이너는 모든 프로젝트, 주인 없는 Runner 는 없음으로 보인다', () => {
    expect(containerProjectLabel({ ...base, projectId: 'shop', projectName: '쇼핑몰', knownProject: true })).toBe('쇼핑몰 (shop)');
    expect(containerProjectLabel({ ...base, containerType: 'PLAYOPS' })).toBe('모든 프로젝트 (시스템)');
    expect(containerProjectLabel({ ...base, projectId: 'old' })).toBe('연결된 프로젝트 없음 (old)');
  });

  it('지우기 전 확인 문구에 컨테이너마다 연결된 프로젝트를 적는다', () => {
    const message = deleteConfirmMessage([
      { ...base, name: 'playops-runner-shop', projectId: 'shop', projectName: '쇼핑몰', knownProject: true },
      { ...base, name: 'playops-runner-old', projectId: 'old' },
    ]);
    expect(message).toBe(
      '선택한 컨테이너 2개를 삭제합니다.\n\n'
      + '· playops-runner-shop — 쇼핑몰 (shop) 프로젝트와 연결되어 있습니다.\n'
      + '· playops-runner-old — 연결된 프로젝트 없음 (old)\n\n'
      + '연결된 프로젝트는 다음 테스트 실행 때 Runner 를 새로 만듭니다. 그래도 지우시겠습니까?',
    );
  });
});
