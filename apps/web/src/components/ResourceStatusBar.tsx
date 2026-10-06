import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bell, Cpu, Database, HardDrive, RefreshCw } from 'lucide-react';
import { api } from '@/api/client';
import type { BoardPost, DockerHostResource, RunnerCapacity } from '@/types';
import { cn } from '@/lib/utils';

type ResourceLevel = 'normal' | 'warning' | 'critical';

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
  const [notices, setNotices] = useState<BoardPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const [nextHostResources, nextCapacity, nextNotices] = await Promise.all([
        api.getDockerHostResources().catch(() => null),
        api.getRunnerCapacity().catch(() => null),
        api.getVisibleNotices().catch(() => []),
      ]);
      setHostResources(nextHostResources);
      setCapacity(nextCapacity);
      setNotices(nextNotices);
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
    const activeNotice = notices[0];
    const alertMessage =
      overallLevel === 'critical'
        ? '긴급: 서버 자원 또는 Runner 대기열을 확인하세요'
        : overallLevel === 'warning'
          ? '주의: 자원 사용량이 높아지고 있습니다'
          : '';
    const notice = activeNotice ? `공지: ${activeNotice.title}` : '공지 없음';

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
      notice,
    };
  }, [capacity, hostResources, notices]);

  const items = [
    {
      icon: Cpu,
      label: 'CPU',
      value: formatPercent(resourceState.cpuPercent),
      level: resourceState.cpuLevel,
    },
    {
      icon: Database,
      label: 'Memory',
      value: `${formatPercent(resourceState.memoryPercent)} · ${formatBytes(hostResources?.hostUsedMemoryBytes)} / ${formatBytes(hostResources?.hostTotalMemoryBytes)}`,
      level: resourceState.memoryLevel,
    },
    {
      icon: HardDrive,
      label: 'Storage',
      value: `${formatPercent(resourceState.storagePercent)} · ${formatBytes(hostResources?.storageUsedBytes)} / ${formatBytes(hostResources?.storageTotalBytes)}`,
      level: resourceState.storageLevel,
    },
    {
      icon: AlertTriangle,
      label: 'Runner',
      value: `Active ${capacity?.activeCount ?? '-'} · Queued ${capacity?.queuedCount ?? '-'} · Pool ${capacity?.poolSize ?? '-'}`,
      level: resourceState.queueLevel,
    },
  ];

  return (
    <div className="fixed bottom-0 right-0 z-40" style={{ left: "var(--shell-left, 0px)" }}>
      <div
        className={cn(
          'border-t px-4 py-2.5 backdrop-blur',
          barTone[resourceState.overallLevel]
        )}
      >
        <div className="grid min-w-0 grid-cols-[190px_minmax(360px,1fr)_minmax(260px,520px)] items-center gap-x-5 gap-y-2 text-xs max-xl:grid-cols-[190px_minmax(0,1fr)]">
          <div className="flex min-w-0 items-center gap-2 font-medium">
            <span className={cn('h-2.5 w-2.5 rounded-full', dotTone[resourceState.overallLevel])} />
            <span>리소스 현황</span>
            <span className="text-[11px] font-normal opacity-70">
              {lastCheckedAt ? lastCheckedAt.toLocaleTimeString() : '확인 중'}
            </span>
          </div>

          <div className="grid min-w-0 grid-cols-2 items-center gap-x-5 gap-y-1.5 min-[1500px]:grid-cols-4">
            {items.map(({ icon: Icon, label, value, level }) => (
              <div key={label} className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
                <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
                <span className="text-[11px] opacity-70">{label}</span>
                <span className={cn('min-w-0 truncate font-semibold', valueTone[level])}>{value}</span>
              </div>
            ))}
          </div>

          <div className="flex min-w-0 items-center gap-2 max-xl:col-span-2">
            <Bell className="h-3.5 w-3.5 shrink-0 opacity-70" />
            <div
              className="flex min-w-0 flex-1 items-center gap-2 font-medium"
              title={[hostResources?.message || resourceState.alertMessage, resourceState.notice].filter(Boolean).join(' · ')}
            >
              {(hostResources?.message || resourceState.alertMessage) && (
                <span className="max-w-[45%] shrink-0 truncate text-inherit">
                  {hostResources?.message || resourceState.alertMessage}
                </span>
              )}
              {(hostResources?.message || resourceState.alertMessage) && <span className="shrink-0 opacity-40">·</span>}
              <span className="min-w-0 truncate">{resourceState.notice}</span>
            </div>
            <button
              type="button"
              onClick={loadStatus}
              className="rounded-md p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
              aria-label="리소스 현황 새로고침"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
