import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRail } from './AppRail';

afterEach(cleanup);

function labels(admin: boolean) {
  render(<MemoryRouter><AppRail admin={admin} /></MemoryRouter>);
  return screen.getByRole('navigation').textContent ?? '';
}

describe('AppRail', () => {
  it('관리자가 아니면 사용자 관리 · 러너 메뉴를 아예 보이지 않는다', () => {
    const text = labels(false);
    expect(text).not.toContain('사용자 관리');
    expect(text).not.toContain('Runner 컨테이너');
    expect(text).toContain('프로젝트 목록');
  });

  it('관리자는 사용자 관리 · 러너 메뉴를 본다', () => {
    const text = labels(true);
    expect(text).toContain('사용자 관리');
    expect(text).toContain('Runner 컨테이너');
  });
});
