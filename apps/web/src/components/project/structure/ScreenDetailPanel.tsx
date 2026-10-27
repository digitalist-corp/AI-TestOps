import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CircleDashed, CheckCircle2, Loader2, Plus, Save, X, XCircle } from 'lucide-react';
import { api } from '@/api/client';
import type { SiteMapNode, SiteMapNodeDetail } from '@/types';
import { DecodeText } from './ConsoleHud';
import { ElementTable } from './ElementTable';
import { nodeStatus } from './layoutGraph';
import { verificationTicks } from './ScreenNode';

export const DETAIL_PANEL_WIDTH = 392;

const STATUS = {
  failed: { label: 'FAIL', text: '실패한 요소가 있습니다', color: 'var(--sg-fail)' },
  passed: { label: 'PASS', text: '모든 요소가 확인됐습니다', color: 'var(--sg-pass)' },
  neutral: { label: 'UNVERIFIED', text: '아직 확인되지 않은 요소가 있습니다', color: 'var(--c-muted)' },
};

const pad2 = (n: number) => String(n).padStart(2, '0');

function formatTime(iso: string | null) {
  return iso ? new Date(iso).toLocaleString('ko-KR') : '';
}

function Section({ code, title, children, right }: { code: string; title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="border-t border-[var(--c-line)] px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="sg-mono text-[9px] text-[var(--c-cyan)]">{code}</span>
        <h4 className="sg-label !text-[var(--c-muted)]">{title}</h4>
        <span className="h-px flex-1 bg-[var(--c-line)]" />
        {right}
      </div>
      {children}
    </section>
  );
}

function Prop({ k, v, mono = true }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <>
      <dt className="sg-label !text-[9px]">{k}</dt>
      <dd className={`min-w-0 truncate text-[11px] text-[var(--c-text)] ${mono ? 'sg-mono' : ''}`}>{v}</dd>
    </>
  );
}

/**
 * 화면 상세(오브젝트 인스펙터). 속성, 확인 현황, 메모 · 제외(다시 분석해도 남는다), 이 화면으로 만든
 * 테스트의 최근 결과, 들고 나는 전환, 요소 표를 보여 준다.
 */
export function ScreenDetailPanel({ projectId, routeKey, code, onClose, onAdd, onJump, onNodeUpdated }: {
  projectId: string;
  routeKey: string;
  code: string;
  onClose: () => void;
  onAdd: (routeKey: string) => void;
  onJump: (routeKey: string) => void;
  onNodeUpdated: (node: SiteMapNode) => void;
}) {
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

  const node = detail?.node;
  const status = STATUS[node ? nodeStatus(node) : 'neutral'];
  const outgoing = detail?.edges.filter((e) => e.from === routeKey) ?? [];
  const incoming = detail?.edges.filter((e) => e.to === routeKey) ?? [];
  const ticks = node ? verificationTicks(node) : [];

  return (
    <aside
      key={routeKey}
      className="sg-panel sg-hud absolute bottom-3 right-3 top-3 z-20 flex flex-col overflow-hidden"
      style={{ width: DETAIL_PANEL_WIDTH - 12 }}
      aria-label={`${routeKey} 화면 상세`}
      data-testid="structure-detail-panel"
    >
      <div className="sg-shimmer absolute inset-x-0 top-0 h-px" />
      <header className="px-4 pb-3 pt-3">
        <div className="flex items-center gap-2">
          <span className="sg-mono rounded-[2px] border border-[var(--c-cyan)]/50 bg-[var(--c-cyan)]/10 px-1.5 py-px text-[9px] font-bold tracking-widest text-[var(--c-cyan)]">
            INSPECTOR
          </span>
          <span className="sg-label !text-[9px]">OBJECT // SCREEN · {code}</span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto cursor-pointer rounded-[2px] p-1 text-[var(--c-muted)] hover:bg-[var(--c-accent)] hover:text-[var(--c-text)]"
            aria-label="상세 닫기"
            title="닫기 (Esc)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <h3 className="mt-2 break-all text-[15px] font-bold text-[var(--c-text)]">
          <DecodeText text={routeKey} className="sg-mono" />
        </h3>
        <p className="truncate text-xs text-[var(--c-muted)]">{node?.title ?? ' '}</p>
        <button
          type="button"
          onClick={() => onAdd(routeKey)}
          className="mt-3 flex h-8 w-full cursor-pointer items-center justify-center gap-1.5 rounded-[2px] border border-[var(--c-cyan)]/70 bg-[var(--c-cyan)]/10 text-xs font-bold text-[var(--c-cyan)] transition-colors hover:bg-[var(--c-cyan)] hover:text-[#021018]"
        >
          <Plus className="h-3.5 w-3.5" /> 경로에 추가
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && <p className="mx-4 mb-3 rounded-[2px] border border-[var(--c-red)]/40 bg-[var(--c-red)]/10 px-3 py-2 text-xs text-[var(--c-red)]">{error}</p>}
        {!detail || !node ? (
          !error && (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-[var(--c-cyan)]" />
            </div>
          )
        ) : (
          <>
            {screenshotUrl && (
              <div className="relative mx-4 mb-3 overflow-hidden rounded-[2px] border border-[var(--c-line-2)]">
                <img src={screenshotUrl} alt={`${routeKey} 화면 스크린샷`} className="max-h-44 w-full object-cover object-top opacity-90" />
                <span className="sg-label absolute left-1.5 top-1.5 bg-[var(--c-bg)]/80 px-1 !text-[9px] !text-[var(--c-cyan)]">CAPTURE</span>
              </div>
            )}

            <Section code="01" title="Properties">
              <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-1.5">
                <Prop k="Route" v={node.routeKey} />
                <Prop k="Title" v={node.title ?? '-'} mono={false} />
                <Prop k={node.origin === 'SITE' ? 'URL' : 'Source'} v={<span title={node.sourceFile ?? node.url ?? ''}>{node.sourceFile ?? node.url ?? '-'}</span>} />
                <Prop k="Origin" v={node.origin === 'SITE' ? 'SITE CRAWL' : 'CODE ANALYSIS'} />
                <Prop k="Auth" v={node.authRequired ? <span className="text-[var(--c-amber)]">REQUIRED</span> : 'PUBLIC'} />
                <Prop
                  k="Flags"
                  v={
                    node.excluded || node.stale ? (
                      <span className="text-[var(--c-amber)]">
                        {[node.excluded && '[제외됨]', node.stale && (node.origin === 'SITE' ? '[탐색에서 사라짐]' : '[코드에 없음]')].filter(Boolean).join(' ')}
                      </span>
                    ) : (
                      '-'
                    )
                  }
                />
              </dl>
            </Section>

            <Section
              code="02"
              title="Verification"
              right={
                <span className="sg-mono flex items-center gap-1 text-[10px] font-bold" style={{ color: status.color }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: status.color, boxShadow: `0 0 6px ${status.color}` }} />
                  {status.label}
                </span>
              }
            >
              <div className="grid grid-cols-3 gap-px overflow-hidden rounded-[2px] border border-[var(--c-line-2)] bg-[var(--c-line-2)]">
                {[
                  { k: 'PASS', v: node.passedCount, c: 'var(--sg-pass)' },
                  { k: 'FAIL', v: node.failedCount, c: node.failedCount > 0 ? 'var(--sg-fail)' : 'var(--c-muted)' },
                  { k: 'UNVERIFIED', v: node.unverifiedCount, c: 'var(--c-muted)' },
                ].map((m) => (
                  <div key={m.k} className="bg-[var(--c-bg-2)] px-2.5 py-2">
                    <p className="sg-label !text-[9px]">{m.k}</p>
                    <p className="sg-mono text-xl font-bold tabular-nums" style={{ color: m.c }}>
                      {pad2(m.v)}
                    </p>
                  </div>
                ))}
              </div>
              {ticks.length > 0 && (
                <div className="sg-ticks mt-2 !h-3">
                  {ticks.map((t, i) => (
                    <i
                      key={i}
                      style={{
                        background: t === 'passed' ? 'var(--sg-pass)' : t === 'failed' ? 'var(--sg-fail)' : '#2a3a4c',
                        animationDelay: `${i * 20}ms`,
                      }}
                    />
                  ))}
                </div>
              )}
              <p className="mt-1.5 text-[11px]" style={{ color: status.color }}>{status.text}</p>
            </Section>

            <Section code="03" title="Annotation">
              <textarea
                value={note}
                maxLength={500}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder="이 화면에 대해 남길 메모 (다시 분석해도 남습니다)"
                className="sg-input w-full resize-none px-2.5 py-2 text-[11px]"
                aria-label="화면 메모"
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  disabled={saving || note.trim() === (node.note ?? '')}
                  onClick={() => save({ note })}
                  className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-[2px] border border-[var(--c-line-2)] bg-[var(--c-bg-2)] px-2.5 text-[11px] font-semibold text-[var(--c-text)] hover:border-[var(--c-cyan)] hover:text-[var(--c-cyan)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[var(--c-line-2)] disabled:hover:text-[var(--c-text)]"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  메모 저장
                </button>
                <label className="ml-auto flex cursor-pointer items-center gap-2 text-[11px] text-[var(--c-text)]">
                  테스트 생성에서 제외
                  <input
                    type="checkbox"
                    role="switch"
                    className="peer sr-only"
                    checked={node.excluded}
                    disabled={saving}
                    onChange={(e) => save({ excluded: e.target.checked })}
                  />
                  <span className="relative h-4 w-8 rounded-[2px] border border-[var(--c-line-2)] bg-[var(--c-bg-2)] transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-2.5 after:w-2.5 after:rounded-[1px] after:bg-[var(--c-muted)] after:transition-transform peer-checked:border-[var(--c-amber)] peer-checked:bg-[var(--c-amber)]/15 peer-checked:after:translate-x-4 peer-checked:after:bg-[var(--c-amber)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--c-cyan)]" />
                </label>
              </div>
            </Section>

            <Section code="04" title="Linked tests" right={<span className="sg-mono text-[10px] text-[var(--c-dim)]">{pad2(detail.tests.length)}</span>}>
              {detail.tests.length === 0 ? (
                <p className="text-[11px] text-[var(--c-muted)]">아직 없습니다. 경로에 추가해 테스트를 만들어 보세요.</p>
              ) : (
                <ul className="space-y-1">
                  {detail.tests.map((test) => (
                    <li key={test.specPath} className="flex items-center gap-2 rounded-[2px] border border-[var(--c-line)] bg-[var(--c-bg-2)] px-2.5 py-1.5">
                      {test.lastStatus === 'FAILED' ? (
                        <XCircle className="h-3.5 w-3.5 shrink-0 text-[var(--sg-fail)]" />
                      ) : test.lastStatus === 'PASSED' ? (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--sg-pass)]" />
                      ) : (
                        <CircleDashed className="h-3.5 w-3.5 shrink-0 text-[var(--c-dim)]" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="sg-mono truncate text-[11px] text-[var(--c-text)]" title={test.specPath}>
                          {test.specPath}
                        </p>
                        <p className="sg-mono text-[9px] text-[var(--c-dim)]">
                          {test.lastStatus
                            ? `${formatTime(test.lastRunAt)} · PASS ${test.passedCases} · FAIL ${test.failedCases}`
                            : 'NOT RUN'}
                        </p>
                      </div>
                      {test.executionId && (
                        <Link to={`/projects/${projectId}/results`} className="shrink-0 text-[11px] font-bold text-[var(--c-cyan)] hover:underline">
                          결과 →
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {(outgoing.length > 0 || incoming.length > 0) && (
              <Section code="05" title="Relations" right={<span className="sg-mono text-[10px] text-[var(--c-dim)]">OUT {pad2(outgoing.length)} · IN {pad2(incoming.length)}</span>}>
                <ul className="space-y-px">
                  {[...outgoing.map((e) => ({ dir: 'out' as const, route: e.to, label: e.label })), ...incoming.map((e) => ({ dir: 'in' as const, route: e.from, label: e.label }))].map((rel, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        onClick={() => onJump(rel.route)}
                        className="flex w-full cursor-pointer items-center gap-2 rounded-[2px] px-2 py-1 text-left text-[11px] hover:bg-[var(--c-accent)]"
                      >
                        <span className={`sg-mono w-8 shrink-0 text-[9px] font-bold ${rel.dir === 'out' ? 'text-[var(--c-cyan)]' : 'text-[var(--c-dim)]'}`}>
                          {rel.dir === 'out' ? 'OUT' : 'IN'}
                        </span>
                        {rel.dir === 'out' ? <ArrowRight className="h-3 w-3 shrink-0 text-[var(--c-cyan)]" /> : <ArrowLeft className="h-3 w-3 shrink-0 text-[var(--c-dim)]" />}
                        <span className="sg-mono truncate text-[var(--c-text)]">{rel.route}</span>
                        {rel.label && <span className="ml-auto truncate text-[var(--c-muted)]">“{rel.label}”</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <Section code="06" title="Elements" right={<span className="sg-mono text-[10px] text-[var(--c-dim)]">{pad2(detail.elements.length)}</span>}>
              <ElementTable elements={detail.elements} origin={node.origin} stacked />
            </Section>
          </>
        )}
      </div>
    </aside>
  );
}
