import { useMemo, useState } from 'react';
import type { EChartsOption } from 'echarts';
import { CASE_STATE_META, CHANGE_META, type CaseState, type ScreenCases } from '@/lib/rounds';
import { cn } from '@/lib/utils';
import { ChartBox, useChartTheme } from './ChartBox';
import { changeToneClass } from './RoundView';

const STATE_ORDER: CaseState[] = ['PASSED', 'FAILED', 'SKIPPED', 'NOT_RUN'];
const STATE_DOT: Record<CaseState, string> = {
  PASSED: 'bg-success',
  FAILED: 'bg-destructive',
  SKIPPED: 'bg-border-strong',
  NOT_RUN: 'border border-border-strong bg-transparent',
};

/** 화면 묶음의 색: 실패가 있으면 빨강, 모두 통과면 초록, 테스트가 없거나 안 돌렸으면 회색 */
function groupColor(group: ScreenCases) {
  if (group.counts.failed > 0) return CASE_STATE_META.FAILED.color;
  if (group.cases.length > 0 && group.counts.passed === group.cases.length) return CASE_STATE_META.PASSED.color;
  return CASE_STATE_META.NOT_RUN.color;
}

function groupKey(group: ScreenCases) {
  return group.routeKey ?? '__unmapped__';
}

/**
 * 시나리오 케이스 트리. 사이트 → 화면 → 케이스로 펼치고, 고른 차수의 결과로 칠한다.
 * 화면을 누르면 오른쪽에 그 화면의 케이스(기능) 목록이 나온다.
 */
export function CaseTree({ projectName, groups, roundLabel }: { projectName: string; groups: ScreenCases[]; roundLabel: string }) {
  const t = useChartTheme();
  const [picked, setPicked] = useState<string | null>(null);
  const selected =
    groups.find((g) => groupKey(g) === picked) ??
    groups.find((g) => g.counts.failed > 0) ??
    groups.find((g) => g.cases.length > 0) ??
    groups[0];

  const option = useMemo<EChartsOption>(
    () => ({
      tooltip: { ...t.tooltip, trigger: 'item', formatter: (p: unknown) => (p as { data: { tip?: string } }).data.tip ?? '' },
      series: [
        {
          type: 'tree',
          orient: 'LR',
          left: 24,
          right: 230,
          top: 40,
          bottom: 16,
          symbolSize: 10,
          initialTreeDepth: 1,
          expandAndCollapse: true,
          animationDuration: 300,
          label: { position: 'left', verticalAlign: 'middle', align: 'right', fontSize: 12, color: t.strong },
          leaves: { label: { position: 'right', align: 'left', color: t.text } },
          lineStyle: { color: t.grid, width: 1.2 },
          data: [
            {
              name: projectName,
              itemStyle: { color: '#2563eb' },
              // 뿌리 이름은 왼쪽에 두면 잘리므로 점 위에 둔다.
              label: { position: 'top', align: 'left', verticalAlign: 'bottom', fontWeight: 'bold' },
              tip: `${projectName} · 화면 ${groups.filter((g) => g.routeKey).length}개`,
              children: groups.map((g) => ({
                name: g.cases.length ? `${g.name} (통과 ${g.counts.passed}/${g.cases.length})` : `${g.name} · 테스트 없음`,
                key: groupKey(g),
                itemStyle: { color: groupColor(g), borderColor: groupColor(g) },
                tip: `${g.name}: 케이스 ${g.cases.length}개 · 통과 ${g.counts.passed} · 실패 ${g.counts.failed} · 안 돌림 ${g.counts.notRun}`,
                children: g.cases.map((c) => ({
                  name: c.title,
                  itemStyle: { color: CASE_STATE_META[c.state].color, borderColor: CASE_STATE_META[c.state].color },
                  tip: `${c.title} · ${CASE_STATE_META[c.state].label}`,
                })),
              })),
            },
          ],
        },
      ],
    }),
    [groups, projectName, t]
  );

  if (groups.length === 0) {
    return (
      <p className="rounded-md bg-muted px-4 py-10 text-center text-sm text-muted-foreground">
        테스트 파일이 생기면 화면별 케이스 트리가 그려져요.
      </p>
    );
  }

  const height = Math.min(640, Math.max(280, groups.length * 44));

  return (
    <div className="grid grid-cols-1 gap-4 @5xl:grid-cols-[minmax(0,3fr)_minmax(260px,2fr)]">
      <div>
        <ChartBox
          option={option}
          height={height}
          label={`화면별 케이스 트리. ${roundLabel} 결과로 색을 칠했어요`}
          onClick={(data) => {
            const key = (data as { key?: string } | null)?.key;
            if (key) setPicked(key);
          }}
        />
        <ul className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground" aria-label="색 설명">
          {STATE_ORDER.map((s) => (
            <li key={s} className="flex items-center gap-1.5">
              <span className={cn('h-2.5 w-2.5 rounded-full', STATE_DOT[s])} />
              {CASE_STATE_META[s].label}
            </li>
          ))}
        </ul>
      </div>

      <div className="min-w-0">
        <label className="mb-2 block text-xs font-semibold text-muted-foreground" htmlFor="screen-picker">
          화면 고르기
        </label>
        <select
          id="screen-picker"
          value={selected ? groupKey(selected) : ''}
          onChange={(e) => setPicked(e.target.value)}
          className="mb-3 h-10 w-full rounded-sm border border-border bg-card px-3 text-sm text-foreground hover:border-border-strong"
        >
          {groups.map((g) => (
            <option key={groupKey(g)} value={groupKey(g)}>
              {g.name} · 케이스 {g.cases.length}개{g.counts.failed ? ` · 실패 ${g.counts.failed}` : ''}
            </option>
          ))}
        </select>
        {selected && <ScreenCaseList group={selected} />}
      </div>
    </div>
  );
}

/** 한 화면에서 확인하는 기능(케이스) 목록 */
function ScreenCaseList({ group }: { group: ScreenCases }) {
  if (group.cases.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
        이 화면을 지나는 테스트가 아직 없어요.
        <br />
        녹화하거나 구조 지도에서 경로를 골라 만들 수 있어요.
      </p>
    );
  }
  return (
    <ul className="max-h-[480px] divide-y divide-border overflow-y-auto rounded-md border border-border" aria-label={`${group.name} 케이스 목록`}>
      {group.cases.map((c, i) => (
        <li key={`${c.specPath}-${c.title}-${i}`} className="flex items-start gap-2.5 px-3 py-2">
          <span className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', STATE_DOT[c.state])} title={CASE_STATE_META[c.state].label} />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-foreground">{c.title}</p>
            <p className="truncate font-mono text-[11px] text-muted-foreground">{c.specPath}</p>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">{CASE_STATE_META[c.state].label}</span>
          {c.change && (c.change === 'NEW_FAIL' || c.change === 'FIXED') && (
            <span className={cn('shrink-0 rounded-full border px-1.5 text-[11px] font-semibold', changeToneClass(c.change))}>
              {CHANGE_META[c.change].label}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
