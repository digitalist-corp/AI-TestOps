import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { A2uiSurface } from './A2uiSurface';
import { CHAT_CATALOG_ID, ONBOARDING_CATALOG_ID } from './catalogs';
import { CHAT_SURFACE_ID, chatQuestionMessages } from './chatQuestionFixture';

afterEach(cleanup);

function buttonLayoutMessages(layout: { component: 'Row' | 'Column'; align?: 'start' | 'end' }, catalogId = CHAT_CATALOG_ID) {
  return [
    { version: '1.0', createSurface: { surfaceId: CHAT_SURFACE_ID, catalogId, dataModel: {} } },
    {
      version: '1.0',
      updateComponents: {
        surfaceId: CHAT_SURFACE_ID,
        components: [
          { id: 'root', ...layout, children: ['cancel', 'submit'] },
          { id: 'cancel', component: 'Button', label: '취소', action: { event: { name: 'cancel', context: {} } } },
          { id: 'submit', component: 'Button', label: '보내기', action: { event: { name: 'submit', context: {} } } },
        ],
      },
    },
  ];
}

describe('A2uiSurface — 채팅 질문 화면 (chat/v1)', () => {
  it.each([
    { align: undefined, justifyClass: 'justify-end' },
    { align: 'start' as const, justifyClass: 'justify-start' },
    { align: 'end' as const, justifyClass: 'justify-end' },
  ])('Row 는 줄바꿈과 간격을 적용하고 align=$align 에 맞춰 정렬한다', async ({ align, justifyClass }) => {
    render(<A2uiSurface messages={buttonLayoutMessages({ component: 'Row', align })} onAction={() => {}} />);

    const submit = await screen.findByRole('button', { name: '보내기' });
    const row = submit.closest('.flex-wrap');
    expect(row).toBeTruthy();
    expect(row?.contains(screen.getByRole('button', { name: '취소' }))).toBe(true);
    expect([...row!.classList]).toEqual(expect.arrayContaining(['flex', 'gap-1.5', justifyClass]));
    expect(row?.classList.contains('flex-col')).toBe(false);
    expect(submit.classList.contains('h-8')).toBe(true);
  });

  it('옛 질문의 버튼 전용 Column 을 가로로 펼쳐 오른쪽에 정렬한다', async () => {
    render(<A2uiSurface messages={buttonLayoutMessages({ component: 'Column' })} onAction={() => {}} />);

    const submit = await screen.findByRole('button', { name: '보내기' });
    const row = submit.closest('.flex-wrap');
    expect(row?.contains(screen.getByRole('button', { name: '취소' }))).toBe(true);
    expect(row?.classList.contains('justify-end')).toBe(true);
    expect(row?.classList.contains('flex-col')).toBe(false);
  });

  it('브리핑 카탈로그에서 Row 를 거부한다', async () => {
    render(<A2uiSurface messages={buttonLayoutMessages({ component: 'Row' }, ONBOARDING_CATALOG_ID)} onAction={() => {}} />);

    expect(await screen.findByText('정리한 내용을 보여 주지 못했어요.')).toBeTruthy();
  });

  it('CheckList · ChoiceList · TextInput 을 데이터 모델 값으로 그리고 라벨을 연결한다', async () => {
    render(<A2uiSurface messages={chatQuestionMessages()} onAction={() => {}} />);

    expect(await screen.findByText('어제 실패한 테스트 2개예요.')).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: /로그인 후 이름이 보인다/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: /장바구니/ }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText('어제부터 실패해요')).toBeTruthy();

    // 라디오는 한 그룹(같은 name)으로 묶여 화살표 키로 오갈 수 있다
    const chrome = screen.getByRole('radio', { name: '크롬' }) as HTMLInputElement;
    const safari = screen.getByRole('radio', { name: '사파리' }) as HTMLInputElement;
    expect(chrome.checked).toBe(true);
    expect(chrome.name).toBe(safari.name);
    expect(chrome.name).not.toBe('');

    // 라벨로 찾을 수 있는 여러 줄 입력
    const memo = screen.getByLabelText('메모') as HTMLTextAreaElement;
    expect(memo.tagName).toBe('TEXTAREA');
    expect(memo.placeholder).toBe('남길 말');
  });

  it('고른 값과 입력한 글이 양방향으로 묶여 submit 의 context 로 풀려 나간다', async () => {
    const onAction = vi.fn();
    render(<A2uiSurface messages={chatQuestionMessages()} onAction={onAction} />);

    const cart = (await screen.findByRole('checkbox', { name: /장바구니/ })) as HTMLInputElement;
    fireEvent.click(cart);
    await waitFor(() => expect(cart.checked).toBe(true));

    const safari = screen.getByRole('radio', { name: '사파리' }) as HTMLInputElement;
    fireEvent.click(safari);
    await waitFor(() => expect(safari.checked).toBe(true));
    expect((screen.getByRole('radio', { name: '크롬' }) as HTMLInputElement).checked).toBe(false);

    const memo = screen.getByLabelText('메모') as HTMLTextAreaElement;
    fireEvent.change(memo, { target: { value: '빨리요' } });
    await waitFor(() => expect(memo.value).toBe('빨리요'));

    fireEvent.click(screen.getByRole('button', { name: '다시 실행' }));
    await waitFor(() => expect(onAction).toHaveBeenCalledTimes(1));
    expect(onAction.mock.calls[0][0].action).toMatchObject({
      name: 'submit',
      surfaceId: CHAT_SURFACE_ID,
      sourceComponentId: 'ok',
      context: { selected: ['login', 'cart'], browser: 'webkit', memo: '빨리요' },
    });
  });

  it('CheckList 체크를 풀면 그 id 를 뺀 배열이 나간다', async () => {
    const onAction = vi.fn();
    render(<A2uiSurface messages={chatQuestionMessages()} onAction={onAction} />);

    const login = (await screen.findByRole('checkbox', { name: /로그인/ })) as HTMLInputElement;
    fireEvent.click(login);
    await waitFor(() => expect(login.checked).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '다시 실행' }));

    await waitFor(() => expect(onAction).toHaveBeenCalledTimes(1));
    expect(onAction.mock.calls[0][0].action.context.selected).toEqual([]);
  });

  it('chat/v1 에 없는 부품(브리핑 전용 ScreenList)이 오면 안내 한 줄로 바꾼다', async () => {
    render(
      <A2uiSurface
        messages={chatQuestionMessages({ extraComponents: [{ id: 'screens', component: 'ScreenList', items: [] }] })}
        onAction={() => {}}
        fallback="질문 화면을 보여 주지 못했어요."
      />
    );
    expect(await screen.findByText('질문 화면을 보여 주지 못했어요.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '다시 실행' })).toBeNull();
  });
});
