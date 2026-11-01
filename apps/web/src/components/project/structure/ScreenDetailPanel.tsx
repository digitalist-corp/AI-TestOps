import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CircleDashed, CheckCircle2, Loader2, Plus, Save, Trash2, X, XCircle } from 'lucide-react';
import { api } from '@/api/client';
import type { SiteMapNode, SiteMapNodeDetail } from '@/types';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useAiEnabled } from '@/lib/aiEnabled';
import { cn } from '@/lib/utils';
import { ElementTable } from './ElementTable';
import { nodeStatus } from './layoutGraph';
import { TICK_CLASS, verificationTicks } from './ScreenNode';

export const DETAIL_PANEL_WIDTH = 392;

const STATUS = {
  failed: { label: '실패', text: '실패한 요소가 있습니다', variant: 'destructive', tone: 'text-destructive' },
  passed: { label: '통과', text: '모든 요소가 확인됐습니다', variant: 'success', tone: 'text-success' },
  neutral: { label: '미확인', text: '아직 확인되지 않은 요소가 있습니다', variant: 'neutral', tone: 'text-muted-foreground' },
} as const;

function formatTime(iso: string | null) {
  return iso ? new Date(iso).toLocaleString('ko-KR') : '';
}

function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="border-t border-border px-4 py-4">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-foreground">{title}</h4>
        {right}
      </div>
      {children}
    </section>
  );
}

/** mono: 경로 · 파일 · 주소처럼 실제 코드 값일 때만 모노 글꼴로 보인다. */
function Prop({ k, v, mono = false }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <>
      <dt className="text-xs text-muted-foreground">{k}</dt>
      <dd className={cn('min-w-0 truncate text-[13px] text-foreground', mono && 'font-mono text-xs')}>{v}</dd>
    </>
  );
}

/**
 * 화면 상세. 속성, 확인 현황, 메모 · 제외(다시 분석해도 남는다), 이 화면으로 만든
 * 테스트의 최근 결과, 들고 나는 전환, 요소 표를 보여 준다.
 */
export function ScreenDetailPanel({ projectId, routeKey, onClose, onAdd, onJump, onNodeUpdated, onDeleteNode }: {
  projectId: string;
  routeKey: string;
  onClose: () => void;
  onAdd: (routeKey: string) => void;
  onJump: (routeKey: string) => void;
  onNodeUpdated: (node: SiteMapNode) => void;
  onDeleteNode?: (routeKey: string) => void;
}) {
  const { active: aiActive } = useAiEnabled();
  const [detail, setDetail] = useState<SiteMapNodeDetail | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError('');
    setScreenshotUrl(null);
    api
      .getSiteMapNode(projectId, routeKey)
      .then((next) => {
        if (cancelled) return;
        setDetail(next);
        setNote(next.node.note ?? '');
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [projectId, routeKey]);

  // 스크린샷은 인증 헤더가 필요해 img src 로 바로 걸지 않고 받아서 보여 준다.
  const screenshotRoute = detail?.node.hasScreenshot ? detail.node.routeKey : null;
  useEffect(() => {
    if (!screenshotRoute) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    api
      .fetchSiteMapScreenshot(projectId, screenshotRoute)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setScreenshotUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [projectId, screenshotRoute]);

  const save = async (edit: { excluded?: boolean; note?: string }) => {
    setSaving(true);
    setError('');
    try {
      const next = await api.updateSiteMapNode(projectId, routeKey, edit);
      setDetail(next);
      setNote(next.node.note ?? '');
      onNodeUpdated(next.node);
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`'${routeKey}' 화면을 구조에서 삭제할까요? 연결된 전환선도 함께 삭제됩니다.`)) return;
    setSaving(true);
    setError('');
    try {
      await api.deleteSiteMapNode(projectId, routeKey);
      onClose();
      onDeleteNode?.(routeKey);
    } catch (e) {
      setError(e instanceof Error ? e.message : '화면 삭제에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const node = detail?.node;
  const status = STATUS[node ? nodeStatus(node) : 'neutral'];
  const outgoing = detail?.edges.filter((e) => e.from === routeKey) ?? [];
  const incoming = detail?.edges.filter((e) => e.to === routeKey) ?? [];
  const ticks = node ? verificationTicks(node) : [];

  return (
    <aside
      key={routeKey}
      className="absolute bottom-3 right-3 top-3 z-20 flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg"
      style={{ width: DETAIL_PANEL_WIDTH - 12 }}
      aria-label={`${routeKey} 화면 상세`}
      data-testid="structure-detail-panel"
    >
      <header className="px-4 pb-4 pt-4">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="break-all font-mono text-base font-semibold text-foreground">{routeKey}</h3>
            <p className="truncate text-sm text-muted-foreground">{node?.title ?? ' '}</p>
          </div>
          <Button variant="ghost" size="icon" className="-mr-2 -mt-1 h-8 w-8 shrink-0" onClick={onClose} aria-label="상세 닫기" title="닫기 (Esc)">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Button variant="secondary" size="xs" className="flex-1" onClick={() => onAdd(routeKey)}>
            <Plus className="h-4 w-4" /> 경로에 추가
          </Button>
          <Button
            variant="ghost"
            size="xs"
            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            onClick={handleDelete}
            disabled={saving}
            title="이 화면을 구조에서 삭제"
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" /> 삭제
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && (
          <p className="mx-4 mb-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</p>
        )}
        {!detail || !node ? (
          !error && (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )
        ) : (
          <>
            {screenshotUrl && (
              <div className="mx-4 mb-4 overflow-hidden rounded-lg border border-border">
                <img src={screenshotUrl} alt={`${routeKey} 화면 스크린샷`} className="max-h-44 w-full object-cover object-top" />
              </div>
            )}

            <Section title="속성">
              <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-2">
                <Prop k="경로" v={node.routeKey} mono />
                <Prop k="제목" v={node.title ?? '-'} />
                <Prop
                  k={node.origin === 'SITE' ? '주소' : '소스 파일'}
                  v={<span title={node.sourceFile ?? node.url ?? ''}>{node.sourceFile ?? node.url ?? '-'}</span>}
                  mono
                />
                <Prop
                  k="찾은 방법"
                  v={node.origin === 'SITE' ? '사이트 탐색' : node.origin === 'MANUAL' ? '직접 추가' : '코드 분석'}
                />
                <Prop k="로그인" v={node.authRequired ? <span className="text-warning">필요</span> : '필요 없음'} />
                <Prop
                  k="표시"
                  v={
                    node.excluded || node.stale ? (
                      <span className="text-warning">
                        {[node.excluded && '제외됨', node.stale && (node.origin === 'SITE' ? '탐색에서 사라짐' : '코드에 없음')].filter(Boolean).join(' · ')}
                      </span>
                    ) : (
                      '-'
                    )
                  }
                />
              </dl>
            </Section>

            <Section title="확인 현황" right={<Badge variant={status.variant}>{status.label}</Badge>}>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { k: '통과', v: node.passedCount, c: 'text-success' },
                  { k: '실패', v: node.failedCount, c: node.failedCount > 0 ? 'text-destructive' : 'text-muted-foreground' },
                  { k: '미확인', v: node.unverifiedCount, c: 'text-muted-foreground' },
                ].map((m) => (
                  <div key={m.k} className="rounded-lg border border-border bg-background px-3 py-2">
                    <p className="text-xs text-muted-foreground">{m.k}</p>
                    <p className={cn('text-xl font-semibold tabular-nums', m.c)}>{m.v}</p>
                  </div>
                ))}
              </div>
              {ticks.length > 0 && (
                <div className="mt-3 flex h-2.5 gap-0.5">
                  {ticks.map((t, i) => (
                    <i key={i} className={cn('flex-1 rounded-sm', TICK_CLASS[t])} />
                  ))}
                </div>
              )}
              <p className={cn('mt-2 text-xs', status.tone)}>{status.text}</p>
            </Section>

            <Section title="메모">
              <textarea
                value={note}
                maxLength={500}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder="이 화면에 대해 남길 메모 (다시 분석해도 남습니다)"
                className="w-full resize-none rounded-lg border border-border bg-card px-3 py-2 text-[13px] text-foreground transition-colors placeholder:text-muted-foreground hover:border-border-strong"
                aria-label="화면 메모"
              />
              <div className="mt-2 flex items-center gap-2">
                <Button variant="outline" size="xs" disabled={saving || note.trim() === (node.note ?? '')} onClick={() => save({ note })}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  메모 저장
                </Button>
                <label className="ml-auto flex cursor-pointer items-center gap-2 text-[13px] text-foreground">
                  테스트 생성에서 제외
                  <input
                    type="checkbox"
                    role="switch"
                    className="peer sr-only"
                    checked={node.excluded}
                    disabled={saving}
                    onChange={(e) => save({ excluded: e.target.checked })}
                  />
                  {/* 상단바 AI 스위치와 같은 모양: 켜면 파란 바탕에 흰 점이 오른쪽으로 간다 */}
                  <span
                    aria-hidden="true"
                    className="relative h-4 w-7 shrink-0 rounded-full border border-border bg-muted transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-2.5 after:w-2.5 after:rounded-full after:bg-muted-foreground after:transition-transform peer-checked:border-primary peer-checked:bg-primary peer-checked:after:translate-x-3 peer-checked:after:bg-primary-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary peer-disabled:opacity-60"
                  />
                </label>
              </div>
            </Section>

            <Section title="연결된 테스트" right={<span className="text-xs tabular-nums text-muted-foreground">{detail.tests.length}개</span>}>
              {detail.tests.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {/* AI를 끄면 테스트를 만들 수 없으니 만들어 보라는 안내도 뺀다 */}
                  {aiActive ? '아직 없습니다. 경로에 추가해 테스트를 만들어 보세요.' : '아직 없습니다.'}
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {detail.tests.map((test) => (
                    <li key={test.specPath} className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
                      {test.lastStatus === 'FAILED' ? (
                        <XCircle className="h-4 w-4 shrink-0 text-destructive" />
                      ) : test.lastStatus === 'PASSED' ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                      ) : (
                        <CircleDashed className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-xs text-foreground" title={test.specPath}>
                          {test.specPath}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {test.lastStatus
                            ? `${formatTime(test.lastRunAt)} · 통과 ${test.passedCases} · 실패 ${test.failedCases}`
                            : '아직 실행하지 않았습니다'}
                        </p>
                      </div>
                      {test.executionId && (
                        <Link to={`/projects/${projectId}/results`} className="shrink-0 text-xs font-semibold text-primary hover:underline">
                          결과 →
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {(outgoing.length > 0 || incoming.length > 0) && (
              <Section
                title="연결된 화면"
                right={
                  <span className="text-xs tabular-nums text-muted-foreground">
                    나가는 {outgoing.length} · 들어오는 {incoming.length}
                  </span>
                }
              >
                <ul className="space-y-0.5">
                  {[...outgoing.map((e) => ({ dir: 'out' as const, route: e.to, label: e.label })), ...incoming.map((e) => ({ dir: 'in' as const, route: e.from, label: e.label }))].map((rel, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        onClick={() => onJump(rel.route)}
                        className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-accent"
                      >
                        <span className={cn('w-14 shrink-0 text-xs font-medium', rel.dir === 'out' ? 'text-primary' : 'text-muted-foreground')}>
                          {rel.dir === 'out' ? '나가는' : '들어오는'}
                        </span>
                        {rel.dir === 'out' ? (
                          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-primary" />
                        ) : (
                          <ArrowLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <span className="truncate font-mono text-xs text-foreground">{rel.route}</span>
                        {rel.label && <span className="ml-auto truncate text-xs text-muted-foreground">“{rel.label}”</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <Section title="요소" right={<span className="text-xs tabular-nums text-muted-foreground">{detail.elements.length}개</span>}>
              <ElementTable elements={detail.elements} origin={node.origin} stacked />
            </Section>
          </>
        )}
      </div>
    </aside>
  );
}
