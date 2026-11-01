import { useEffect, useRef, useState } from 'react';
import { Check, CheckCircle2, Code2, Copy, Loader2, Play, Save, SquareX } from 'lucide-react';
import { ApiError, type RecorderApi } from '@/api/client';
import type { RecordedStep } from '@/types';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { normalizeSpecPath, stepsSignature } from '@/lib/recorder';

type Saved = { specPath: string; title: string; signature: string };

/** 클립보드에 복사. 권한이 막힌 환경에서는 임시 입력칸으로 대신한다. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      return document.execCommand('copy');
    } finally {
      document.body.removeChild(area);
    }
  }
}

/**
 * 녹화 화면 아래줄: 코드 보기 · 테스트 이름 · 저장 경로 · 저장 · 녹화 끝내기.
 * 저장하면 프로젝트 파일로 바로 들어가고(AI 승인 없음), 이어서 보기 · 실행으로 갈 수 있다.
 */
export function RecorderSaveBar({
  rec,
  projectId,
  sessionId,
  steps,
  disabled,
  onSaved,
  onOpenTests,
  onRun,
  onEnd,
}: {
  rec: RecorderApi;
  projectId: string;
  sessionId: string;
  steps: RecordedStep[];
  /** 동작 중이거나 세션이 끝나서 서버를 부를 수 없는 상태 */
  disabled: boolean;
  onSaved: () => void;
  onOpenTests: () => void;
  onRun: (specPath: string, title: string) => void;
  onEnd: (hasUnsaved: boolean) => void;
}) {
  const [title, setTitle] = useState('');
  const [specPath, setSpecPath] = useState('');
  const pathTouched = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState<Saved | null>(null);

  const [codeOpen, setCodeOpen] = useState(false);
  const [code, setCode] = useState('');
  const [codeLoading, setCodeLoading] = useState(false);
  const [codeError, setCodeError] = useState('');
  const [copied, setCopied] = useState(false);

  const signature = stepsSignature(steps);
  const hasSteps = steps.length > 0;
  const changedSinceSave = saved != null && saved.signature !== signature;
  const hasUnsaved = hasSteps && (saved == null || changedSinceSave);

  /** 서버가 제안하는 저장 경로를 받아 채운다. 사람이 경로를 고친 뒤에는 건드리지 않는다. */
  const suggestPath = async (forTitle: string) => {
    if (pathTouched.current) return;
    try {
      const res = await rec.code(projectId, sessionId, forTitle.trim() || undefined);
      if (!pathTouched.current) setSpecPath(res.specPath);
    } catch {
      // 제안을 못 받아도 직접 적으면 된다
    }
  };

  // 첫 단계가 생기면 한 번 제안을 받아 둔다.
  const suggested = useRef(false);
  useEffect(() => {
    if (!hasSteps || suggested.current || disabled) return;
    suggested.current = true;
    void suggestPath(title);
    // 제안은 첫 단계가 생길 때 한 번만 받는다 (이후엔 이름 입력칸을 벗어날 때 갱신)
  }, [hasSteps, disabled]);

  const openCode = async () => {
    setCodeOpen(true);
    setCodeLoading(true);
    setCodeError('');
    setCopied(false);
    try {
      const res = await rec.code(projectId, sessionId, title.trim() || undefined);
      setCode(res.code);
    } catch (err) {
      setCode('');
      setCodeError(err instanceof Error ? err.message : '코드를 불러오지 못했어요.');
    } finally {
      setCodeLoading(false);
    }
  };

  const copyCode = async () => {
    if (await copyText(code)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const save = async () => {
    const path = normalizeSpecPath(specPath);
    if (!path) {
      setSaveError('저장 경로를 확인해 주세요. 예: tests/recorded/login.spec.ts');
      return;
    }
    setSpecPath(path);
    setSaving(true);
    setSaveError('');
    try {
      const res = await rec.save(projectId, sessionId, { specPath: path, title: title.trim() || undefined });
      setSaved({ specPath: res.specPath, title: title.trim(), signature });
      onSaved();
    } catch (err) {
      setSaveError(
        err instanceof ApiError && err.status === 409
          ? '같은 경로에 이미 파일이 있어요. 경로를 바꿔서 다시 저장해 주세요.'
          : err instanceof Error
            ? err.message
            : '저장하지 못했어요.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="grid gap-3 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">테스트 이름</span>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => hasSteps && void suggestPath(title)}
            placeholder="예: 로그인하면 대시보드가 보인다"
            className="h-10"
            autoComplete="off"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">저장 경로</span>
          <Input
            value={specPath}
            onChange={(e) => {
              pathTouched.current = true;
              setSpecPath(e.target.value);
            }}
            placeholder="tests/recorded/login.spec.ts"
            className="h-10 font-mono text-[13px]"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      </div>

      {saveError && (
        <p role="alert" className="text-xs text-destructive">
          {saveError}
        </p>
      )}

      {saved && (
        <div
          className="space-y-2 rounded-md border border-success/30 bg-success/10 p-3 text-sm"
          aria-live="polite"
        >
          <p className="flex items-center gap-1.5 font-medium text-success">
            <CheckCircle2 className="h-4 w-4" />
            테스트 파일로 저장했어요
            <span className="break-all font-mono text-xs font-normal">{saved.specPath}</span>
          </p>
          {changedSinceSave && (
            <p className="text-xs text-muted-foreground">
              저장한 뒤에 단계를 바꿨어요. 바뀐 내용을 저장하려면 다른 경로로 저장해 주세요.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="xs" onClick={onOpenTests}>
              테스트 탭에서 보기
            </Button>
            <Button type="button" size="xs" onClick={() => onRun(saved.specPath, saved.title)}>
              <Play className="h-3 w-3" /> 바로 실행
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="outline" size="sm" onClick={openCode} disabled={disabled || !hasSteps}>
          <Code2 className="h-3.5 w-3.5" /> 코드 보기
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onEnd(hasUnsaved)}>
            <SquareX className="h-3.5 w-3.5" /> 녹화 끝내기
          </Button>
          <Button type="button" size="sm" onClick={save} disabled={disabled || saving || !hasSteps || !specPath.trim()}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            저장
          </Button>
        </div>
      </div>

      <Dialog open={codeOpen} onOpenChange={setCodeOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>만들어진 테스트 코드</DialogTitle>
            <DialogDescription>
              저장하면 이 코드가 <span className="font-mono">{specPath || '테스트 파일'}</span> 로 들어가요.
            </DialogDescription>
          </DialogHeader>
          {codeLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> 코드를 만드는 중...
            </div>
          ) : codeError ? (
            <p role="alert" className="py-6 text-sm text-destructive">
              {codeError}
            </p>
          ) : (
            <pre className="max-h-[60vh] overflow-auto rounded-md border border-border bg-muted p-3 font-mono text-xs leading-5 text-foreground">
              {code}
            </pre>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={copyCode} disabled={!code}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? '복사했어요' : '복사'}
            </Button>
            <Button type="button" size="sm" onClick={() => setCodeOpen(false)}>
              닫기
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
