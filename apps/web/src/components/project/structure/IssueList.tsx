import { KeyRound, Loader2, Play, Sparkles, TriangleAlert, Video, type LucideIcon } from 'lucide-react';
import type { CoverageAction } from '@/types';
import { Button } from '@/components/ui/Button';
import { ACTION_META, ISSUE_KIND_META, isBlockingIssue, issueActions, type IssueItem } from '@/lib/coverage';
import { cn } from '@/lib/utils';

export type IssueAction = Exclude<CoverageAction, 'NONE'>;
export type IssueActionHandler = (item: IssueItem, action: IssueAction) => void;

const ACTION_ICON: Record<IssueAction, LucideIcon> = {
  SET_LOGIN: KeyRound,
  RECORD_AGAIN: Video,
  FIX_WITH_AI: Sparkles,
  RERUN: Play,
};

/** 행동 버튼이 진행 중인지 가리는 열쇠 */
export function issueActionKey(item: IssueItem, action: IssueAction) {
  return `${item.routeKey}|${item.issue.kind}|${action}`;
}

/**
 * 막힌 곳 카드 목록. 화면 이름 · 쉬운 이유 · 추천 행동 버튼을 보여 주고,
 * 셀렉터 · 테스트 파일 같은 개발자 정보는 "자세히" 안에 접어 둔다.
 */
export function IssueList({ items, aiActive, onAction, busyKey, onSelect, emptyText = '막힌 곳이 없어요.' }: {
  items: IssueItem[];
  aiActive: boolean;
  onAction: IssueActionHandler;
  busyKey: string | null;
  /** 카드를 누르면 지도에서 그 화면으로 이동한다 */
  onSelect?: (routeKey: string) => void;
  emptyText?: string;
}) {
  if (items.length === 0) {
    return <p className="px-1 py-6 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }
  return (
    <ul className="space-y-2" aria-label="막힌 곳">
      {items.map((item, index) => {
        const { issue } = item;
        const actions = issueActions(issue, aiActive);
        const blocking = isBlockingIssue(issue);
        return (
          <li
            key={`${item.routeKey}-${index}`}
            className={cn('rounded-lg border bg-card p-3 shadow-sm', blocking ? 'border-destructive/35' : 'border-border')}
            data-testid="structure-issue-card"
            data-issue-route={item.routeKey}
          >
            <button
              type="button"
              disabled={!onSelect}
              onClick={() => onSelect?.(item.routeKey)}
              title={onSelect ? '지도에서 이 화면 보기' : undefined}
              className="flex w-full items-start gap-2 rounded-md text-left enabled:cursor-pointer enabled:hover:bg-accent/40"
            >
              <TriangleAlert className={cn('mt-0.5 h-4 w-4 shrink-0', blocking ? 'text-destructive' : 'text-warning')} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">{item.name}</span>
                <span className={cn('block text-xs font-medium', blocking ? 'text-destructive' : 'text-warning')}>
                  {ISSUE_KIND_META[issue.kind].title}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-foreground">{issue.message}</span>
              </span>
            </button>

            {actions.includes('SET_LOGIN') && (
              <p className="mt-2 pl-6 text-[11px] leading-relaxed text-muted-foreground">
                환경변수 창에서 <b className="font-semibold text-foreground">LOGIN_ID</b> 와{' '}
                <b className="font-semibold text-foreground">LOGIN_PASSWORD</b> 를 채우면 다음 탐색 · 실행부터 로그인해요.
              </p>
            )}

            {actions.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5 pl-6">
                {actions.map((action, i) => {
                  const Icon = ACTION_ICON[action];
                  const busy = busyKey === issueActionKey(item, action);
                  return (
                    <Button
                      key={action}
                      size="xs"
                      variant={i === 0 ? 'default' : 'outline'}
                      title={ACTION_META[action].hint}
                      disabled={busyKey != null}
                      onClick={() => onAction(item, action)}
                    >
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
                      {ACTION_META[action].label}
                    </Button>
                  );
                })}
              </div>
            )}

            {(issue.selector || issue.specPath || issue.at) && (
              <details className="mt-2 pl-6 text-[11px] text-muted-foreground">
                <summary className="cursor-pointer select-none hover:text-foreground">자세히</summary>
                <dl className="mt-1 grid grid-cols-[64px_minmax(0,1fr)] gap-x-2 gap-y-0.5">
                  {issue.selector && (
                    <>
                      <dt>셀렉터</dt>
                      <dd className="break-all font-mono text-foreground">{issue.selector}</dd>
                    </>
                  )}
                  {issue.specPath && (
                    <>
                      <dt>테스트 파일</dt>
                      <dd className="break-all font-mono text-foreground">{issue.specPath}</dd>
                    </>
                  )}
                  {issue.executionId != null && (
                    <>
                      <dt>실행</dt>
                      <dd className="text-foreground">#{issue.executionId}</dd>
                    </>
                  )}
                  {issue.at && (
                    <>
                      <dt>시각</dt>
                      <dd className="text-foreground">{new Date(issue.at).toLocaleString('ko-KR')}</dd>
                    </>
                  )}
                </dl>
              </details>
            )}
          </li>
        );
      })}
    </ul>
  );
}
