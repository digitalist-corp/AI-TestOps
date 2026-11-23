/**
 * docs/design/chat-a2ui-contract.md 의 `ask_user` 예시를 바탕으로 만든 채팅 질문 화면 메시지.
 * CheckList · ChoiceList · TextInput 을 모두 담는다. 테스트에서만 쓴다.
 */
export const CHAT_SURFACE_ID = 'chat-21-call_1';

export function chatQuestionMessages({
  surfaceId = CHAT_SURFACE_ID,
  extraComponents = [],
}: { surfaceId?: string; extraComponents?: Record<string, unknown>[] } = {}): unknown[] {
  return [
    {
      version: '1.0',
      createSurface: {
        surfaceId,
        catalogId: 'https://playops.dev/a2ui/catalogs/chat/v1',
        dataModel: {
          items: [
            { id: 'login', title: '로그인 후 이름이 보인다', badge: '실패' },
            { id: 'cart', title: '장바구니에 담을 수 있다', detail: '어제부터 실패해요', badge: '실패' },
          ],
          selected: ['login'],
          browsers: [
            { id: 'chromium', title: '크롬' },
            { id: 'webkit', title: '사파리' },
          ],
          browser: 'chromium',
          memo: '',
        },
      },
    },
    {
      version: '1.0',
      updateComponents: {
        surfaceId,
        components: [
          { id: 'root', component: 'Column', children: ['intro', 'pick', 'browserPick', 'memoInput', 'ok', 'no', ...extraComponents.map((c) => c.id)] },
          { id: 'intro', component: 'Text', text: '어제 실패한 테스트 2개예요.', variant: 'muted' },
          { id: 'pick', component: 'CheckList', items: { '@path': '/items' }, value: { '@path': '/selected' } },
          { id: 'browserPick', component: 'ChoiceList', items: { '@path': '/browsers' }, value: { '@path': '/browser' } },
          { id: 'memoInput', component: 'TextInput', label: '메모', value: { '@path': '/memo' }, placeholder: '남길 말', multiline: true },
          {
            id: 'ok',
            component: 'Button',
            label: '다시 실행',
            variant: 'primary',
            action: {
              event: {
                name: 'submit',
                context: {
                  selected: { '@path': '/selected' },
                  browser: { '@path': '/browser' },
                  memo: { '@path': '/memo' },
                },
              },
            },
          },
          { id: 'no', component: 'Button', label: '그만두기', variant: 'outline', action: { event: { name: 'cancel', context: {} } } },
          ...extraComponents,
        ],
      },
    },
  ];
}
