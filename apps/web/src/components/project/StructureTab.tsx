import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, GitBranch, Loader2, Network, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react';
import { api } from '@/api/client';
import type { SiteMap, SiteMapNodeDetail } from '@/types';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { formatEta } from '@/components/project/AnalysisProgress';

const POLL_INTERVAL_MS = 2000;

const FRAMEWORK_LABEL: Record<string, string> = {
  NEXT: 'Next.js',
  REACT_ROUTER: 'React Router',
};

function formatTime(iso: string | null) {
  return iso ? new Date(iso).toLocaleString('ko-KR') : '-';
}

/** 저장소 코드에서 찾은 화면 목록. 소스 저장소를 연결하고 분석을 시작하는 곳이기도 하다. */
export function StructureTab({ projectId }: { projectId: string }) {
  const [siteMap, setSiteMap] = useState<SiteMap | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [token, setToken] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [openRoute, setOpenRoute] = useState<string | null>(null);
  const [detail, setDetail] = useState<SiteMapNodeDetail | null>(null);
  const [instruction, setInstruction] = useState('');
  const [createdJob, setCreatedJob] = useState<{ id: number; specPath: string } | null>(null);

  const apply = useCallback((next: SiteMap) => {
    setSiteMap(next);
    setUrl(next.source.url ?? '');
    setBranch(next.source.branch ?? '');
  }, []);

  useEffect(() => {
    api.getSiteMap(projectId).then(apply).catch((e: Error) => setError(e.message));
  }, [projectId, apply]);

  // 분석 중에만 진행 상황을 다시 읽는다. 입력 중인 저장소 주소를 덮어쓰지 않도록 분석 결과만 갱신한다.
  const running = siteMap?.analysis.status === 'RUNNING';
  useEffect(() => {
    if (!running) return;
    pollRef.current = setInterval(() => {
      api.getSiteMap(projectId).then(setSiteMap).catch(() => {});
    }, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [running, projectId]);

  const toggleNode = (routeKey: string) => {
    if (openRoute === routeKey) {
      setOpenRoute(null);
      return;
    }
    setOpenRoute(routeKey);
    setDetail(null);
    setInstruction('');
    setCreatedJob(null);
    api.getSiteMapNode(projectId, routeKey).then(setDetail).catch((e: Error) => setError(e.message));
  };

  /** 고른 화면의 정보로 테스트 생성을 요청한다. 만들어진 코드는 AI 검토에서 승인해야 반영된다. */
  const generateFor = async (routeKey: string) => {
    const slug = routeKey.replace(/[:*]/g, '').split('/').filter(Boolean).join('-') || 'home';
    const specPath = `tests/${slug}.spec.ts`;
    setBusy(true);
    setError('');
    try {
      const job = await api.aiJobs.createTemplateGenerate(projectId, {
        targetSpecPath: specPath,
        instruction: instruction.trim() || `${routeKey} 화면의 주요 요소가 보이고 기본 동작이 되는지 확인한다.`,
        routeKeys: [routeKey],
      });
      setCreatedJob({ id: job.id, specPath });
    } catch (e) {
      setError(e instanceof Error ? e.message : '요청에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const run = async (action: () => Promise<SiteMap>) => {
    setBusy(true);
    setError('');
    try {
      apply(await action());
      setToken('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '요청에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  if (!siteMap) {
    return error ? (
      <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{error}</p>
    ) : (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const { source, analysis, nodes } = siteMap;
  const hasSource = Boolean(source.url) || source.usesProjectRepository;
  const sourceChanged = url.trim() !== (source.url ?? '') || branch.trim() !== (source.branch ?? '') || token !== '';

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">분석할 소스 저장소</h3>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          테스트할 앱의 소스 코드가 있는 GitHub 저장소입니다. React Router 와 Next.js 프로젝트를 읽을 수 있습니다.
          {source.usesProjectRepository && ' 지금은 따로 연결한 저장소가 없어 프로젝트 저장소를 읽습니다.'}
        </p>
        <div className="grid grid-cols-1 gap-3 @3xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] @3xl:items-end">
          <div className="space-y-1">
            <Label htmlFor="structure-source-url">저장소 주소</Label>
            <Input
              id="structure-source-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/owner/repo"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="structure-source-branch">브랜치</Label>
            <Input
              id="structure-source-branch"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="기본 브랜치"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="structure-source-token">액세스 토큰</Label>
            <Input
              id="structure-source-token"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={source.tokenSet ? '변경하려면 새 토큰 입력' : '비공개 저장소일 때만'}
            />
          </div>
          <Button
            variant="outline"
            disabled={busy || !sourceChanged}
            onClick={() =>
              run(() =>
                api.updateSiteMapSource(projectId, {
                  url: url.trim(),
                  branch: branch.trim(),
                  token: token === '' ? undefined : token,
                })
              )
            }
          >
            저장
          </Button>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <div className="flex items-center gap-2">
              <Network className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">구조 분석</h3>
            </div>
            {analysis.status === 'NONE' && <Badge>분석 전</Badge>}
            {analysis.status === 'RUNNING' && (
              <Badge variant="info">
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                {analysis.screenCount > 0
                  ? `화면 읽는 중 ${analysis.processedCount}/${analysis.screenCount}`
                  : '저장소 받는 중'}
                {analysis.etaSeconds != null && ` · ${formatEta(analysis.etaSeconds)}`}
              </Badge>
            )}
            {analysis.status === 'COMPLETED' && (
              <Badge variant={analysis.partial ? 'warning' : 'success'}>
                {analysis.partial ? '부분 분석' : '완료'} · 화면 {analysis.screenCount}개
              </Badge>
            )}
            {analysis.status === 'FAILED' && <Badge variant="destructive">실패</Badge>}
            {analysis.framework && (
              <span className="text-xs text-muted-foreground">{FRAMEWORK_LABEL[analysis.framework]}</span>
            )}
            {analysis.commitSha && (
              <span className="font-mono text-xs text-muted-foreground" title={analysis.commitSha}>
                커밋 {analysis.commitSha.slice(0, 8)}
              </span>
            )}
            {analysis.finishedAt && (
              <span className="text-xs text-muted-foreground">{formatTime(analysis.finishedAt)}</span>
            )}
            {analysis.status === 'COMPLETED' && (
              <span className="text-xs text-muted-foreground">
                {analysis.llmCalls === 0 ? '바뀐 화면 없음 (AI 호출 0회)' : `AI 호출 ${analysis.llmCalls}회`}
              </span>
            )}
          </div>
          <Button
            disabled={busy || running || !hasSource || sourceChanged}
            title={
              !hasSource
                ? '소스 저장소를 먼저 연결하세요'
                : sourceChanged
                  ? '바꾼 저장소 설정을 먼저 저장하세요'
                  : undefined
            }
            onClick={() => run(() => api.analyzeSiteMap(projectId))}
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {analysis.status === 'NONE' ? '분석 시작' : '다시 분석'}
          </Button>
        </div>

        {analysis.status === 'RUNNING' && (
          <p className="mt-3 text-xs text-muted-foreground">
            저장소를 받아 화면을 찾고, 화면마다 AI 가 코드를 읽어 요소를 뽑습니다. 화면 하나에 10초쯤 걸리고,
            지난번과 코드가 같은 화면은 건너뜁니다.
          </p>
        )}
        {analysis.status === 'FAILED' && analysis.errorMessage && (
          <p className="mt-3 rounded-md bg-destructive/5 px-3 py-2 text-sm text-destructive">{analysis.errorMessage}</p>
        )}
        {analysis.status !== 'FAILED' && analysis.warnings.length > 0 && (
          <ul className="mt-3 space-y-1">
            {analysis.warnings.map((warning) => (
              <li key={warning} className="flex items-start gap-2 text-xs text-warning">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{warning}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {siteMap.layouts.map((layout) => (
        <section key={layout.sourceFile} className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              공용 메뉴 · 화면 {layout.routeKeys.length}개에서 보임
            </h3>
            <span className="font-mono text-xs text-muted-foreground">{layout.sourceFile}</span>
          </div>
          {layout.links.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">다른 화면으로 가는 링크를 찾지 못했습니다.</p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {layout.links.map((link, index) => (
                <li key={index} className="flex flex-col gap-0.5 @3xl:flex-row @3xl:items-center @3xl:gap-3">
                  <span className="shrink-0 font-mono text-sm text-foreground">→ {link.to}</span>
                  <code className="min-w-0 break-all text-xs text-muted-foreground">
                    {link.selector ?? (link.label ? `"${link.label}" (셀렉터를 만들 수 없음)` : '셀렉터를 만들 수 없음')}
                  </code>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      <section className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">
            화면 {nodes.length}개 · 전환 {siteMap.edges.length}개
          </h3>
        </div>
        {nodes.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            아직 찾은 화면이 없습니다. 소스 저장소를 연결하고 분석을 시작하세요.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {nodes.map((node) => (
              <li key={node.routeKey}>
                <button
                  type="button"
                  aria-expanded={openRoute === node.routeKey}
                  onClick={() => toggleNode(node.routeKey)}
                  className="flex w-full flex-col gap-1 px-4 py-2.5 text-left hover:bg-accent/40 @3xl:flex-row @3xl:items-center @3xl:justify-between @3xl:gap-4"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {openRoute === node.routeKey ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate font-mono text-sm text-foreground">{node.routeKey}</span>
                    {node.title && <span className="truncate text-xs text-muted-foreground">{node.title}</span>}
                    <Badge>요소 {node.elementCount}</Badge>
                    {node.stale && (
                      <Badge variant="warning" title="마지막 분석에서 코드에 없던 화면입니다">
                        코드에서 사라짐
                      </Badge>
                    )}
                  </span>
                  <span className="truncate font-mono text-xs text-muted-foreground" title={node.sourceFile ?? ''}>
                    {node.sourceFile ?? '-'}
                  </span>
                </button>
                {openRoute === node.routeKey && (
                  <div className="border-t border-border bg-muted/30 px-4 py-3">
                    {!detail ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : detail.elements.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        코드에서 확인된 요소가 없습니다. 글자가 변수나 번역 함수로 만들어지는 화면은 요소를 뽑지 못합니다.
                      </p>
                    ) : (
                      <ul className="space-y-1.5">
                        {detail.elements.map((element, index) => (
                          <li key={index} className="flex flex-col gap-0.5 @3xl:flex-row @3xl:items-center @3xl:gap-3">
                            <span className="flex shrink-0 items-center gap-1.5">
                              <Badge>{element.kind ?? '요소'}</Badge>
                              {element.verification === 'PASSED' && <Badge variant="success">확인됨</Badge>}
                              {element.verification === 'FAILED' && <Badge variant="destructive">실패</Badge>}
                              {element.duplicate && (
                                <Badge variant="warning" title="같은 화면에 셀렉터가 같은 요소가 또 있습니다">
                                  겹침
                                </Badge>
                              )}
                              {element.conditional && (
                                <Badge title="목록 반복이나 조건에 따라 보이는 요소입니다">조건부</Badge>
                              )}
                            </span>
                            <code className="min-w-0 break-all text-xs text-foreground">
                              {element.selector ?? '셀렉터를 만들 수 없음'}
                            </code>
                            <span className="shrink-0 font-mono text-[11px] text-muted-foreground @3xl:ml-auto">
                              {element.file.split('/').pop()}
                              {element.line ? `:${element.line}` : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {detail && detail.elements.some((element) => element.selector) && (
                      <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3 @3xl:flex-row @3xl:items-center">
                        {createdJob ? (
                          <p className="text-xs text-foreground">
                            AI 작업 #{createdJob.id} 을 만들었습니다 ({createdJob.specPath}). 생성이 끝나면{' '}
                            <a className="font-semibold text-primary underline" href="/ai-jobs">
                              AI 검토
                            </a>
                            에서 승인해야 프로젝트에 추가됩니다.
                          </p>
                        ) : (
                          <>
                            <Input
                              aria-label="테스트로 확인할 내용"
                              className="@3xl:flex-1"
                              value={instruction}
                              onChange={(e) => setInstruction(e.target.value)}
                              placeholder="무엇을 확인할까요? 비워 두면 주요 요소와 기본 동작을 확인합니다"
                            />
                            <Button size="sm" disabled={busy} onClick={() => generateFor(node.routeKey)}>
                              <Sparkles className="h-3.5 w-3.5" />
                              이 화면으로 테스트 만들기
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                    {detail && detail.edges.filter((edge) => edge.from === node.routeKey).length > 0 && (
                      <p className="mt-3 text-xs text-muted-foreground">
                        이동:{' '}
                        {detail.edges
                          .filter((edge) => edge.from === node.routeKey)
                          .map((edge) => edge.to)
                          .join(', ')}
                      </p>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
