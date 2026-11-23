import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { A2uiSurface } from './A2uiSurface';
import { briefingMessages } from './briefingFixture';

afterEach(cleanup);

describe('A2uiSurface — 첫 실행 브리핑 (onboarding/v1)', () => {
  it('섹션 제목 · 살펴본 화면 · 후보와 배지를 보여 준다', async () => {
    render(<A2uiSurface messages={briefingMessages()} onAction={() => {}} />);

    expect(await screen.findByText('AI가 이 사이트를 살펴봤어요')).toBeTruthy();
    expect(screen.getByText('첫 테스트 결과')).toBeTruthy();
    expect(screen.getByText('계획에 넣을 항목을 골라 주세요')).toBeTruthy();
    // @path 바인딩
    expect(screen.getByText(/화면 5개를 살펴봤어요/)).toBeTruthy();
    expect(screen.getByText('AI가 만든 테스트 3개가 모두 통과했어요.')).toBeTruthy();
    // 화면 목록
    expect(screen.getByText('첫 화면')).toBeTruthy();
    expect(screen.getByText('/products')).toBeTruthy();
    expect(screen.getByText('검색창과 메뉴가 있어요')).toBeTruthy();
    // 후보 · 배지, 기본 선택
    expect(screen.getByText('이미 만든 테스트')).toBeTruthy();
    expect(screen.getByRole('button', { name: '계획에 넣기' }).classList.contains('h-10')).toBe(true);
    expect(screen.getByText('추천 · 높음')).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: /로그인하면 내 이름이 보인다/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: /장바구니/ }) as HTMLInputElement).checked).toBe(true);
  });

  it('체크를 해제하고 버튼을 누르면 그 id 를 뺀 실제 배열을 action 으로 보낸다', async () => {
    const onAction = vi.fn();
    render(<A2uiSurface messages={briefingMessages()} onAction={onAction} />);

    const suggest = (await screen.findByRole('checkbox', { name: /장바구니/ })) as HTMLInputElement;
    fireEvent.click(suggest);
    await waitFor(() => expect(suggest.checked).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '계획에 넣기' }));

    await waitFor(() => expect(onAction).toHaveBeenCalledTimes(1));
    const message = onAction.mock.calls[0][0];
    expect(message).toMatchObject({
      version: '1.0',
      action: {
        name: 'add_to_plan',
        surfaceId: 'onboarding-bt-1',
        sourceComponentId: 'addButton',
        context: { selected: ['test-0'] },
      },
    });
    expect(typeof message.action.timestamp).toBe('string');
  });

  it('서버가 planDone 으로 바꾼 메시지를 주면 다시 그려 성공 안내를 보여 준다', async () => {
    const { rerender } = render(<A2uiSurface messages={briefingMessages()} onAction={() => {}} />);
    expect(await screen.findByRole('button', { name: '계획에 넣기' })).toBeTruthy();

    rerender(<A2uiSurface messages={briefingMessages({ done: true })} onAction={() => {}} />);

    expect(await screen.findByText('2건을 계획에 넣었어요. 계획 탭에서 볼 수 있어요.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '계획에 넣기' })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
