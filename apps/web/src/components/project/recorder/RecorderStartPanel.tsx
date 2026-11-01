import { useState } from 'react';
import { AlertCircle, Loader2, MousePointerClick } from 'lucide-react';
import type { Project, RecorderStartRequest } from '@/types';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { resolveStartUrl } from '@/lib/recorder';

const HOW_TO = [
  '화면을 클릭 · 입력하세요',
  '확인할 곳을 지정하세요',
  '저장하면 테스트 파일이 만들어져요',
];

/**
 * 녹화 시작 화면: 어디서 시작할지 고르고, 어떻게 쓰는지 세 줄로 알려 준다.
 */
export function RecorderStartPanel({
  project,
  initialUrl,
  starting,
  error,
  onStart,
}: {
  project: Project;
  /** 시작 주소 칸에 미리 채울 값 (구조 탭의 "다시 녹화하기") */
  initialUrl?: string;
  starting: boolean;
  error: string;
  onStart: (request: RecorderStartRequest) => void;
}) {
  const [url, setUrl] = useState(initialUrl ?? project.baseUrl ?? '');
  const [useLogin, setUseLogin] = useState(false);

  const hasLoginSetup = Boolean(project.loginSetupSpecPath);
  const resolved = resolveStartUrl(url, project.baseUrl);
  const invalid = url.trim() !== '' && resolved == null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolved || starting) return;
    onStart({ url: resolved, ...(hasLoginSetup && useLogin ? { useLogin: true } : {}) });
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="space-y-1">
        <h2 className="flex items-center gap-1.5 text-lg font-bold text-foreground">
          <MousePointerClick className="h-4 w-4 text-primary" />
          클릭으로 테스트 만들기
        </h2>
        <p className="text-sm text-muted-foreground">
          코드를 쓰지 않고, 사이트를 직접 눌러 보여 주면 그 흐름이 테스트로 저장돼요. AI 없이 동작합니다.
        </p>
      </div>

      <ol className="grid gap-2 sm:grid-cols-3">
        {HOW_TO.map((text, index) => (
          <li key={text} className="flex items-start gap-2 rounded-lg border border-border bg-card p-3">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-xs font-bold text-primary">
              {index + 1}
            </span>
            <span className="text-sm text-foreground">{text}</span>
          </li>
        ))}
      </ol>

      <Card className="p-5">
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="recorder-url">시작할 주소</Label>
            <Input
              id="recorder-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={project.baseUrl ?? 'https://example.com'}
              className="h-10"
              autoComplete="off"
              spellCheck={false}
            />
            {invalid && (
              <p className="text-xs text-destructive">
                주소를 확인해 주세요. 예: https://example.com 또는 /login
              </p>
            )}
            {!project.baseUrl && url.trim() === '' && (
              <p className="text-xs text-muted-foreground">
                프로젝트 설정에 사이트 주소가 없어요. 시작할 주소를 직접 적어 주세요.
              </p>
            )}
          </div>

          {hasLoginSetup && (
            <label className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={useLogin}
                onChange={(e) => setUseLogin(e.target.checked)}
                className="mt-0.5 h-4 w-4 cursor-pointer accent-primary"
              />
              <span>
                로그인한 상태로 시작
                <span className="block text-xs text-muted-foreground">
                  프로젝트의 로그인 선행 시나리오로 만든 세션을 이어서 써요.
                </span>
              </span>
            </label>
          )}

          {project.serverType === 'PROD' && (
            <p className="flex items-center gap-1.5 text-xs text-warning">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              운영 서버예요. 누르고 입력한 내용이 실제 사이트에서 그대로 실행돼요.
            </p>
          )}

          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}

          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={!resolved || starting}>
              {starting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> 시작하는 중...
                </>
              ) : (
                <>
                  <MousePointerClick className="h-3.5 w-3.5" /> 녹화 시작
                </>
              )}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
