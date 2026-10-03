import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, KeyRound, Loader2, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { getStoredAuth } from '@/api/client';
import type { AiProviderSettingsResponse, AiUsageSummary } from '@/types';
import { cn } from '@/lib/utils';

type Provider = 'CLAUDE' | 'GPT';

const PROVIDER_LABEL: Record<Provider, string> = {
  CLAUDE: 'Claude (Anthropic)',
  GPT: 'GPT (OpenAI)',
};

const CONSOLE_URL: Record<Provider, string> = {
  CLAUDE: 'https://console.anthropic.com/settings/usage',
  GPT: 'https://platform.openai.com/usage',
};

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function formatUsd(value: number): string {
  return `$${value.toFixed(value < 1 ? 3 : 2)}`;
}

export function AiSettingsPage() {
  const admin = getStoredAuth()?.role === 'ADMIN';
  const [settings, setSettings] = useState<AiProviderSettingsResponse | null>(null);
  const [usage, setUsage] = useState<AiUsageSummary | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // 입력 중인 값 (키는 새로 입력할 때만 보낸다)
  const [claudeKey, setClaudeKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [defaultProvider, setDefaultProvider] = useState<Provider>('CLAUDE');
  const [prices, setPrices] = useState({ ci: '', co: '', oi: '', oo: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [s, u] = await Promise.all([
        admin ? api.admin.getAiProviderSettings() : Promise.resolve(null),
        api.getAiUsage(days),
      ]);
      if (s) {
        setSettings(s);
        setDefaultProvider((s.defaultProvider as Provider) ?? 'CLAUDE');
        setPrices({
          ci: s.claudeInputPrice != null ? String(s.claudeInputPrice) : '',
          co: s.claudeOutputPrice != null ? String(s.claudeOutputPrice) : '',
          oi: s.openaiInputPrice != null ? String(s.openaiInputPrice) : '',
          oo: s.openaiOutputPrice != null ? String(s.openaiOutputPrice) : '',
        });
      }
      setUsage(u);
    } catch (err) {
      setError(err instanceof Error ? err.message : '불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [admin, days]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const toNumber = (value: string) => (value.trim() === '' ? undefined : Number(value));
      const updated = await api.admin.updateAiProviderSettings({
        defaultProvider,
        claudeApiKey: claudeKey.trim() || undefined,
        openaiApiKey: openaiKey.trim() || undefined,
        claudeInputPrice: toNumber(prices.ci),
        claudeOutputPrice: toNumber(prices.co),
        openaiInputPrice: toNumber(prices.oi),
        openaiOutputPrice: toNumber(prices.oo),
      });
      setSettings(updated);
      setClaudeKey('');
      setOpenaiKey('');
      setMessage('저장했습니다.');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const configured: Record<Provider, boolean> = {
    CLAUDE: Boolean(settings?.claudeConfigured),
    GPT: Boolean(settings?.openaiConfigured),
  };

  return (
    <div className="@container space-y-5 p-6">
      <div className="flex flex-col gap-3 @min-[52rem]:flex-row @min-[52rem]:items-center @min-[52rem]:justify-between">
        <div>
          <h2 className="text-[24px] font-bold leading-tight text-foreground">AI 설정</h2>
          <p className="mt-1 text-[15px] text-muted-foreground">
            어떤 AI를 쓸지 고르고, 토큰을 얼마나 썼는지 확인합니다.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          새로고침
        </Button>
      </div>

      {error && (
        <p role="alert" className="rounded-sm border border-destructive bg-destructive/10 px-3.5 py-2.5 text-[15px] text-destructive">
          {error}
        </p>
      )}
      {message && (
        <p className="rounded-sm border border-success bg-success/10 px-3.5 py-2.5 text-[15px] text-success">
          {message}
        </p>
      )}

      {!admin && (
        <p className="flex items-start gap-2 rounded-sm border border-warning bg-warning/10 px-3.5 py-2.5 text-[13px] text-warning">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          키 등록과 공급자 변경은 관리자만 할 수 있습니다. 사용량은 그대로 볼 수 있습니다.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 @min-[60rem]:grid-cols-2">
        {/* 공급자 선택 */}
        <section className="rounded-md border border-border bg-card p-5">
          <h3 className="flex items-center gap-2 text-[17px] font-bold text-foreground">
            <Sparkles className="h-4 w-4 text-ai-accent" />
            사용할 AI
          </h3>
          <p className="mt-1 text-[13px] text-muted-foreground">
            화면에서 따로 고르지 않은 모든 AI 기능이 여기서 정한 공급자로 나갑니다.
          </p>

          <div className="mt-4 space-y-2">
            {(['CLAUDE', 'GPT'] as Provider[]).map((provider) => (
              <button
                key={provider}
                type="button"
                disabled={!admin}
                onClick={() => setDefaultProvider(provider)}
                className={cn(
                  'flex w-full items-center justify-between gap-3 rounded-sm border px-3.5 py-3 text-left transition-colors',
                  defaultProvider === provider
                    ? 'border-primary bg-primary-subtle'
                    : 'border-border bg-card hover:bg-accent',
                  !admin && 'cursor-not-allowed'
                )}
              >
                <span className="flex items-center gap-2.5">
                  <span className={cn(
                    'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
                    defaultProvider === provider ? 'border-primary' : 'border-border-strong'
                  )}>
                    {defaultProvider === provider && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
                  </span>
                  <span>
                    <span className="block text-[15px] font-bold text-foreground">{PROVIDER_LABEL[provider]}</span>
                    <span className="block text-[13px] text-muted-foreground">
                      {configured[provider] ? '키 등록됨' : '키가 등록되지 않아 사용할 수 없습니다'}
                    </span>
                  </span>
                </span>
                {defaultProvider === provider && (
                  <span className="shrink-0 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[12px] font-bold text-primary">
                    사용 중
                  </span>
                )}
              </button>
            ))}
          </div>

          {admin && (
            <div className="mt-5 space-y-3 border-t border-border pt-4">
              <h4 className="flex items-center gap-1.5 text-[15px] font-bold text-foreground">
                <KeyRound className="h-4 w-4 text-muted-foreground" />
                API 키
              </h4>
              <div className="space-y-2">
                <Label htmlFor="claudeKey">
                  Claude 키
                  {settings?.claudeConfigured && (
                    <span className="ml-1 font-normal text-muted-foreground">({settings.claudeMasked} 등록됨)</span>
                  )}
                </Label>
                <Input
                  id="claudeKey"
                  type="password"
                  value={claudeKey}
                  onChange={(e) => setClaudeKey(e.target.value)}
                  placeholder={settings?.claudeConfigured ? '바꿀 때만 입력' : 'sk-ant-...'}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="openaiKey">
                  OpenAI 키
                  {settings?.openaiConfigured && (
                    <span className="ml-1 font-normal text-muted-foreground">({settings.openaiMasked} 등록됨)</span>
                  )}
                </Label>
                <Input
                  id="openaiKey"
                  type="password"
                  value={openaiKey}
                  onChange={(e) => setOpenaiKey(e.target.value)}
                  placeholder={settings?.openaiConfigured ? '바꿀 때만 입력' : 'sk-...'}
                  autoComplete="off"
                />
              </div>
            </div>
          )}
        </section>

        {/* 단가 */}
        <section className="rounded-md border border-border bg-card p-5">
          <h3 className="text-[17px] font-bold text-foreground">단가 (100만 토큰당 USD)</h3>
          <p className="mt-1 text-[13px] text-muted-foreground">
            공급자가 키별 청구액을 조회하는 API를 열어두지 않아 실제 금액은 가져올 수 없습니다.
            여기에 적은 단가로 <strong className="text-foreground">추정치</strong>를 계산합니다.
          </p>

          <div className="mt-4 space-y-4">
            {([
              ['Claude', 'ci', 'co'],
              ['OpenAI', 'oi', 'oo'],
            ] as const).map(([label, inKey, outKey]) => (
              <div key={label} className="space-y-2">
                <Label>{label}</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    className="h-10"
                    inputMode="decimal"
                    disabled={!admin}
                    value={prices[inKey]}
                    onChange={(e) => setPrices((prev) => ({ ...prev, [inKey]: e.target.value }))}
                    placeholder="입력 (예: 3)"
                  />
                  <Input
                    className="h-10"
                    inputMode="decimal"
                    disabled={!admin}
                    value={prices[outKey]}
                    onChange={(e) => setPrices((prev) => ({ ...prev, [outKey]: e.target.value }))}
                    placeholder="출력 (예: 15)"
                  />
                </div>
              </div>
            ))}
          </div>

          {admin && (
            <Button className="mt-5 w-full" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              저장
            </Button>
          )}
        </section>
      </div>

      {/* 사용량 */}
      <section className="rounded-md border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-[17px] font-bold text-foreground">사용량</h3>
            <p className="mt-1 text-[13px] text-muted-foreground">
              우리 서버를 거친 AI 호출만 집계합니다. 실제 청구액과는 다를 수 있습니다.
            </p>
          </div>
          <div className="flex gap-1 rounded-sm border border-border bg-muted p-1">
            {[7, 30, 90].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setDays(value)}
                className={cn(
                  'h-8 rounded-sm px-3 text-[13px] font-bold transition-colors',
                  days === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-card'
                )}
              >
                {value}일
              </button>
            ))}
          </div>
        </div>

        {usage && usage.totalCalls === 0 ? (
          <p className="mt-4 rounded-sm border border-dashed border-border bg-background px-3.5 py-6 text-center text-[15px] text-muted-foreground">
            최근 {usage.days}일 동안 기록된 AI 호출이 없습니다.
          </p>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-1 gap-3 @min-[46rem]:grid-cols-2">
              {usage?.providers.map((row) => (
                <div key={row.provider} className="rounded-sm border border-border bg-background p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[15px] font-bold text-foreground">{PROVIDER_LABEL[row.provider]}</span>
                    <a
                      href={CONSOLE_URL[row.provider]}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[13px] font-bold text-primary hover:underline"
                    >
                      콘솔에서 청구액 보기
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[13px]">
                    <div className="flex gap-1.5"><dt className="text-muted-foreground">호출</dt><dd className="font-bold text-foreground">{row.calls}회</dd></div>
                    <div className="flex gap-1.5"><dt className="text-muted-foreground">실패</dt><dd className="font-bold text-foreground">{row.failedCalls}회</dd></div>
                    <div className="flex gap-1.5"><dt className="text-muted-foreground">입력</dt><dd className="font-bold text-foreground">{formatTokens(row.inputTokens)}</dd></div>
                    <div className="flex gap-1.5"><dt className="text-muted-foreground">출력</dt><dd className="font-bold text-foreground">{formatTokens(row.outputTokens)}</dd></div>
                  </dl>
                  <p className="mt-3 border-t border-border pt-2.5 text-[15px] font-bold text-foreground">
                    {row.priceConfigured ? `추정 ${formatUsd(row.estimatedCostUsd)}` : '단가를 입력하면 추정 비용이 표시됩니다'}
                  </p>
                </div>
              ))}
            </div>

            {usage && usage.features.length > 0 && (
              <div className="mt-4">
                <h4 className="text-[15px] font-bold text-foreground">기능별</h4>
                <ul className="mt-2 divide-y divide-border rounded-sm border border-border">
                  {usage.features.map((feature) => (
                    <li key={feature.feature} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-[13px]">
                      <span className="font-bold text-foreground">{feature.feature}</span>
                      <span className="text-muted-foreground">
                        {feature.calls}회 · 입력 {formatTokens(feature.inputTokens)} · 출력 {formatTokens(feature.outputTokens)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
