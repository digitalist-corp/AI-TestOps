import { useEffect, useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { api } from '@/api/client';
import type { Defect, DefectFilter, DefectResponse, DefectStatus, ProjectMember, RunTestOptions, SiteMapNode, TestSuite } from '@/types';
import { Button } from '@/components/ui/Button';
import { screenName } from '@/lib/coverage';
import { assigneeLabel, planKey, rerunOptions } from '@/lib/plan';
import { cn, formatRelative } from '@/lib/utils';

const selectClass = 'h-9 rounded-sm border border-border bg-card px-3 text-sm text-foreground hover:border-border-strong';

/** 결함을 누르면 가는 실행: 마지막으로 실패한 실행 */
const lastFailedOf = (d: Defect) => [...d.runs].reverse().find((r) => r.status === 'FAILED')?.executionId ?? d.lastExecutionId;

/**
 * 통합 결함 리스트(F-4, #81). 결함 = 사용 중 계획 항목의 실패. 미해결 수는 첫 화면 · 대시보드와 같은 API(필터 없음)의 open 이다.
 * 골라서 다시 실행하면 기존 실행 경로(handleRun)를 쓴다.
 */
export function DefectsTab({
  projectId,
  refreshKey,
  runDisabled = false,
  onRun,
  onOpenExecution,
}: {
  projectId: string;
  /** 실행이 생기거나 끝날 때 바뀌는 값. 바뀌면 다시 읽는다. */
  refreshKey: string;
  runDisabled?: boolean;
  onRun: (options: RunTestOptions) => void;
  onOpenExecution: (executionId: number) => void;
}) {
  const [filter, setFilter] = useState<DefectFilter>({ status: 'OPEN' });
  const [data, setData] = useState<DefectResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [suites, setSuites] = useState<TestSuite[]>([]);
  const [nodes, setNodes] = useState<SiteMapNode[]>([]);

  useEffect(() => {
    let alive = true;
    api.members.list(projectId).then((list) => alive && setMembers(list)).catch(() => {});
    api.testSuites.listByProject(projectId).then((list) => alive && setSuites(list)).catch(() => {});
    api.getSiteMap(projectId).then((m) => alive && setNodes(m.nodes.filter((n) => !n.stale && !n.excluded))).catch(() => {});
    return () => {
      alive = false;
    };
  }, [projectId]);

  useEffect(() => {
    let alive = true;
    setError(null);
    api.defects
      .list(projectId, filter)
      .then((res) => {
        if (!alive) return;
        setData(res);
        // 목록에서 사라진 결함은 체크도 푼다.
        const keys = new Set(res.defects.map((d) => planKey(d.specPath, d.grep)));
        setChecked((prev) => new Set([...prev].filter((k) => keys.has(k))));
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : '결함 목록을 불러오지 못했어요.'));
    return () => {
      alive = false;
    };
  }, [projectId, filter, refreshKey]);

  const defects = data?.defects ?? [];
  const nameOf = (routeKey: string) => screenName(nodes.find((n) => n.routeKey === routeKey), routeKey);
  const picked = defects.filter((d) => checked.has(planKey(d.specPath, d.grep)));
  const allChecked = defects.length > 0 && picked.length === defects.length;

  const toggle = (key: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const set = (patch: Partial<DefectFilter>) => setFilter((f) => ({ ...f, ...patch }));

  const rerun = () => {
    const options = rerunOptions(picked);
    if (!options) return;
    if (!window.confirm(`고른 결함 ${picked.length}건을 다시 실행할까요?`)) return;
    onRun(options);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-medium text-foreground">결함</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            계획 항목의 최근 실행이 실패면 미해결, 그 뒤 실행에서 성공하면 해결로 바뀌어요.
          </p>
        </div>
        <Button size="sm" disabled={picked.length === 0 || runDisabled} onClick={rerun}>
          <RotateCcw className="h-4 w-4" />
          고른 {picked.length}건 다시 실행
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          aria-label="상태"
          className={selectClass}
          value={filter.status ?? ''}
          onChange={(e) => set({ status: (e.target.value || undefined) as DefectStatus | undefined })}
        >
          <option value="OPEN">상태: 미해결</option>
          <option value="RESOLVED">상태: 해결</option>
          <option value="">상태: 전체</option>
        </select>
        <select
          aria-label="화면"
          className={selectClass}
          value={filter.screen ?? ''}
          onChange={(e) => set({ screen: e.target.value || undefined })}
        >
          <option value="">화면: 전체</option>
          {nodes.map((n) => (
            <option key={n.routeKey} value={n.routeKey}>
              화면: {nameOf(n.routeKey)}
            </option>
          ))}
        </select>
        <select
          aria-label="담당자"
          className={selectClass}
          value={filter.assigneeUserId ?? ''}
          onChange={(e) => set({ assigneeUserId: e.target.value ? Number(e.target.value) : undefined })}
        >
          <option value="">담당자: 전체</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              담당자: {m.displayName || m.username}
            </option>
          ))}
        </select>
        {suites.length > 0 && (
          <select
            aria-label="스위트"
            className={selectClass}
            value={filter.suiteId ?? ''}
            onChange={(e) => set({ suiteId: e.target.value ? Number(e.target.value) : undefined })}
          >
            <option value="">스위트: 전체</option>
            {suites.map((s) => (
              <option key={s.id} value={s.id}>
                스위트: {s.name}
              </option>
            ))}
          </select>
        )}
        {data && (
          <span className="text-sm text-muted-foreground">
            미해결 {data.open} · 해결 {data.resolved}
          </span>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!data && !error ? (
        <div className="flex min-h-[160px] items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : defects.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          {filter.status === 'OPEN' ? '미해결 결함이 없어요.' : '조건에 맞는 결함이 없어요.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="모두 고르기"
                    checked={allChecked}
                    onChange={() => setChecked(allChecked ? new Set() : new Set(defects.map((d) => planKey(d.specPath, d.grep))))}
                  />
                </th>
                <th className="px-3 py-2 font-medium">케이스</th>
                <th className="px-3 py-2 font-medium">상태</th>
                <th className="px-3 py-2 font-medium">화면</th>
                <th className="px-3 py-2 font-medium">담당자</th>
                <th className="px-3 py-2 text-right font-medium">실패</th>
                <th className="px-3 py-2 font-medium">처음 발견</th>
                <th className="px-3 py-2 font-medium">마지막 실행</th>
                <th className="px-3 py-2 font-medium">오류</th>
              </tr>
            </thead>
            <tbody>
              {defects.map((d) => {
                const key = planKey(d.specPath, d.grep);
                return (
                  <tr key={key} className="border-b border-border last:border-0 align-top">
                    <td className="px-3 py-2">
                      <input type="checkbox" aria-label={`${d.title} 고르기`} checked={checked.has(key)} onChange={() => toggle(key)} />
                    </td>
                    <td className="max-w-[280px] px-3 py-2">
                      <button
                        type="button"
                        className="text-left font-medium text-foreground hover:underline"
                        title="실패한 실행 결과 보기"
                        onClick={() => onOpenExecution(lastFailedOf(d))}
                      >
                        {d.title}
                      </button>
                      <p className="truncate text-xs text-muted-foreground" title={d.specPath}>
                        {[d.describePath, d.specPath].filter(Boolean).join(' · ')}
                      </p>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          'rounded px-2 py-0.5 text-xs font-medium',
                          d.status === 'OPEN' ? 'bg-destructive/10 text-destructive' : 'bg-success/10 text-success',
                        )}
                      >
                        {d.status === 'OPEN' ? '미해결' : '해결'}
                      </span>
                    </td>
                    <td className="max-w-[160px] truncate px-3 py-2 text-foreground" title={d.routeKeys.map(nameOf).join(', ')}>
                      {d.routeKeys.length === 0
                        ? '미지정'
                        : d.routeKeys.length > 1
                          ? `${nameOf(d.routeKeys[0])} 외 ${d.routeKeys.length - 1}`
                          : nameOf(d.routeKeys[0])}
                    </td>
                    <td className="px-3 py-2 text-foreground">{assigneeLabel(d) || '미지정'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-destructive">{d.failCount}회</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <ExecutionLink id={d.firstFailedExecutionId} onOpen={onOpenExecution} />
                      <span className="ml-1 text-xs text-muted-foreground">{formatRelative(d.firstFailedAt)}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <ExecutionLink id={d.lastExecutionId} onOpen={onOpenExecution} />
                      {d.resolvedExecutionId != null && (
                        <span className="ml-1 text-xs text-success">#{d.resolvedExecutionId}에서 해결</span>
                      )}
                    </td>
                    <td className="max-w-[240px] px-3 py-2">
                      <p className="truncate text-xs text-muted-foreground" title={d.errorMessage ?? ''}>
                        {d.errorMessage?.split('\n')[0] ?? ''}
                      </p>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ExecutionLink({ id, onOpen }: { id: number; onOpen: (id: number) => void }) {
  return (
    <button type="button" className="font-medium text-primary hover:underline" onClick={() => onOpen(id)}>
      #{id}
    </button>
  );
}
