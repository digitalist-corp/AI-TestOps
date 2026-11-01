import type { SiteMapElement } from '@/types';
import { Badge } from '@/components/ui/Badge';
import { ELEMENT_STATE_META, elementKindLabel, elementName } from '@/lib/coverage';
import { cn } from '@/lib/utils';

/** 상태 순서: 실패를 맨 위에, 그다음 통과 · 확인됨 · 안 봄 */
const ORDER: Record<SiteMapElement['verification'], number> = { FAILED: 0, PASSED: 1, OBSERVED: 2, UNVERIFIED: 3 };

/**
 * 화면 하나의 요소 목록. 목록 보기와 그래프의 상세 패널이 함께 쓴다.
 * 기본으로는 상태 칩 · 종류 · 이름만 쉬운 말로 보이고, 셀렉터 · 코드 위치는 "자세히" 안에 접어 둔다.
 */
export function ElementTable({ elements, origin, stacked = false }: {
  elements: SiteMapElement[];
  origin: string;
  /** 좁은 패널에서는 한 줄을 더 촘촘하게 쓴다 */
  stacked?: boolean;
}) {
  if (elements.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {origin === 'SITE'
          ? '이 화면에서 누르거나 입력할 수 있는 요소를 찾지 못했어요.'
          : '코드에서 찾은 요소가 없어요. 글자가 변수나 번역 함수로 만들어지는 화면은 요소를 뽑지 못해요.'}
      </p>
    );
  }
  const sorted = elements
    .map((element, index) => ({ element, index }))
    .sort((a, b) => ORDER[a.element.verification] - ORDER[b.element.verification] || a.index - b.index);

  return (
    <ul className="space-y-1">
      {sorted.map(({ element, index }) => {
        const meta = ELEMENT_STATE_META[element.verification];
        const hasDetail = element.selector || element.file || element.duplicate || element.conditional;
        return (
          <li key={index} className={cn('rounded-md border border-border bg-background', stacked ? 'px-2.5 py-1.5' : 'px-3 py-2')}>
            <div className="flex min-w-0 items-center gap-2">
              <Badge variant={meta.tone} className="shrink-0 px-1.5 py-0 text-[11px]" title={meta.hint}>
                {meta.label}
              </Badge>
              <span className="shrink-0 text-[11px] text-muted-foreground">{elementKindLabel(element.kind)}</span>
              <span className="min-w-0 truncate text-[13px] text-foreground" title={elementName(element)}>
                {elementName(element)}
              </span>
            </div>
            {hasDetail && (
              <details className="mt-1 text-[11px] text-muted-foreground">
                <summary className="cursor-pointer select-none hover:text-foreground">자세히</summary>
                <div className="mt-1 space-y-0.5 pl-3">
                  <p>
                    <span className="mr-1.5">셀렉터</span>
                    <code className="break-all text-foreground">{element.selector ?? '만들 수 없음'}</code>
                  </p>
                  {element.file && (
                    <p>
                      <span className="mr-1.5">코드 위치</span>
                      <span className="font-mono text-foreground">
                        {element.file.split('/').pop()}
                        {element.line ? `:${element.line}` : ''}
                      </span>
                    </p>
                  )}
                  {element.duplicate && <p className="text-warning">같은 화면에 똑같이 가리키는 요소가 또 있어요.</p>}
                  {element.conditional && <p>목록 반복이나 조건에 따라 보이는 요소예요.</p>}
                </div>
              </details>
            )}
          </li>
        );
      })}
    </ul>
  );
}
