import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import type { incompleteByAssignee } from '@/lib/dashboard';

const UNPLANNED_SHOWN = 5;
const empty = 'mt-1 text-sm text-muted-foreground';

/**
 * 대시보드 ② 어디가 문제인가. 미해결 결함 · 오류 난 화면 · 계획 없는 화면 · 담당자별 미완료.
 * 값을 아직 못 받은 칸(null)은 "불러오는 중"으로 둔다.
 */
export function ProblemSpots({
  projectId,
  openDefects,
  failing,
  unplanned,
  assignees,
}: {
  projectId: string;
  /** 미해결 결함 수 — 결함 리스트와 같은 API (#81) */
  openDefects: number | null;
  failing: { name: string; failed: number }[] | null;
  unplanned: { routeKey: string; name: string }[] | null;
  assignees: ReturnType<typeof incompleteByAssignee> | null;
}) {
  const base = `/projects/${projectId}`;
  return (
    <section aria-label="문제 지점" className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          어디가 문제인가
        </h4>
        <Link to={`${base}/defects`} className="text-xs font-medium text-destructive hover:underline">
          미해결 결함 {openDefects ?? '-'}건 →
        </Link>
      </div>

      <div>
        <h5 className="text-xs font-semibold text-muted-foreground">오류 난 화면</h5>
        {failing === null ? (
          <p className={empty}>불러오는 중이에요.</p>
        ) : failing.length === 0 ? (
          <p className={empty}>오류 난 화면이 없어요.</p>
        ) : (
          <ul aria-label="오류 난 화면" className="mt-1 space-y-0.5">
            {failing.map((f) => (
              <li key={f.name} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-foreground">{f.name}</span>
                <span className="shrink-0 font-semibold text-destructive">실패 {f.failed}건</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between gap-2">
          <h5 className="text-xs font-semibold text-muted-foreground">계획 없는 화면</h5>
          <Link to={`${base}/structure`} className="text-xs font-medium text-primary hover:underline">
            화면 지도에서 보기 →
          </Link>
        </div>
        {unplanned === null ? (
          <p className={empty}>불러오는 중이에요.</p>
        ) : unplanned.length === 0 ? (
          <p className={empty}>모든 화면에 계획이 있어요.</p>
        ) : (
          <ul aria-label="계획 없는 화면" className="mt-1 space-y-0.5 text-sm text-foreground">
            {unplanned.slice(0, UNPLANNED_SHOWN).map((s) => (
              <li key={s.routeKey} className="truncate">
                {s.name}
              </li>
            ))}
            {unplanned.length > UNPLANNED_SHOWN && (
              <li className="text-muted-foreground">외 {unplanned.length - UNPLANNED_SHOWN}개</li>
            )}
          </ul>
        )}
      </div>

      <div>
        <h5 className="text-xs font-semibold text-muted-foreground">담당자별 미완료</h5>
        {assignees === null ? (
          <p className={empty}>불러오는 중이에요.</p>
        ) : assignees.length === 0 ? (
          <p className={empty}>미완료 항목이 없어요.</p>
        ) : (
          <ul aria-label="담당자별 미완료" className="mt-1 space-y-0.5">
            {assignees.map((a) => (
              <li key={a.key} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-foreground">{a.assignee}</span>
                <span className="shrink-0 font-semibold tabular-nums text-foreground">{a.count}건</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
