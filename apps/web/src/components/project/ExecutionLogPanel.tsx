import { useEffect, useRef, useState } from 'react';
import { getStoredAuth } from '@/api/client';
import type { ExecutionLogChunk, ExecutionStatus } from '@/types';
import { executionStatusLabel } from '@/lib/utils';
import { parseRunProgress } from '@/lib/runProgress';

interface Props {
  executionId: number | null;
  className?: string;
}

export function useExecutionLogStream(executionId: number | null) {
  const [log, setLog] = useState('');
  const [finished, setFinished] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const offsetRef = useRef(0);
  const streamIdRef = useRef(0);

  useEffect(() => {
    if (!executionId) {
      setLog('');
      setFinished(false);
      setStatus(null);
      offsetRef.current = 0;
      return;
    }

    const auth = getStoredAuth();
    let cancelled = false;
    const streamId = streamIdRef.current + 1;
    streamIdRef.current = streamId;
    offsetRef.current = 0;
    setLog('');
    setFinished(false);
    setStatus(null);

    const poll = async () => {
      while (!cancelled) {
        try {
          const res = await fetch(
            `/api/executions/${executionId}/logs?offset=${offsetRef.current}`,
            {
              headers: auth?.token ? { Authorization: `Bearer ${auth.token}` } : {},
              credentials: 'omit',
            }
          );
          if (!res.ok) break;
          const data: ExecutionLogChunk = await res.json();
          if (cancelled || streamIdRef.current !== streamId) break;
          if (data.content) {
            setLog((prev) => prev + data.content);
          }
          offsetRef.current = data.offset;
          if (data.finished) {
            setFinished(true);
            setStatus(data.status);
            break;
          }
        } catch {
          break;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    };

    poll();
    return () => {
      cancelled = true;
    };
  }, [executionId]);

  return { log, finished, status };
}

export function ExecutionLogPanel({ executionId, className }: Props) {
  const { log, finished, status } = useExecutionLogStream(executionId);
  const logContainerRef = useRef<HTMLPreElement>(null);
  const progress = parseRunProgress(log);

  useEffect(() => {
    const container = logContainerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [log]);

  if (!executionId) {
    return (
      <div className={className}>
        <p className="text-sm text-muted-foreground py-8 text-center">실행을 시작하면 로그가 표시됩니다.</p>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-muted-foreground">실행 로그 #{executionId}</span>
        {finished ? (
          <span className="text-xs text-muted-foreground">
            완료 · {executionStatusLabel[status as ExecutionStatus] ?? status}
          </span>
        ) : (
          <span className="text-xs text-primary animate-pulse">
            {progress
              ? `완료 ${progress.done} / ${progress.total} · 성공 ${progress.passed} · 실패 ${progress.failed}`
              : '로그 받는 중...'}
          </span>
        )}
      </div>
      <pre
        ref={logContainerRef}
        className="text-xs bg-sidebar text-green-400 p-4 rounded-lg overflow-auto max-h-[320px] min-h-[200px] font-mono whitespace-pre-wrap"
      >
        {log || '로그 대기 중...'}
      </pre>
    </div>
  );
}
