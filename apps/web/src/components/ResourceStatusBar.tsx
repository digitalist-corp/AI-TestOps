import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, ChevronDown, ChevronUp, Cpu, Database, HardDrive, RefreshCw } from 'lucide-react';
import { api } from '@/api/client';
import type { DockerHostResource, RunnerCapacity } from '@/types';
import { cn } from '@/lib/utils';

type ResourceLevel = 'normal' | 'warning' | 'critical';

/** 펼침 상태는 이 브라우저에만 기억한다. 저장소를 못 쓰는 환경(사생활 보호 모드 등)이면 기본값(접힘)으로 둔다. */
const OPEN_KEY = 'playops_resource_bar_open';

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

function writeOpen(open: boolean) {
  try {
    localStorage.setItem(OPEN_KEY, open ? '1' : '0');
  } catch {
    // 기억하지 못해도 지금 화면은 그대로 동작한다.
  }
}

function formatBytes(bytes?: number | null): string {
  if (bytes == null || bytes <= 0) return '-';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)}${units[index]}`;
}

function percent(used?: number | null, total?: number | null): number | null {
  if (used == null || total == null || total <= 0) return null;
  return (used / total) * 100;
}

function formatPercent(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${value.toFixed(value >= 10 ? 1 : 2)}%`;
}

function levelForPercent(value?: number | null, warning = 75, critical = 90): ResourceLevel {
  if (value == null) return 'normal';
  if (value >= critical) return 'critical';
  if (value >= warning) return 'warning';
  return 'normal';
}

function worseLevel(left: ResourceLevel, right: ResourceLevel): ResourceLevel {
  const order: Record<ResourceLevel, number> = { normal: 0, warning: 1, critical: 2 };
  return order[right] > order[left] ? right : left;
}

const barTone: Record<ResourceLevel, string> = {
  normal: 'border-border bg-card/95 text-foreground',
  warning: 'border-warning/40 bg-warning/10 text-warning',
  critical: 'border-destructive/40 bg-destructive/10 text-destructive',
};

const dotTone: Record<ResourceLevel, string> = {
  normal: 'bg-success',
  warning: 'bg-warning animate-pulse',
  critical: 'bg-destructive animate-pulse',
};

const valueTone: Record<ResourceLevel, string> = {
  normal: 'text-foreground',
  warning: 'text-warning',
  critical: 'text-destructive',
};

export function ResourceStatusBar() {
  const [hostResources, setHostResources] = useState<DockerHostResource | null>(null);
  const [capacity, setCapacity] = useState<RunnerCapacity | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);
  const [open, setOpen] = useState(readOpen);

  const toggleOpen = () => {
    writeOpen(!open);
    setOpen(!open);
  };

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const [nextHostResources, nextCapacity] = await Promise.all([
        api.getDockerHostResources().catch(() => null),
        api.getRunnerCapacity().catch(() => null),
      ]);
      setHostResources(nextHostResources);
      setCapacity(nextCapacity);
      setLastCheckedAt(new Date());
    } catch {
      setLastCheckedAt(new Date());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    const timer = window.setInterval(loadStatus, 20000);
    return () => window.clearInterval(timer);
  }, [loadStatus]);

  const resourceState = useMemo(() => {
    const cpuPercent = hostResources?.hostCpuLoadPercent ?? null;
    const memoryPercent = percent(hostResources?.hostUsedMemoryBytes, hostResources?.hostTotalMemoryBytes);
    const storagePercent = percent(hostResources?.storageUsedBytes, hostResources?.storageTotalBytes);

    const cpuLevel = levelForPercent(cpuPercent);
    const memoryLevel = levelForPercent(memoryPercent);
    const storageLevel = levelForPercent(storagePercent, 80, 90);
    const queueLevel: ResourceLevel =
      capacity && capacity.queuedCount > 0 && capacity.remainingQueueCapacity <= 0
        ? 'critical'
        : capacity && capacity.queuedCount > 0
          ? 'warning'
          : 'normal';

    const overallLevel = [cpuLevel, memoryLevel, storageLevel, queueLevel].reduce(worseLevel, 'normal');
    const alertMessage =
      overallLevel === 'critical'
        ? '긴급: 서버 자원 또는 러너 대기열을 확인하세요'
        : overallLevel === 'warning'
          ? '주의: 자원 사용량이 높아지고 있습니다'
          : '';

    return {
      cpuPercent,
      memoryPercent,
      storagePercent,
      cpuLevel,
      memoryLevel,
      storageLevel,
      queueLevel,
      overallLevel,
      alertMessage,
    };
  }, [capacity, hostResources]);

  const items = [
    {
      icon: Cpu,
      label: 'CPU',
      value: formatPercent(resourceState.cpuPercent),
      level: resourceState.cpuLevel,
    },
    {
      icon: Database,
      label: '메모리',
      value: `${formatPercent(resourceState.memoryPercent)} · ${formatBytes(hostResources?.hostUsedMemoryBytes)} / ${formatBytes(hostResources?.hostTotalMemoryBytes)}`,
      level: resourceState.memoryLevel,
    },
    {
      icon: HardDrive,
      label: '저장 공간',
      value: `${formatPercent(resourceState.storagePercent)} · ${formatBytes(hostResources?.storageUsedBytes)} / ${formatBytes(hostResources?.storageTotalBytes)}`,
      level: resourceState.storageLevel,
    },
    {
      icon: AlertTriangle,
      label: '러너',
      value: `실행 ${capacity?.activeCount ?? '-'} · 대기 ${capacity?.queuedCount ?? '-'} · 최대 ${capacity?.poolSize ?? '-'}`,
      level: resourceState.queueLevel,
    },
  ];

  const message = hostResources?.message || resourceState.alertMessage || '자원 상태 정상';
  const heading = (
    <div className="flex min-w-0 shrink-0 items-center gap-2 font-medium">
      <span className={cn('h-2.5 w-2.5 rounded-full', dotTone[resourceState.overallLevel])} />
      <span>리소스 현황</span>
      <span className="text-[11px] font-normal opacity-70">
        {lastCheckedAt ? lastCheckedAt.toLocaleTimeString('ko-KR') : '확인 중'}
      </span>
    </div>
  );
  const toggleButton = (
    <button
      type="button"
      onClick={toggleOpen}
      aria-expanded={open}
      aria-label={open ? '리소스 현황 접기' : '리소스 현황 펼치기'}
      title={open ? '접기' : '펼치기'}
      className="rounded-md p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
    >
      {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
    </button>
  );

  // 접힌 상태 — 상태 점과 한 줄 안내만. 경고가 생기면 색이 바뀌어 펼치지 않아도 알 수 있다.
  if (!open) {
    return (
      <div className={cn('shrink-0 border-t px-4 py-1.5 backdrop-blur', barTone[resourceState.overallLevel])}>
        <div className="flex min-w-0 items-center gap-3 text-xs">
          {heading}
          <span className="min-w-0 flex-1 truncate font-medium" title={message}>{message}</span>
          {toggleButton}
        </div>
      </div>
    );
  }

  return (
    <div className="shrink-0">
      <div
        className={cn(
          '@container border-t px-4 py-2.5 backdrop-blur',
          barTone[resourceState.overallLevel]
        )}
      >
        <div className="grid min-w-0 grid-cols-[190px_minmax(360px,1fr)_minmax(260px,520px)] items-center gap-x-5 gap-y-2 text-xs @max-7xl:grid-cols-[190px_minmax(0,1fr)]">
          {heading}

          <div className="grid min-w-0 grid-cols-2 items-center gap-x-5 gap-y-1.5 min-[1500px]:grid-cols-4">
            {items.map(({ icon: Icon, label, value, level }) => (
              <div key={label} className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
                <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
                <span className="text-[11px] opacity-70">{label}</span>
                <span className={cn('min-w-0 truncate font-semibold', valueTone[level])}>{value}</span>
              </div>
            ))}
          </div>

          <div className="flex min-w-0 items-center gap-2 @max-7xl:col-span-2">
            <Activity className="h-3.5 w-3.5 shrink-0 opacity-70" />
            <span
              className="min-w-0 flex-1 truncate font-medium"
              title={message}
            >
              {message}
            </span>
            <button
              type="button"
              onClick={loadStatus}
              className="rounded-md p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
              aria-label="리소스 현황 새로고침"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            </button>
            {toggleButton}
          </div>
        </div>
      </div>
    </div>
  );
}
