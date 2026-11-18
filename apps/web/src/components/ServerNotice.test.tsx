import { describe, expect, it } from 'vitest';
import { isLiveServer } from './ServerNotice';

describe('운영 메시지 (#87)', () => {
  it('배포 주소에서만 보이고 로컬 개발 화면에서는 숨긴다', () => {
    expect(isLiveServer('abc-def.trycloudflare.com')).toBe(true);
    expect(isLiveServer('10.0.0.5')).toBe(true);
    expect(isLiveServer('localhost')).toBe(false);
    expect(isLiveServer('127.0.0.1')).toBe(false);
    expect(isLiveServer('host.docker.internal')).toBe(false);
  });
});
