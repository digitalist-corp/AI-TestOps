import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, Info, Loader2, RefreshCw } from 'lucide-react';
import { api, clearStoredAuth, setStoredAuth } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog';
import type { ServiceHealth, ServiceHealthItem } from '@/types';
import { cn } from '@/lib/utils';
import { BrandLogo } from '@/components/BrandLogo';

const ENV_FILE_PRESENT = import.meta.env.VITE_PLAYOPS_ENV_FILE_PRESENT === 'true';

function getLoginErrorMessage(err: unknown) {
  const baseMessage = err instanceof Error ? err.message : '로그인 실패';

  if (!ENV_FILE_PRESENT) {
    return [
      '로그인 실패',
      '프로젝트 루트에 .env 파일이 없거나 환경변수 PLAYOPS_ENV_FILE_PRESENT=true 설정이 누락되었습니다.',
      '루트 .env를 만든 뒤 docker compose 컨테이너를 재생성하세요.',
    ].join('\n');
  }

  if (
    baseMessage.includes('Failed to fetch') ||
    baseMessage.includes('Internal Server Error') ||
    baseMessage.includes('NetworkError') ||
    baseMessage.includes('ECONNREFUSED')
  ) {
    return [
      '로그인 실패',
      'API 서버가 아직 준비되지 않았거나 연결할 수 없습니다.',
      '잠시 후 다시 시도하거나 http://localhost:8080/actuator/health 상태가 UP인지 확인하세요.',
    ].join('\n');
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

export function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState<ServiceHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthOpen, setHealthOpen] = useState(false);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.login(username, password);
      setStoredAuth({ token: res.token, username: res.username, role: res.role });
      navigate('/projects');
    } catch (err) {
      setError(getLoginErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const services = health?.services ?? [webHealth()];
  const allHealthy = services.every((service) => service.status === 'ONLINE');
  const summaryStatus = allHealthy ? '정상' : '확인 필요';
  const runnerService = services.find((service) => service.id === 'runner');

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 p-4">
      <div className="w-full max-w-md space-y-3">
        <Card className="w-full shadow-2xl">
          <CardHeader className="text-center">
            <BrandLogo size={52} className="mx-auto mb-3 block w-fit" />
            <CardTitle>AI-TestOps</CardTitle>
            <CardDescription>Playwright 테스트 관리 플랫폼</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">사용자명</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
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
                />
              </div>
              {error && (
                <p className="whitespace-pre-line text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : '로그인'}
              </Button>
              <p className="text-xs text-center text-muted-foreground"> 기본 계정: admin / admin </p>
            </form>
          </CardContent>
        </Card>

        <div className="w-full rounded-xl border border-border bg-card/95 p-3 shadow-xl backdrop-blur">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 font-semibold text-foreground">
              <Activity className="h-4 w-4 text-muted-foreground" />
              서비스 상태
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
                onClick={() => setHealthOpen(true)}
                title="서비스 상태 상세"
              >
                <Info className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent disabled:opacity-50"
                onClick={loadHealth}
                disabled={healthLoading}
                title="새로고침"
              >
                <RefreshCw className={cn('h-4 w-4', healthLoading && 'animate-spin')} />
              </button>
            </div>
          </div>

          <div className="mb-3 flex flex-wrap gap-2">
            {services.map((service) => (
              <button
                key={service.id}
                type="button"
                onClick={() => setHealthOpen(true)}
                className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-card px-3 text-xs font-medium text-foreground hover:bg-accent"
                title={service.message ?? service.name}
              >
                <span className={cn('h-2 w-2 rounded-full', statusColor(service.status))} />
                {service.name}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setHealthOpen(true)}
            className="w-full rounded-lg border border-border bg-muted px-3 py-3 text-left hover:bg-accent"
          >
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Runner 상태</span>
              <span
                className={cn(
                  'inline-flex items-center gap-2 font-medium',
                  allHealthy ? 'text-foreground' : 'text-warning'
                )}
              >
                <span
                  className={cn(
                    'h-2 w-2 rounded-full',
                    allHealthy ? 'bg-success' : 'bg-warning'
                  )}
                />
                {runnerService?.message ?? summaryStatus}
              </span>
            </div>
          </button>
        </div>
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
                className="flex items-center gap-3 rounded-lg border border-border px-3 py-3"
              >
                <span className={cn('h-3 w-3 rounded-full', statusColor(service.status))} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground">{service.name}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {service.target || service.message || '-'}
                  </p>
                </div>
                <div className="text-right text-sm">
                  <p className="font-medium text-foreground">{statusText(service.status)}</p>
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
