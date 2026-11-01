import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronDown, Globe, Info, KeyRound, List, Loader2, Plus, RefreshCw, Settings2, TriangleAlert, Waypoints, X } from 'lucide-react';
import { api } from '@/api/client';
import type { Coverage, Execution, SiteMap, SiteMapNode } from '@/types';
import { useAiEnabled } from '@/lib/aiEnabled';
import {
  LIVE_POLL_MS,
  finishedExecutions,
  isActiveExecution,
  issueItems,
  recorderLink,
  resolveCoverage,
  shouldPoll,
  type StructureSource,
} from '@/lib/coverage';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog';
import { formatEta } from '@/components/project/AnalysisProgress';
import { CoverageSummaryCard } from './structure/CoverageSummaryCard';
import type { SidePanelTab } from './structure/FlowPanel';
import { IssueList, issueActionKey, type IssueActionHandler } from './structure/IssueList';
import { StructureEmptyState } from './structure/StructureEmptyState';
import { StructureList } from './structure/StructureList';
import { GRAPH_MEDIA_QUERY, useMediaQuery } from './structure/useMediaQuery';

// 그래프 시각화 라이브러리(@xyflow/react · dagre · dnd-kit)는 그래프를 열 때만 내려받는다.
const StructureGraph = lazy(() => import('./structure/StructureGraph'));

type StructureView = 'graph' | 'list';

/** 실제 서버에서 읽는 구조 데이터 */
const SERVER_SOURCE: StructureSource = {
  getSiteMap: api.getSiteMap,
  getCoverage: api.getSiteMapCoverage,
  getExecutions: api.getExecutions,
  getSiteMapNode: api.getSiteMapNode,
  runSpec: (projectId, specPath) => api.runTests(projectId, { specPath }),
};

/** 개발 서버에서만: 주소에 ?coverageMock=1 이 있으면 서버 없이 가짜 확인 지도로 화면을 본다. */
function wantsCoverageMock(): boolean {
  return import.meta.env.DEV && new URLSearchParams(window.location.search).get('coverageMock') === '1';
}

type Notice = { tone: 'info' | 'error'; text: string; link?: { to: string; label: string } };

const FRAMEWORK_LABEL: Record<string, string> = {
  NEXT: 'Next.js',
  REACT_ROUTER: 'React Router',
  URL: '사이트 탐색',
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
}

function ViewSwitch({ view, onChange }: {
  view: StructureView;
  onChange: (view: StructureView) => void;
}) {
  const item = (value: StructureView, label: string, icon: ReactNode) => (
    <button
      type="button"
      role="tab"
      aria-selected={view === value}
      onClick={() => onChange(value)}
      className={`inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors ${
        view === value ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <div role="tablist" aria-label="구조 보기" className="inline-flex rounded-full border border-border bg-card p-0.5">
      {item('graph', '그래프', <Waypoints className="h-3.5 w-3.5" />)}
      {item('list', '목록', <List className="h-3.5 w-3.5" />)}
    </div>
  );
}

/**
 * 구조 — 테스트할 앱에 어떤 화면 · 버튼이 있는지 찾아 두는 지도.
 * 찾는 방법은 둘: 대상 사이트 주소를 브라우저로 탐색하거나, 소스 저장소의 코드를 분석한다.
 * 사이트 탐색 화면(origin=SITE)의 셀렉터는 실제 화면에서 그 요소 하나만 가리키는 것을 확인한 값이다.
 *
 * 찾은 화면이 없으면 그래프 대신 시작 카드(StructureEmptyState)만 보인다.
 * 있으면 넓은 화면(1024px 이상)은 그래프 보기, 좁은 화면은 목록 보기가 기본이다. 여러 화면을 이어 경로로
 * 테스트를 만드는 일은 그래프 보기에서만 한다.
 */
export function StructureTab({ projectId, onOpenEnv }: {
  projectId: string;
  /** 프로젝트 환경변수 창을 연다 (막힌 곳의 "로그인 정보 넣기") */
  onOpenEnv?: () => void;
}) {
  const navigate = useNavigate();
  const { active: aiActive } = useAiEnabled();
  const [mockWanted] = useState(wantsCoverageMock);
  const [data, setData] = useState<StructureSource | null>(() => (mockWanted ? null : SERVER_SOURCE));
  const [siteMap, setSiteMap] = useState<SiteMap | null>(null);
  const [rawCoverage, setRawCoverage] = useState<Coverage | null>(null);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const executionsRef = useRef<Execution[]>([]);
  const [autoPlay, setAutoPlay] = useState<{ executionId: number; specPath: string | null; nonce: number } | null>(null);
  const [panelRequest, setPanelRequest] = useState<{ tab: SidePanelTab; nonce: number } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [token, setToken] = useState('');
  const [showSource, setShowSource] = useState(false);
  const wide = useMediaQuery(GRAPH_MEDIA_QUERY);
  const [chosenView, setChosenView] = useState<StructureView | null>(null);
  const view: StructureView = chosenView ?? (wide ? 'graph' : 'list');

  const [addNodeOpen, setAddNodeOpen] = useState(false);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [addRouteKey, setAddRouteKey] = useState('');
  const [addTitle, setAddTitle] = useState('');
  const [addFromRouteKey, setAddFromRouteKey] = useState('');
  const [addEdgeLabel, setEdgeLabel] = useState('');
  const [addAuthRequired, setAddAuthRequired] = useState(false);
  const [addNote, setAddNote] = useState('');
  const [addError, setAddError] = useState('');

  const [loginId, setLoginId] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginPath, setLoginPath] = useState('/');
  const [loginError, setLoginError] = useState('');

  const apply = useCallback((next: SiteMap) => {
    setSiteMap(next);
    setUrl(next.source.url ?? '');
    setBranch(next.source.branch ?? '');
  }, []);

  // 가짜 확인 지도는 개발 서버에서만 불러온다. 이 분기는 운영 빌드에서 통째로 사라진다.
  useEffect(() => {
    if (import.meta.env.DEV && mockWanted) {
      void import('@/lib/coverageMock').then((m) => setData(m.createCoverageMock()));
    }
  }, [mockWanted]);

  const setRuns = useCallback((list: Execution[]) => {
    executionsRef.current = list;
    setExecutions(list);
  }, []);

  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    data.getSiteMap(projectId).then((next) => !cancelled && apply(next)).catch((e: Error) => !cancelled && setError(e.message));
    // 확인 지도 · 실행 목록은 없어도 화면은 그린다(지도 숫자로 상태를 정한다).
    data.getCoverage(projectId).then((next) => !cancelled && setRawCoverage(next)).catch(() => {});
    data.getExecutions(projectId).then((list) => !cancelled && setRuns(list)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId, data, apply, setRuns]);

  /** 지도와 확인 상태를 다시 읽는다. 입력 중인 저장소 주소를 덮어쓰지 않도록 apply 대신 지도만 바꾼다. */
  const refresh = useCallback(async () => {
    if (!data) return;
    const [map, cov] = await Promise.all([
      data.getSiteMap(projectId).catch(() => null),
      data.getCoverage(projectId).catch(() => null),
    ]);
    if (map) setSiteMap(map);
    if (cov) setRawCoverage(cov);
  }, [data, projectId]);

  // 테스트가 실행 중이거나 사이트 탐색(분석) 중이면 5초마다 지도 · 확인 상태 · 실행 목록을 다시 읽는다.
  // 돌던 실행이 끝나면 한 번 더 읽고, 그 흐름을 지도에서 자동 재생한다.
  const running = siteMap?.analysis.status === 'RUNNING';
  const live = shouldPoll({ analysisRunning: Boolean(running), executions });
  const executionRunning = executions.some(isActiveExecution);
  useEffect(() => {
    if (!data || !live) return;
    let cancelled = false;
    const tick = async () => {
      const [list] = await Promise.all([data.getExecutions(projectId).catch(() => null), refresh()]);
      if (cancelled || !list) return;
      const done = finishedExecutions(executionsRef.current, list);
      setRuns(list);
      if (done.length === 0) return;
      await refresh();
      if (cancelled) return;
      setAutoPlay({ executionId: done[0].id, specPath: done[0].specPath, nonce: Date.now() });
    };
    const timer = setInterval(() => void tick(), LIVE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [data, live, projectId, refresh, setRuns]);

  const coverage = useMemo(() => (siteMap ? resolveCoverage(siteMap, rawCoverage) : null), [siteMap, rawCoverage]);
  const nodeByRoute = useMemo(() => new Map((siteMap?.nodes ?? []).map((n) => [n.routeKey, n])), [siteMap]);
  const issues = useMemo(() => (coverage ? issueItems(coverage, nodeByRoute) : []), [coverage, nodeByRoute]);

  /** 막힌 곳 카드의 추천 행동 */
  const handleIssueAction = useCallback<IssueActionHandler>(
    async (item, action) => {
      const { issue, routeKey } = item;
      setNotice(null);
      if (action === 'RECORD_AGAIN') {
        navigate(recorderLink(projectId, routeKey, nodeByRoute.get(routeKey)));
        return;
      }
      if (action === 'SET_LOGIN') {
        if (onOpenEnv) onOpenEnv();
        else setNotice({ tone: 'info', text: '프로젝트 환경변수에 LOGIN_ID 와 LOGIN_PASSWORD 를 넣어 주세요.' });
        return;
      }
      if (!issue.specPath || !data) return;
      const specPath = issue.specPath;
      const title = coverage?.flows.find((f) => f.specPath === specPath)?.title ?? specPath.split('/').pop();
      setBusyKey(issueActionKey(item, action));
      try {
        if (action === 'RERUN') {
          const started = await data.runSpec(projectId, specPath);
          setRuns([started, ...executionsRef.current.filter((e) => e.id !== started.id)]);
          setNotice({ tone: 'info', text: `'${title}' 테스트를 다시 돌리는 중이에요. 끝나면 지도에 바로 반영돼요.` });
        } else if (action === 'FIX_WITH_AI' && issue.executionId != null) {
          const job = await api.aiJobs.create(projectId, {
            failedExecutionId: issue.executionId,
            targetSpecPath: specPath,
            instruction: `'${item.name}' 화면에서 테스트가 막혔습니다: ${issue.message}. 지금 화면에 맞게 테스트를 고쳐 주세요.`,
          });
          setNotice({
            tone: 'info',
            text: `AI 가 '${title}' 테스트 수정안을 만들고 있어요 (작업 #${job.id}). 다 되면 AI 검토에서 승인해 주세요.`,
            link: { to: `/projects/${projectId}/ai-review`, label: 'AI 검토로 이동' },
          });
        }
      } catch (e) {
        setNotice({ tone: 'error', text: e instanceof Error ? e.message : '요청에 실패했습니다.' });
      } finally {
        setBusyKey(null);
      }
    },
    [coverage, navigate, nodeByRoute, onOpenEnv, projectId, setRuns, data]
  );

  /** 상세 패널에서 메모 · 제외를 바꾸면 목록 보기와 같은 데이터를 쓰도록 여기에도 반영한다. */
  const updateNode = useCallback((node: SiteMapNode) => {
    setSiteMap((prev) =>
      prev ? { ...prev, nodes: prev.nodes.map((n) => (n.routeKey === node.routeKey ? node : n)) } : prev
    );
  }, []);

  const removeNodeFromState = useCallback((route: string) => {
    setSiteMap((prev) =>
      prev
        ? {
            ...prev,
            nodes: prev.nodes.filter((n) => n.routeKey !== route),
            edges: prev.edges.filter((e) => e.from !== route && e.to !== route),
          }
        : prev
    );
  }, []);

  const handleAddNode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addRouteKey.trim()) {
      setAddError('화면 경로를 입력하세요.');
      return;
    }
    setBusy(true);
    setAddError('');
    try {
      const next = await api.addSiteMapNode(projectId, {
        routeKey: addRouteKey.trim(),
        title: addTitle.trim() || undefined,
        authRequired: addAuthRequired,
        note: addNote.trim() || undefined,
        fromRouteKey: addFromRouteKey.trim() || undefined,
        edgeLabel: addEdgeLabel.trim() || undefined,
      });
      apply(next);
      setAddNodeOpen(false);
      setAddRouteKey('');
      setAddTitle('');
      setAddFromRouteKey('');
      setEdgeLabel('');
      setAddAuthRequired(false);
      setAddNote('');
    } catch (err) {
      setAddError(err instanceof Error ? err.message : '화면 추가에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleStartLoginAnalysis = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginId.trim() || !loginPassword) {
      setLoginError('아이디와 비밀번호를 모두 입력하세요.');
      return;
    }
    setBusy(true);
    setLoginError('');
    try {
      const next = await api.analyzeSiteMapByUrl(projectId, {
        loginId: loginId.trim(),
        loginPassword: loginPassword,
        loginUrl: loginPath.trim() || undefined,
      });
      apply(next);
      setLoginDialogOpen(false);
      setLoginPassword('');
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : '탐색 시작 실패');
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

  if (!siteMap || !coverage) {
    return error ? (
      <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{error}</p>
    ) : (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const { source, analysis } = siteMap;
  const hasSource = Boolean(source.url) || source.usesProjectRepository;
  const hasSiteUrl = Boolean(source.siteUrl);
  const urlRun = analysis.framework === 'URL';
  const sourceChanged = url.trim() !== (source.url ?? '') || branch.trim() !== (source.branch ?? '') || token !== '';
  const empty = siteMap.nodes.length === 0;

  const findBySite = () => run(() => api.analyzeSiteMapByUrl(projectId));
  const findByCode = () => run(() => api.analyzeSiteMap(projectId));
  const siteTitle = hasSiteUrl
    ? `${source.siteUrl} 를 브라우저로 열어 링크를 따라가며 화면을 찾습니다. 클릭이나 폼 제출은 하지 않으며 최대 3분 걸립니다.`
    : '프로젝트 설정에서 대상 사이트 주소를 먼저 입력하세요';
  // 코드로 찾을 수 없는 이유. 찾을 수 있으면 null.
  const sourceHint = !hasSource
    ? '저장소 설정에서 소스 저장소를 먼저 연결하세요'
    : sourceChanged
      ? '바꾼 저장소 설정을 먼저 저장하세요'
      : null;

  // 마우스를 올리면 보이는 부가 정보. 화면에서는 상태와 시각만 남기고 나머지는 여기로 접어 둔다.
  const statusDetail = [
    analysis.framework ? FRAMEWORK_LABEL[analysis.framework] : null,
    analysis.commitSha ? `커밋 ${analysis.commitSha.slice(0, 8)}` : null,
    analysis.status === 'COMPLETED'
      ? urlRun
        ? '브라우저로 확인 (AI 호출 0회)'
        : analysis.llmCalls === 0
          ? '바뀐 화면 없음 (AI 호출 0회)'
          : `AI 호출 ${analysis.llmCalls}회`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const liveText = executionRunning
    ? '테스트 실행 중… 결과가 지도에 바로 반영됩니다'
    : running
      ? urlRun
        ? '사이트 탐색 중… 찾은 화면이 지도에 하나씩 나타납니다'
        : '화면 분석 중… 끝나면 지도가 새로 그려집니다'
      : null;

  const showBlocked = () => {
    if (view === 'graph') setPanelRequest({ tab: 'issues', nonce: Date.now() });
    viewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="space-y-4">
      {mockWanted && (
        <Badge variant="warning">개발용 가짜 확인 지도 — 서버에 연결하지 않아요 (막힌 흐름을 "다시 실행"해 보세요)</Badge>
      )}

      {!empty && <CoverageSummaryCard summary={coverage.summary} live={liveText} onShowBlocked={showBlocked} />}

      {notice && (
        <div
          role="status"
          className={`flex items-start gap-2 rounded-lg border px-4 py-2.5 text-sm ${
            notice.tone === 'error' ? 'border-destructive/40 bg-destructive/5 text-destructive' : 'border-primary/30 bg-primary-subtle text-foreground'
          }`}
        >
          {notice.tone === 'error' ? <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
          <span className="min-w-0 flex-1">
            {notice.text}
            {notice.link && (
              <Link to={notice.link.to} className="ml-2 font-semibold text-primary hover:underline">
                {notice.link.label} →
              </Link>
            )}
          </span>
          <button type="button" onClick={() => setNotice(null)} aria-label="알림 닫기" className="cursor-pointer text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <section className="rounded-lg border border-border bg-card px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span title={statusDetail || undefined}>
            {analysis.status === 'NONE' && <Badge>분석 전</Badge>}
            {analysis.status === 'RUNNING' && (
              <Badge variant="info">
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                {urlRun
                  ? '사이트 탐색 중'
                  : analysis.screenCount > 0
                    ? `화면 읽는 중 ${analysis.processedCount}/${analysis.screenCount}`
                    : '저장소 받는 중'}
                {analysis.etaSeconds != null && ` · ${formatEta(analysis.etaSeconds)}`}
              </Badge>
            )}
            {analysis.status === 'COMPLETED' && (
              <Badge variant={analysis.partial ? 'warning' : 'success'}>
                {analysis.partial ? (urlRun ? '캔버스 사이트' : '부분 분석') : '완료'} · 화면 {analysis.screenCount}개
              </Badge>
            )}
            {analysis.status === 'FAILED' && <Badge variant="destructive">실패</Badge>}
          </span>
          {analysis.finishedAt && (
            <span className="text-xs text-muted-foreground">마지막 분석 {formatTime(analysis.finishedAt)}</span>
          )}

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setAddError('');
                setAddNodeOpen(true);
              }}
              title="화면 노드를 직접 추가합니다"
            >
              <Plus className="h-4 w-4" /> 화면 추가
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLoginError('');
                setLoginDialogOpen(true);
              }}
              title="로그인 아이디/비밀번호를 입력하고 로그인 후 화면까지 탐색합니다"
            >
              <KeyRound className="h-4 w-4" /> 로그인 탐색
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={showSource}
              aria-controls="structure-source-settings"
              onClick={() => setShowSource((v) => !v)}
            >
              <Settings2 className="h-4 w-4" />
              저장소 설정
              <ChevronDown className={`h-4 w-4 transition-transform ${showSource ? 'rotate-180' : ''}`} />
            </Button>
            <Button variant="outline" size="sm" disabled={busy || running || !hasSiteUrl} title={siteTitle} onClick={findBySite}>
              {running && urlRun ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
              사이트 주소로 찾기
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || running || sourceHint != null}
              title={sourceHint ?? '저장소 코드를 읽어 화면을 찾습니다'}
              onClick={findByCode}
            >
              {running && !urlRun ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              코드로 찾기
            </Button>
          </div>
        </div>

        {showSource && (
          <div id="structure-source-settings" className="mt-3 space-y-3 border-t border-border pt-3">
            <p className="text-xs text-muted-foreground">
              테스트할 앱의 소스 코드가 있는 GitHub 저장소입니다. React Router 와 Next.js 프로젝트를 읽을 수 있습니다.
              {source.usesProjectRepository && ' 따로 연결한 저장소가 없어 지금은 프로젝트 저장소를 읽습니다.'}
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
          </div>
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

        {(analysis.warnings.some((w) => w.includes('로그인')) || (siteMap.nodes.length === 1 && siteMap.nodes[0].routeKey === '/')) && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
            <div className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <div>
                <p className="font-semibold text-foreground">로그인 화면 뒤의 화면들을 탐색하시겠습니까?</p>
                <p className="mt-0.5 text-muted-foreground">
                  로그인 아이디와 비밀번호를 입력하고 탐색을 실행하면 로그인 후 화면(상품 목록, 장바구니 등)까지 자동으로 탐색합니다.
                </p>
              </div>
            </div>
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                setLoginError('');
                setLoginDialogOpen(true);
              }}
              className="border-warning/50 text-warning hover:bg-warning/20"
            >
              <KeyRound className="mr-1 h-3.5 w-3.5" /> 로그인 계정 입력 후 탐색
            </Button>
          </div>
        )}
      </section>

      {empty ? (
        <StructureEmptyState
          projectId={projectId}
          running={Boolean(running)}
          urlRun={urlRun}
          busy={busy}
          siteReady={hasSiteUrl}
          sourceHint={sourceHint}
          onFindBySite={findBySite}
          onFindByCode={findByCode}
          onAddNode={() => {
            setAddError('');
            setAddNodeOpen(true);
          }}
        />
      ) : view === 'graph' ? (
        <div ref={viewRef} className="scroll-mt-4">
        <Suspense
          fallback={
            <div className="flex h-[660px] items-center justify-center rounded-lg border border-border bg-background">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          }
        >
          <StructureGraph
            projectId={projectId}
            siteMap={siteMap}
            coverage={coverage}
            issues={issues}
            onIssueAction={handleIssueAction}
            busyKey={busyKey}
            onNodeUpdated={updateNode}
            onNodeDeleted={removeNodeFromState}
            viewSwitch={<ViewSwitch view={view} onChange={setChosenView} />}
            autoPlay={autoPlay}
            panelRequest={panelRequest}
            live={live}
            loadDetail={data?.getSiteMapNode}
          />
        </Suspense>
        </div>
      ) : (
        <>
          <div className="flex justify-end">
            <ViewSwitch view={view} onChange={setChosenView} />
          </div>
          {issues.length > 0 && (
            <section ref={viewRef} className="scroll-mt-4 rounded-lg border border-border bg-card p-4">
              <h3 className="mb-3 text-sm font-semibold text-foreground">막힌 곳 {issues.length}곳</h3>
              <IssueList items={issues} aiActive={aiActive} onAction={handleIssueAction} busyKey={busyKey} />
            </section>
          )}
          <StructureList
            projectId={projectId}
            siteMap={siteMap}
            onError={setError}
            states={new Map(coverage.nodes.map((n) => [n.routeKey, n.state]))}
            loadDetail={data?.getSiteMapNode}
          />
        </>
      )}

      {/* ── 화면 직접 추가 모달 ── */}
      <Dialog open={addNodeOpen} onOpenChange={setAddNodeOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>화면 직접 추가</DialogTitle>
            <DialogDescription>
              탐색되지 않은 URL 경로나 새 화면 노드를 사이트 맵에 직접 추가합니다.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAddNode} className="space-y-3 py-2">
            <div className="space-y-1">
              <Label htmlFor="add-route-key">화면 경로 <span className="text-destructive">*</span></Label>
              <Input
                id="add-route-key"
                value={addRouteKey}
                onChange={(e) => setAddRouteKey(e.target.value)}
                placeholder="/inventory.html 또는 https://example.com/cart"
                autoFocus
              />
              <p className="text-[11px] text-muted-foreground">URL을 입력하면 내부 경로(/...)로 자동 정규화됩니다.</p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="add-title">화면 이름</Label>
              <Input
                id="add-title"
                value={addTitle}
                onChange={(e) => setAddTitle(e.target.value)}
                placeholder="예: 상품 목록, 장바구니"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="add-from-route">이전 화면에서 연결 (선택)</Label>
              <select
                id="add-from-route"
                value={addFromRouteKey}
                onChange={(e) => setAddFromRouteKey(e.target.value)}
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">연결 안 함 (단독 화면)</option>
                {siteMap.nodes.map((n) => (
                  <option key={n.routeKey} value={n.routeKey}>
                    {n.routeKey} {n.title ? `(${n.title})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {addFromRouteKey && (
              <div className="space-y-1">
                <Label htmlFor="add-edge-label">연결선 이름/동작 (선택)</Label>
                <Input
                  id="add-edge-label"
                  value={addEdgeLabel}
                  onChange={(e) => setEdgeLabel(e.target.value)}
                  placeholder="예: 로그인 버튼, 장바구니 클릭"
                />
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="add-note">메모 (선택)</Label>
              <Input
                id="add-note"
                value={addNote}
                onChange={(e) => setAddNote(e.target.value)}
                placeholder="이 화면의 역할이나 주의사항"
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="add-auth-required"
                checked={addAuthRequired}
                onChange={(e) => setAddAuthRequired(e.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
              <Label htmlFor="add-auth-required" className="cursor-pointer text-xs font-normal">
                로그인이 필요한 화면입니다
              </Label>
            </div>

            {addError && <p className="text-xs text-destructive">{addError}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setAddNodeOpen(false)}>
                취소
              </Button>
              <Button type="submit" size="sm" disabled={busy || !addRouteKey.trim()}>
                {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Plus className="mr-1 h-3 w-3" />}
                추가하기
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── 로그인 계정 설정 & 탐색 모달 ── */}
      <Dialog open={loginDialogOpen} onOpenChange={setLoginDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5">
              <KeyRound className="h-4 w-4 text-primary" />
              로그인 계정 설정 및 사이트 탐색
            </DialogTitle>
            <DialogDescription>
              로그인 계정을 프로젝트에 저장하고, 브라우저가 자동으로 로그인한 뒤 내부 화면들을 탐색합니다.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleStartLoginAnalysis} className="space-y-3 py-2">
            <div className="space-y-1">
              <Label htmlFor="sitemap-login-id">로그인 아이디 / 이메일 <span className="text-destructive">*</span></Label>
              <Input
                id="sitemap-login-id"
                value={loginId}
                onChange={(e) => setLoginId(e.target.value)}
                placeholder="standard_user"
                autoFocus
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="sitemap-login-pw">비밀번호 <span className="text-destructive">*</span></Label>
              <Input
                id="sitemap-login-pw"
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="secret_sauce"
                autoComplete="off"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="sitemap-login-path">로그인 페이지 경로</Label>
              <Input
                id="sitemap-login-path"
                value={loginPath}
                onChange={(e) => setLoginPath(e.target.value)}
                placeholder="/"
              />
              <p className="text-[11px] text-muted-foreground">기본값은 메인 페이지(/)입니다.</p>
            </div>

            {loginError && <p className="text-xs text-destructive">{loginError}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setLoginDialogOpen(false)}>
                취소
              </Button>
              <Button type="submit" size="sm" disabled={busy || !loginId.trim() || !loginPassword}>
                {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Globe className="mr-1 h-3 w-3" />}
                저장하고 탐색 시작
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
