import { describe, expect, it } from 'vitest';
import { applyUiAnswer, summarizeUiAction } from './chatA2ui';
import { chatQuestionMessages } from '@/components/a2ui/chatQuestionFixture';

describe('summarizeUiAction', () => {
  it('버튼 라벨과 고른 항목 제목 · 라디오 제목 · 입력 라벨로 요약한다', () => {
    const summary = summarizeUiAction(chatQuestionMessages(), {
      name: 'submit',
      sourceComponentId: 'ok',
      context: { selected: ['login', 'cart'], browser: 'webkit', memo: ' 빨리요 ' },
    });
    expect(summary).toBe('다시 실행: 로그인 후 이름이 보인다, 장바구니에 담을 수 있다 · 사파리 · 메모: 빨리요');
  });

  it('아무것도 고르지 않으면 "선택 없음", 빈 입력은 "(비어 있음)"', () => {
    const summary = summarizeUiAction(chatQuestionMessages(), {
      name: 'submit',
      sourceComponentId: 'ok',
      context: { selected: [], browser: '', memo: '' },
    });
    expect(summary).toBe('다시 실행: 선택 없음 · 선택 없음 · 메모: (비어 있음)');
  });

  it('cancel 은 버튼 라벨만 쓴다', () => {
    expect(summarizeUiAction(chatQuestionMessages(), { name: 'cancel', sourceComponentId: 'no', context: {} })).toBe(
      '그만두기'
    );
  });
});

describe('applyUiAnswer', () => {
  it('보낸 context 를 submit 버튼이 묶은 경로에 되쓴다 (원본은 그대로)', () => {
    const original = chatQuestionMessages();
    const next = applyUiAnswer(original, {
      name: 'submit',
      context: { selected: ['cart'], browser: 'webkit', memo: '메모' },
    }) as { createSurface?: { dataModel: Record<string, unknown> } }[];

    expect(next[0].createSurface?.dataModel).toMatchObject({ selected: ['cart'], browser: 'webkit', memo: '메모' });
    expect((original[0] as typeof next[0]).createSurface?.dataModel.selected).toEqual(['login']);
  });

  it('묶인 경로가 없는 답(cancel)은 메시지를 바꾸지 않는다', () => {
    const original = chatQuestionMessages();
    expect(applyUiAnswer(original, { name: 'cancel', context: {} })).toBe(original);
  });
});
