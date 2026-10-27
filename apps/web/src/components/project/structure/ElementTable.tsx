import type { SiteMapElement } from '@/types';
import { Badge } from '@/components/ui/Badge';

/** 화면 하나의 요소 목록. 목록 보기와 그래프의 상세 패널이 함께 쓴다. */
export function ElementTable({ elements, origin, stacked = false }: {
  elements: SiteMapElement[];
  origin: string;
  /** 좁은 패널에서는 배지 · 셀렉터 · 위치를 항상 세로로 쌓는다 */
  stacked?: boolean;
}) {
  if (elements.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {origin === 'SITE'
          ? '이 화면에서 상호작용할 수 있는 요소를 찾지 못했습니다.'
          : '코드에서 확인된 요소가 없습니다. 글자가 변수나 번역 함수로 만들어지는 화면은 요소를 뽑지 못합니다.'}
      </p>
    );
  }
  const row = stacked ? 'flex flex-col gap-1' : 'flex flex-col gap-0.5 @3xl:flex-row @3xl:items-center @3xl:gap-3';
  return (
    <ul className="space-y-1.5">
      {elements.map((element, index) => (
        <li key={index} className={row}>
          <span className="flex shrink-0 flex-wrap items-center gap-1.5">
            <Badge>{element.kind ?? '요소'}</Badge>
            {element.verification === 'OBSERVED' && (
              <Badge variant="info" title="실제 화면에서 이 요소 하나만 가리키는 것을 확인했습니다">
                실측
              </Badge>
            )}
            {element.verification === 'PASSED' && <Badge variant="success">확인됨</Badge>}
            {element.verification === 'FAILED' && <Badge variant="destructive">실패</Badge>}
            {element.duplicate && (
              <Badge variant="warning" title="같은 화면에 셀렉터가 같은 요소가 또 있습니다">
                겹침
              </Badge>
            )}
            {element.conditional && <Badge title="목록 반복이나 조건에 따라 보이는 요소입니다">조건부</Badge>}
          </span>
          <code className="min-w-0 break-all text-xs text-foreground">{element.selector ?? '셀렉터를 만들 수 없음'}</code>
          {element.file && (
            <span className={`shrink-0 font-mono text-[11px] text-muted-foreground ${stacked ? '' : '@3xl:ml-auto'}`}>
              {element.file.split('/').pop()}
              {element.line ? `:${element.line}` : ''}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
