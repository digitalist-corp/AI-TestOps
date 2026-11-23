/**
 * docs/design/onboarding-briefing-contract.md 의 고정 배치 · dataModel 그대로 만든 브리핑 메시지.
 * 테스트에서만 쓴다.
 */
const SURFACE_ID = 'onboarding-bt-1';

export function briefingMessages({ done = false }: { done?: boolean } = {}): unknown[] {
  const planChildren = done ? ['planDone'] : ['planHint', 'checkList', 'addButton'];
  const planComponents = done
    ? [{ id: 'planDone', component: 'Notice', tone: 'success', text: '2건을 계획에 넣었어요. 계획 탭에서 볼 수 있어요.' }]
    : [
        { id: 'planHint', component: 'Text', variant: 'muted', text: '고른 항목은 계획 탭에 할 일로 들어가요.' },
        { id: 'checkList', component: 'CheckList', items: { '@path': '/candidates' }, value: { '@path': '/selected' } },
        {
          id: 'addButton',
          component: 'Button',
          label: '계획에 넣기',
          variant: 'primary',
          action: { event: { name: 'add_to_plan', context: { selected: { '@path': '/selected' } } } },
        },
      ];

  return [
    {
      version: '1.0',
      createSurface: {
        surfaceId: SURFACE_ID,
        catalogId: 'https://playops.dev/a2ui/catalogs/onboarding/v1',
        dataModel: {
          summary: '화면 5개를 살펴봤어요. 로그인 화면과 상품 목록이 있는 쇼핑몰이에요.',
          resultNote: 'AI가 만든 테스트 3개가 모두 통과했어요.',
          screens: [
            { title: '첫 화면', path: '/', note: '검색창과 메뉴가 있어요' },
            { title: '상품 목록', path: '/products' },
          ],
          candidates: [
            {
              id: 'test-0',
              title: '로그인하면 내 이름이 보인다',
              detail: '아이디와 비밀번호를 넣고 들어가서 이름이 뜨는지 확인했어요',
              badge: '이미 만든 테스트',
            },
            {
              id: 'suggest-0',
              title: '상품을 장바구니에 담을 수 있다',
              detail: '구매 흐름의 첫 단계라 가장 자주 깨지는 곳이에요',
              badge: '추천 · 높음',
            },
          ],
          selected: ['test-0', 'suggest-0'],
          doneCount: done ? 2 : 0,
        },
      },
    },
    {
      version: '1.0',
      updateComponents: {
        surfaceId: SURFACE_ID,
        components: [
          { id: 'root', component: 'Column', children: ['intro', 'result', 'plan'] },
          {
            id: 'intro',
            component: 'Section',
            title: 'AI가 이 사이트를 살펴봤어요',
            children: ['summaryText', 'screenList', 'caution_0'],
          },
          { id: 'summaryText', component: 'Text', text: { '@path': '/summary' } },
          { id: 'screenList', component: 'ScreenList', items: { '@path': '/screens' } },
          { id: 'caution_0', component: 'Notice', tone: 'warning', text: '결제 화면은 로그인해야 들어갈 수 있어 살펴보지 못했어요.' },
          { id: 'result', component: 'Section', title: '첫 테스트 결과', children: ['resultNotice'] },
          { id: 'resultNotice', component: 'Notice', tone: 'success', text: { '@path': '/resultNote' } },
          { id: 'plan', component: 'Section', title: '계획에 넣을 항목을 골라 주세요', children: planChildren },
          ...planComponents,
        ],
      },
    },
  ];
}
