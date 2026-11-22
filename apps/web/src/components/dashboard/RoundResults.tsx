import { useEffect, useState } from 'react';
import { BarChart3, ChevronDown, ChevronRight, GitCompare, Loader2 } from 'lucide-react';
import { api } from '@/api/client';
import type { TestRound, TestRoundDetail } from '@/types';
import { formatDuration } from '@/lib/utils';
import { isRoundRunning, roundOptionLabel, roundSentence } from '@/lib/rounds';
import { RoundChanges, RoundTrend } from './RoundView';

/**
 * 실행 이력 맨 위 "차수별 결과". 차수(N차 테스트)는 사용자가 돌린 실행을 순서대로 센 것이다.
 * 차수를 고르면 한 문장 요약과 지난번 대비 변화가 그 차수로 바뀐다. 접어 둘 수 있다.
 * runKey 는 실행이 생기거나 상태가 바뀔 때만 달라지는 값 — 그때만 차수 목록을 다시 읽는다.
 */
export function RoundResults({
  projectId,
  runKey,
  onOpenExecution,
}: {
  projectId: string;
  runKey: string;
  /** 그 실행의 로그 · 화면 기록 보기 */
  onOpenExecution: (executionId: number) => void;
}) {
  const [open, setOpen] = useState(true);
  const [rounds, setRounds] = useState<TestRound[] | null>(null);
  const [pickedId, setPickedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<TestRoundDetail | null>(null);

  useEffect(() => {
    let alive = true;
    api.rounds.list(projectId).then((list) => alive && setRounds(list)).catch(() => alive && setRounds([]));
    return () => {
      alive = false;
    };
  }, [projectId, runKey]);

  // 고르지 않았으면 가장 최근 차수를 따라간다.
  const selected = rounds?.find((r) => r.executionId === pickedId) ?? rounds?.[0] ?? null;
  const selectedKey = selected ? `${selected.executionId}:${selected.status}` : null;

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let alive = true;
    api.rounds
      .get(projectId, selected.executionId)
      .then((d) => alive && setDetail(d))
      .catch(() => alive && setDetail(null));
    return () => {
      alive = false;
    };
    // selectedKey 가 바뀔 때(다른 차수 · 상태 변화)만 다시 읽는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, selectedKey]);

  const detailMatches = detail && selected && detail.round.executionId === selected.executionId;
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <section className="rounded-lg border border-border bg-card p-4" aria-label="차수별 결과">
      <div className="flex flex-col gap-3 @3xl:flex-row @3xl:items-end @3xl:justify-between">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex items-center gap-2 text-sm font-semibold text-foreground"
          >
            <Chevron className="h-4 w-4 text-muted-foreground" />
            <BarChart3 className="h-4 w-4 text-primary" />
            차수별 결과
          </button>
          <p className="mt-1 text-xs text-muted-foreground">
            테스트를 돌린 순서대로 1차, 2차…로 부릅니다. 차수를 고르면 아래 내용이 그 차수 기준으로 바뀌어요.
          </p>
        </div>
        {open && rounds && rounds.length > 0 && (
          <div className="flex shrink-0 flex-col gap-1">
            <label htmlFor="round-picker" className="text-xs font-semibold text-muted-foreground">
              차수 고르기
            </label>
            <select
              id="round-picker"
              value={selected?.executionId ?? ''}
              onChange={(e) => setPickedId(Number(e.target.value))}
              className="h-10 w-full min-w-0 rounded-sm border border-border bg-card px-3 text-sm text-foreground hover:border-border-strong @3xl:w-[320px]"
            >
              {rounds.map((r) => (
                <option key={r.executionId} value={r.executionId}>
                  {roundOptionLabel(r)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {open &&
        (rounds === null ? (
          <Loading />
        ) : rounds.length === 0 ? (
          <p className="mt-4 rounded-md bg-muted px-4 py-10 text-center text-sm text-muted-foreground">
            아직 돌린 테스트가 없어요. 상단의 ‘전체 실행’을 누르면 1차 테스트가 시작돼요.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            {selected && (
              <div className="rounded-md border border-primary/20 bg-primary/5 px-4 py-3">
                <p className="text-[15px] font-medium leading-relaxed text-foreground">
                  {detailMatches ? roundSentence(detail) : `${selected.round}차 테스트 결과를 불러오는 중이에요.`}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {selected.title}
                  {formatDuration(selected.durationMs) && ` · ${formatDuration(selected.durationMs)} 걸림`}
                  {' · '}
                  <button
                    type="button"
                    onClick={() => onOpenExecution(selected.executionId)}
                    className="font-medium text-primary hover:underline"
                  >
                    로그와 화면 기록 보기
                  </button>
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 @7xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div>
                <h5 className="mb-1 text-xs font-semibold text-muted-foreground">최근 차수 흐름 (막대를 누르면 그 차수로)</h5>
                <RoundTrend rounds={rounds} selectedId={selected?.executionId ?? null} onSelect={setPickedId} />
              </div>
              <div>
                <h5 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <GitCompare className="h-3.5 w-3.5" />
                  지난번과 비교
                </h5>
                {detailMatches && detail ? (
                  isRoundRunning(detail.round) ? (
                    <p className="text-sm text-muted-foreground">끝나면 지난번과 비교해 보여 줄게요.</p>
                  ) : (
                    <RoundChanges detail={detail} />
                  )
                ) : (
                  <Loading />
                )}
              </div>
            </div>
          </div>
        ))}
    </section>
  );
}

function Loading() {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      불러오는 중...
    </div>
  );
}
