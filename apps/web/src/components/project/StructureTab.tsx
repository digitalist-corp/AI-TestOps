import { Suspense, lazy, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Globe, GitBranch, List, Loader2, Network, RefreshCw, TriangleAlert, Waypoints } from 'lucide-react';
import { api } from '@/api/client';
import type { SiteMap, SiteMapNode } from '@/types';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { formatEta } from '@/components/project/AnalysisProgress';
import { StructureList } from './structure/StructureList';
import { GRAPH_MEDIA_QUERY, useMediaQuery } from './structure/useMediaQuery';

// 그래프 시각화 라이브러리(@xyflow/react · dagre · dnd-kit)는 그래프를 열 때만 내려받는다.
const StructureGraph = lazy(() => import('./structure/StructureGraph'));

type StructureView = 'graph' | 'list';

const POLL_INTERVAL_MS = 2000;

const FRAMEWORK_LABEL: Record<string, string> = {
  NEXT: 'Next.js',
  REACT_ROUTER: 'React Router',
  URL: '사이트 탐색',
};

function formatTime(iso: string | null) {
  return iso ? new Date(iso).toLocaleString('ko-KR') : '-';
}

/** square: 그래프 콘솔 툴바 안에 넣을 때 콘솔의 각진 모양에 맞춘다 */
function ViewSwitch({ view, onChange, square = false }: {
  view: StructureView;
  onChange: (view: StructureView) => void;
  square?: boolean;
}) {
  const round = square ? 'rounded-[2px]' : 'rounded-full';
  const item = (value: StructureView, label: string, icon: ReactNode) => (
    <button
      type="button"
      role="tab"
      aria-selected={view === value}
      onClick={() => onChange(value)}
      className={`inline-flex h-7 cursor-pointer items-center gap-1.5 ${round} px-3 text-xs font-semibold transition-colors ${
        view === value ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <div role="tablist" aria-label="구조 보기" className={`inline-flex ${round} border border-border bg-card p-0.5`}>
      {item('graph', '그래프', <Waypoints className="h-3.5 w-3.5" />)}
      {item('list', '목록', <List className="h-3.5 w-3.5" />)}
    </div>
  );
}

/**
 * 화면 구조. 소스 저장소를 연결해 코드에서 찾거나, 저장소 없이 대상 사이트 주소를 브라우저로 탐색해 찾는다.
 * 사이트 탐색 화면(origin=SITE)의 셀렉터는 실제 화면에서 그 요소 하나만 가리키는 것을 확인한 값이다.
 *
 * 넓은 화면(1024px 이상)은 그래프 보기, 좁은 화면은 목록 보기가 기본이다. 여러 화면을 이어 경로로
 * 테스트를 만드는 일은 그래프 보기에서만 한다.
 */
export function StructureTab({ projectId }: { projectId: string }) {
  const [siteMap, setSiteMap] = useState<SiteMap | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [token, setToken] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wide = useMediaQuery(GRAPH_MEDIA_QUERY);
  const [chosenView, setChosenView] = useState<StructureView | null>(null);
  const view: StructureView = chosenView ?? (wide ? 'graph' : 'list');

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

  /** 상세 패널에서 메모 · 제외를 바꾸면 목록 보기와 같은 데이터를 쓰도록 여기에도 반영한다. */
  const updateNode = useCallback((node: SiteMapNode) => {
    setSiteMap((prev) =>
      prev ? { ...prev, nodes: prev.nodes.map((n) => (n.routeKey === node.routeKey ? node : n)) } : prev
    );
  }, []);

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

  const { source, analysis } = siteMap;
  const hasSource = Boolean(source.url) || source.usesProjectRepository;
  const hasSiteUrl = Boolean(source.siteUrl);
  const urlRun = analysis.framework === 'URL';
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
          소스 저장소가 없으면 아래 "사이트 주소로 탐색"으로 대상 사이트를 직접 열어 화면을 찾을 수 있습니다.
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
                {urlRun
                  ? '브라우저로 확인 (AI 호출 0회)'
                  : analysis.llmCalls === 0
                    ? '바뀐 화면 없음 (AI 호출 0회)'
                    : `AI 호출 ${analysis.llmCalls}회`}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy || running || !hasSiteUrl}
              title={hasSiteUrl ? `${source.siteUrl} 를 브라우저로 열어 화면을 찾습니다` : '프로젝트 설정에서 대상 사이트 주소를 먼저 입력하세요'}
              onClick={() => run(() => api.analyzeSiteMapByUrl(projectId))}
            >
              {running && urlRun ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
              사이트 주소로 탐색
            </Button>
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
              {analysis.status === 'NONE' ? '코드 분석 시작' : '코드 다시 분석'}
            </Button>
          </div>
        </div>

        {analysis.status === 'RUNNING' && (
          <p className="mt-3 text-xs text-muted-foreground">
            {urlRun
              ? '대상 사이트를 브라우저로 열어 같은 호스트의 링크를 따라가며 화면마다 버튼 · 링크 · 입력칸을 모으고, 셀렉터가 실제로 그 요소 하나만 가리키는지 확인합니다. 클릭이나 폼 제출은 하지 않으며 최대 3분 걸립니다.'
              : '저장소를 받아 화면을 찾고, 화면마다 AI 가 코드를 읽어 요소를 뽑습니다. 화면 하나에 10초쯤 걸리고, 지난번과 코드가 같은 화면은 건너뜁니다.'}
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

      {view === 'graph' ? (
        <Suspense
          fallback={
            <div className="flex h-[660px] items-center justify-center rounded-[4px] border border-[#2a3a4c] bg-[#090d12]">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          }
        >
          <StructureGraph
            projectId={projectId}
            siteMap={siteMap}
            onNodeUpdated={updateNode}
            viewSwitch={<ViewSwitch view={view} onChange={setChosenView} square />}
          />
        </Suspense>
      ) : (
        <>
          <div className="flex justify-end">
            <ViewSwitch view={view} onChange={setChosenView} />
          </div>
          <StructureList projectId={projectId} siteMap={siteMap} onError={setError} />
        </>
      )}
    </div>
  );
}
