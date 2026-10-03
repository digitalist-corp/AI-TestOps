import { AlertTriangle, Download, ExternalLink, FileImage, FileText, FileVideo, Loader2 } from 'lucide-react';
import { useState } from 'react';
import type { ArtifactFile, ExecutionCaseResult, ExecutionDetail } from '@/types';
import { api, getStoredAuth } from '@/api/client';
import { Button } from '@/components/ui/Button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog';

interface Props {
  detail: ExecutionDetail | null;
  loading: boolean;
}

const typeIcon: Record<string, typeof FileImage> = {
  report: ExternalLink,
  video: FileVideo,
  screenshot: FileImage,
  trace: ExternalLink,
  log: ExternalLink,
  file: ExternalLink,
};

const textArtifactExtensions = new Set([
  'log',
  'json',
  'txt',
  'xml',
  'csv',
  'md',
  'yaml',
  'yml',
]);

const statusLabel: Record<string, string> = {
  SCHEDULED: '예약됨',
  PENDING: '대기',
  RUNNING: '실행 중',
  CANCEL_REQUESTED: '중단 중',
  CANCELLED: '중단됨',
  PASSED: '성공',
  FAILED: '실패',
  ERROR: '오류',
};

function FailedCaseCard({ result }: { result: ExecutionCaseResult }) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-destructive truncate" title={result.caseTitle ?? undefined}>
            {result.caseTitle ?? '(제목 없음)'}
          </p>
          {result.specPath && (
            <p className="text-xs font-mono text-destructive/70 truncate">{result.specPath}</p>
          )}
        </div>
        {result.durationMs != null && (
          <span className="shrink-0 text-xs text-destructive/60">{(result.durationMs / 1000).toFixed(1)}s</span>
        )}
      </div>
      {result.errorMessage && (
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-sidebar p-2.5 font-mono text-[11px] leading-5 text-red-200">
          {result.errorMessage}
        </pre>
      )}
    </div>
  );
}

export function ResultsTab({ detail, loading }: Props) {
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ artifact: ArtifactFile; content: string } | null>(null);
  const [viewerError, setViewerError] = useState('');
  const token = getStoredAuth()?.token;

  const withToken = (url: string) => {
    if (!token) return url;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}token=${encodeURIComponent(token)}`;
  };

  const isTextArtifact = (artifact: ArtifactFile) => {
    const extension = artifact.path.split('.').pop()?.toLowerCase() ?? '';
    return artifact.type === 'log' || textArtifactExtensions.has(extension);
  };

  const downloadArtifact = async (executionId: number, path: string) => {
    const url = withToken(api.artifactUrl(executionId, path));
    window.location.assign(url);
  };

  const openArtifact = async (executionId: number, artifact: ArtifactFile) => {
    setOpeningPath(artifact.path);
    setViewerError('');
    try {
      if (!isTextArtifact(artifact)) {
        window.open(withToken(api.artifactUrl(executionId, artifact.path)), '_blank', 'noopener,noreferrer');
        return;
      }
      const blob = await api.fetchArtifactBlob(executionId, artifact.path);
      const content = await blob.text();
      setViewer({ artifact, content });
    } catch (err) {
      setViewerError(err instanceof Error ? err.message : '아티팩트를 열지 못했습니다.');
    } finally {
      setOpeningPath(null);
    }
  };

  if (loading && !detail) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!detail) {
    return <p className="text-sm text-muted-foreground py-12 text-center">아직 표시할 실행 결과가 없습니다.</p>;
  }

  const { execution: ex, artifacts, htmlReportUrl, caseResults } = detail;
  const htmlReportUrlWithToken = htmlReportUrl ? withToken(htmlReportUrl) : null;
  const failedCases = caseResults.filter((c) => c.status === 'FAILED');

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-foreground">실행 #{ex.id}</h3>
          {loading && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              업데이트 중
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {ex.caseTitle ?? ex.grepFilter ?? '전체 실행'} ·{' '}
          {ex.startedAt ? new Date(ex.startedAt).toLocaleString('ko-KR') : new Date(ex.createdAt).toLocaleString('ko-KR')}
        </p>
      </div>

      <div className="grid grid-cols-2 @3xl:grid-cols-4 gap-4">
        {[
          ['상태', statusLabel[ex.status] ?? ex.status],
          ['통과', `${ex.passedTests} / ${ex.totalTests}`],
          ['실패', String(ex.failedTests)],
          ['스킵', String(ex.skippedTests)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-border p-4 bg-card">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-lg font-semibold mt-1">{value}</p>
          </div>
        ))}
      </div>

      {failedCases.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <h3 className="font-medium text-foreground">실패한 케이스 ({failedCases.length}건)</h3>
          </div>
          <div className="space-y-2">
            {failedCases.map((c, i) => (
              <FailedCaseCard key={`${c.specPath}-${i}`} result={c} />
            ))}
          </div>
        </div>
      )}

      {ex.errorMessage && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive">
          {ex.errorMessage}
        </div>
      )}

      {htmlReportUrlWithToken && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-foreground">HTML 리포트</h3>
            <a href={htmlReportUrlWithToken} target="_blank" rel="noreferrer">
              <Button size="sm" variant="outline">
                <ExternalLink className="h-4 w-4" />
                새 탭에서 열기
              </Button>
            </a>
          </div>
          <iframe
            src={htmlReportUrlWithToken}
            title="Playwright Report"
            className="w-full h-[480px] border border-border rounded-lg bg-card"
          />
        </div>
      )}

      <div>
        <h3 className="font-medium text-foreground mb-2">아티팩트</h3>
        {artifacts.length === 0 ? (
          <p className="text-sm text-muted-foreground">아티팩트가 없습니다.</p>
        ) : (
          <div className="grid grid-cols-1 @min-[40rem]:grid-cols-2 gap-2 max-h-[280px] overflow-auto">
            {artifacts.map((a) => {
              const Icon = typeIcon[a.type] ?? ExternalLink;
              return (
                <div
                  key={a.path}
                  className="flex items-center gap-2 rounded-md border border-border p-2 text-sm"
                >
                  <button
                    type="button"
                    onClick={() => openArtifact(ex.id, a)}
                    disabled={openingPath === a.path}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:opacity-60"
                  >
                    {openingPath === a.path ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                    ) : isTextArtifact(a) ? (
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate font-mono text-xs">{a.path}</span>
                  </button>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {(a.size / 1024).toFixed(1)}KB
                  </span>
                  <button
                    type="button"
                    onClick={() => downloadArtifact(ex.id, a.path)}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                    title="다운로드"
                  >
                    <Download className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {viewerError && <p className="mt-2 text-sm text-destructive">{viewerError}</p>}
      </div>

      <Dialog open={!!viewer} onOpenChange={(open) => !open && setViewer(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <DialogTitle className="truncate font-mono text-base">{viewer?.artifact.path}</DialogTitle>
                <DialogDescription>
                  {(viewer?.artifact.size ?? 0) > 0 ? `${((viewer?.artifact.size ?? 0) / 1024).toFixed(1)}KB` : '0.0KB'}
                </DialogDescription>
              </div>
              {viewer && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mr-8"
                  onClick={() => downloadArtifact(ex.id, viewer.artifact.path)}
                >
                  <Download className="h-4 w-4" />
                  다운로드
                </Button>
              )}
            </div>
          </DialogHeader>
          <pre className="max-h-[70vh] overflow-auto rounded-md border border-border bg-sidebar p-4 text-xs leading-5 text-sidebar-foreground">
            <code>{viewer?.content}</code>
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
