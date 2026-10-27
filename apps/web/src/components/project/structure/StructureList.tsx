import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Sparkles } from 'lucide-react';
import { api } from '@/api/client';
import type { SiteMap, SiteMapNodeDetail } from '@/types';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ElementTable } from './ElementTable';

/**
 * 화면 목록 보기. 화면을 펼쳐 요소를 보고, 그 화면 하나로 테스트를 만든다.
 * 좁은 화면의 기본 보기이며, 여러 화면을 이어 경로로 만드는 일은 그래프 보기에서 한다.
 */
export function StructureList({ projectId, siteMap, onError }: {
  projectId: string;
  siteMap: SiteMap;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [openRoute, setOpenRoute] = useState<string | null>(null);
  const [detail, setDetail] = useState<SiteMapNodeDetail | null>(null);
  const [instruction, setInstruction] = useState('');
  const [createdJob, setCreatedJob] = useState<{ id: number; specPath: string } | null>(null);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const { nodes } = siteMap;

  const toggleNode = (routeKey: string) => {
    if (openRoute === routeKey) {
      setOpenRoute(null);
      return;
    }
    setOpenRoute(routeKey);
    setDetail(null);
    setInstruction('');
    setCreatedJob(null);
    setScreenshotUrl(null);
    api.getSiteMapNode(projectId, routeKey).then(setDetail).catch((e: Error) => onError(e.message));
  };

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

  /** 고른 화면의 정보로 테스트 생성을 요청한다. 만들어진 코드는 AI 검토에서 승인해야 반영된다. */
  const generateFor = async (routeKey: string) => {
    const slug = routeKey.replace(/[:*]/g, '').split('/').filter(Boolean).join('-') || 'home';
    const specPath = `tests/${slug}.spec.ts`;
    setBusy(true);
    onError('');
    try {
      const job = await api.aiJobs.createTemplateGenerate(projectId, {
        targetSpecPath: specPath,
        instruction: instruction.trim() || `${routeKey} 화면의 주요 요소가 보이고 기본 동작이 되는지 확인한다.`,
        routeKeys: [routeKey],
      });
      setCreatedJob({ id: job.id, specPath });
    } catch (e) {
      onError(e instanceof Error ? e.message : '요청에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
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
            아직 찾은 화면이 없습니다. 소스 저장소를 연결해 코드를 분석하거나, 사이트 주소로 탐색하세요.
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
                    {node.origin === 'SITE' && (
                      <Badge variant="info" title="실제 사이트를 브라우저로 열어 찾은 화면입니다">
                        사이트 탐색
                      </Badge>
                    )}
                    {node.stale && (
                      <Badge
                        variant="warning"
                        title={node.origin === 'SITE' ? '마지막 탐색에서 열리지 않은 화면입니다' : '마지막 분석에서 코드에 없던 화면입니다'}
                      >
                        {node.origin === 'SITE' ? '탐색에서 사라짐' : '코드에서 사라짐'}
                      </Badge>
                    )}
                  </span>
                  <span
                    className="truncate font-mono text-xs text-muted-foreground"
                    title={node.sourceFile ?? node.url ?? ''}
                  >
                    {node.sourceFile ?? node.url ?? '-'}
                  </span>
                </button>
                {openRoute === node.routeKey && (
                  <div className="border-t border-border bg-muted/30 px-4 py-3">
                    {screenshotUrl && (
                      <img
                        src={screenshotUrl}
                        alt={`${node.routeKey} 화면 스크린샷`}
                        className="mb-3 max-h-64 w-full rounded-md border border-border object-cover object-top"
                      />
                    )}
                    {!detail ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : (
                      <ElementTable elements={detail.elements} origin={node.origin} />
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
    </>
  );
}
