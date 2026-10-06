import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, ArrowDown, Check, Info, Loader2, RefreshCw } from 'lucide-react';
import { api, clearStoredAuth, setStoredAuth } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog';
import type { ServiceHealth, ServiceHealthItem } from '@/types';
import { cn } from '@/lib/utils';
import { BrandLogo } from '@/components/BrandLogo';

const ENV_FILE_PRESENT = import.meta.env.VITE_PLAYOPS_ENV_FILE_PRESENT === 'true';

/** 기본 계정 — 시드 데이터(DataLoader)가 만드는 관리자 계정. */
const DEFAULT_ACCOUNT = { username: 'admin', password: 'admin' };

const HIGHLIGHTS = [
  '말로 설명하면 테스트 시나리오가 만들어집니다.',
  '테스트가 실패하면 AI가 로그를 읽고 수정안을 제안합니다.',
  '실행 이력과 리포트가 프로젝트별로 쌓입니다.',
];

/** 서버에 닿지도 못했을 때 나타나는 메시지들 */
const CONNECTION_ERRORS = [
  'failed to fetch',
  'networkerror',
  'econnrefused',
  'err_connection',
  'internal server error',
  'bad gateway',
  'service unavailable',
  'gateway timeout',
];

/**
 * 실패 원인을 실제 순서대로 판단한다.
 * 예전에는 .env 안내가 맨 앞에 있어서, 서버가 꺼져 있어도 .env 탓으로 보였다.
 */
function getLoginErrorMessage(err: unknown) {
  const baseMessage = err instanceof Error ? err.message : '로그인 실패';
  const lower = baseMessage.toLowerCase();

  if (CONNECTION_ERRORS.some((hint) => lower.includes(hint))) {
    return [
      'API 서버에 연결하지 못했습니다.',
      '왼쪽 서비스 상태에서 API가 빨간색이면 서버가 아직 떠 있지 않은 것입니다.',
      ENV_FILE_PRESENT
        ? '잠시 후 다시 시도하세요.'
        : '개발 중이라면 루트 .env를 만든 뒤 docker compose로 api 컨테이너를 띄우세요.',
    ].join('\n');
  }

  if (lower.includes('unauthorized')) {
    return '사용자명 또는 비밀번호가 올바르지 않습니다.';
  }

  return baseMessage;
}

function webHealth(): ServiceHealthItem {
  return {
    id: 'web',
    name: 'Web',
    status: 'ONLINE',
    target: window.location.origin,
    latencyMs: 0,
    message: 'Web UI is loaded',
  };
}

function offlineService(id: string, name: string, message: string): ServiceHealthItem {
  return {
    id,
    name,
    status: 'OFFLINE',
    target: id === 'api' ? '/api' : id,
    latencyMs: null,
    message,
  };
}

function statusText(status: ServiceHealthItem['status']) {
  return status === 'ONLINE' ? 'Online' : status === 'DEGRADED' ? 'Degraded' : 'Offline';
}

function statusColor(status: ServiceHealthItem['status']) {
  return status === 'ONLINE'
    ? 'bg-success'
    : status === 'DEGRADED'
      ? 'bg-warning'
      : 'bg-destructive';
}

/**
 * 빨간 점만 보여주고 끝내지 않고, 무엇을 하면 되는지 한 줄로 알려준다.
 * 로그인 자체가 API에 걸려 있어서, 여기서 막히면 사용자가 할 수 있는 일이 없기 때문이다.
 */
function troubleshootMessage(services: ServiceHealthItem[]): string | null {
  const broken = services.find((service) => service.status !== 'ONLINE');
  if (!broken) return null;
  switch (broken.id) {
    case 'api':
      return 'API 서버가 응답하지 않습니다. 서버에서 api 컨테이너가 떠 있는지 확인하세요.';
    case 'db':
      return '데이터베이스를 확인할 수 없습니다. postgres 컨테이너 상태를 확인하세요.';
    case 'runner':
      return 'Docker 러너를 확인할 수 없습니다. 테스트 실행이 막힐 수 있습니다.';
    default:
      return `${broken.name} 상태를 확인하세요.`;
  }
}

export function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState<ServiceHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthOpen, setHealthOpen] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    clearStoredAuth();
  }, []);

  const loadHealth = async () => {
    setHealthLoading(true);
    try {
      const next = await api.getServiceHealth();
      setHealth({
        ...next,
        services: [webHealth(), ...next.services],
      });
    } catch (err) {
      setHealth({
        status: 'DEGRADED',
        checkedAt: new Date().toISOString(),
        services: [
          webHealth(),
          offlineService(
            'api',
            'API',
            err instanceof Error ? err.message : 'API health check failed'
          ),
          offlineService('db', 'DB', 'API is unavailable'),
          offlineService('runner', 'Runner', 'API is unavailable'),
        ],
      });
    } finally {
      setHealthLoading(false);
    }
  };

  useEffect(() => {
    loadHealth();
    const timer = window.setInterval(loadHealth, 30000);
    return () => window.clearInterval(timer);
  }, []);

  const signIn = async (id: string, pw: string) => {
    setError('');
    setLoading(true);
    try {
      const res = await api.login(id, pw);
      setStoredAuth({ token: res.token, username: res.username, role: res.role });
      navigate('/projects');
    } catch (err) {
      setError(getLoginErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void signIn(username, password);
  };

  const handleDefaultAccount = () => {
    setUsername(DEFAULT_ACCOUNT.username);
    setPassword(DEFAULT_ACCOUNT.password);
    void signIn(DEFAULT_ACCOUNT.username, DEFAULT_ACCOUNT.password);
  };

  // 좁은 화면에서는 설명 아래 버튼으로 로그인 칸까지 내려간다.
  const scrollToForm = () => {
    usernameRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    usernameRef.current?.focus({ preventScroll: true });
  };

  const services = health?.services ?? [webHealth()];
  const allHealthy = services.every((service) => service.status === 'ONLINE');
  const apiOffline = services.some((service) => service.id === 'api' && service.status !== 'ONLINE');
  const troubleshoot = troubleshootMessage(services);

  return (
    <div className="min-h-screen bg-card">
      <div className="mx-auto grid min-h-screen w-full max-w-[1248px] items-center gap-12 px-6 py-12 lg:grid-cols-[1.1fr_minmax(0,420px)] lg:gap-16 lg:px-16">
        {/* 왼쪽 — 이 제품이 무엇을 하는지, 지금 쓸 수 있는 상태인지 */}
        <section className="space-y-8">
          <div className="flex items-center gap-3">
            <BrandLogo size={40} />
            <span className="text-[19px] font-bold tracking-tight text-foreground">AI-TestOps</span>
          </div>

          <div className="space-y-4">
            <h1 className="text-[28px] font-bold leading-[1.3] tracking-[-0.01em] text-foreground sm:text-[32px] lg:text-[44px]">
              사이트 주소만 알려주면
              <br />
              AI가 테스트를 만들고 실행합니다.
            </h1>
            <p className="max-w-xl text-[17px] leading-[1.55] text-secondary-foreground">
              Playwright 테스트를 직접 짜지 않아도 됩니다. 실패한 테스트는 AI가 로그를 읽고 원인을 찾아
              수정안을 제안하며, 반영 여부는 사람이 승인합니다.
            </p>
          </div>

          <ul className="space-y-3">
            {HIGHLIGHTS.map((text) => (
              <li key={text} className="flex items-start gap-2.5 text-[17px] text-foreground">
                <Check className="mt-1 h-5 w-5 shrink-0 text-primary" />
                <span>{text}</span>
              </li>
            ))}
          </ul>

          <Button type="button" variant="secondary" className="lg:hidden" onClick={scrollToForm}>
            <ArrowDown className="h-4 w-4" />
            로그인하기
          </Button>

          {/* 서비스 상태 */}
          <div className="max-w-xl rounded-xl border border-border bg-card p-4 shadow-1">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-[15px] font-bold text-foreground">
                <Activity className="h-4 w-4 text-muted-foreground" />
                서비스 상태
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() => setHealthOpen(true)}
                  title="서비스 상태 상세"
                  aria-label="서비스 상태 상세"
                >
                  <Info className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:text-muted-foreground"
                  onClick={loadHealth}
                  disabled={healthLoading}
                  title="새로고침"
                  aria-label="서비스 상태 새로고침"
                >
                  <RefreshCw className={cn('h-4 w-4', healthLoading && 'animate-spin')} />
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {services.map((service) => (
                <button
                  key={service.id}
                  type="button"
                  onClick={() => setHealthOpen(true)}
                  className="inline-flex h-9 items-center gap-2 rounded-sm border border-border bg-card px-3 text-[13px] font-bold text-foreground hover:bg-accent"
                  title={service.message ?? service.name}
                >
                  <span className={cn('h-2 w-2 rounded-full', statusColor(service.status))} />
                  {service.name}
                </button>
              ))}
            </div>

            <p
              className={cn(
                'mt-3 border-t border-border pt-3 text-[13px]',
                allHealthy ? 'text-muted-foreground' : 'text-warning'
              )}
            >
              {troubleshoot ?? '모든 서비스가 정상입니다.'}
            </p>
          </div>
        </section>

        {/* 오른쪽 — 로그인 */}
        <section className="w-full">
          <div className="rounded-xl border border-border bg-card p-6 shadow-2">
            <h2 className="text-[24px] font-bold leading-[1.3] text-foreground">로그인</h2>
            <p className="mt-1 text-[15px] text-muted-foreground">계정으로 로그인합니다.</p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">사용자명</Label>
                <Input
                  id="username"
                  ref={usernameRef}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">비밀번호</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
              {error && (
                <p
                  role="alert"
                  className="whitespace-pre-line rounded-sm border border-destructive bg-destructive/10 px-3.5 py-2.5 text-[15px] text-destructive"
                >
                  {error}
                </p>
              )}
              {apiOffline && !error && (
                <p className="rounded-sm border border-warning bg-warning/10 px-3.5 py-2.5 text-[13px] text-warning">
                  API 서버가 응답하지 않습니다. 서버가 뜬 뒤에 로그인할 수 있습니다.
                </p>
              )}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : '로그인'}
              </Button>
            </form>

            <div className="mt-5 border-t border-border pt-5">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleDefaultAccount}
                disabled={loading}
              >
                기본 계정으로 시작
              </Button>
              <p className="mt-2 text-center text-[13px] text-muted-foreground">
                admin / admin 계정으로 바로 들어갑니다.
              </p>
            </div>
          </div>
        </section>
      </div>

      <Dialog open={healthOpen} onOpenChange={setHealthOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>서비스 상태 상세</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {services.map((service) => (
              <div
                key={service.id}
                className="flex items-center gap-3 rounded-sm border border-border px-3 py-3"
              >
                <span className={cn('h-3 w-3 rounded-full', statusColor(service.status))} />
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-foreground">{service.name}</p>
                  <p className="truncate text-[13px] text-muted-foreground">
                    {service.target || service.message || '-'}
                  </p>
                </div>
                <div className="text-right text-[13px]">
                  <p className="font-bold text-foreground">{statusText(service.status)}</p>
                  <p className="text-muted-foreground">
                    {service.latencyMs == null ? '-' : `${service.latencyMs}ms`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
