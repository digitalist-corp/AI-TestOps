import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Container, RefreshCw, Save, Server, Settings2, Trash2, XCircle } from 'lucide-react';
import { api } from '@/api/client';
import type { DockerHostResource, DockerStatus, Project, RunnerCapacity, RunnerCapacityFormData, RunnerContainer } from '@/types';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

const dockerStatusLabel: Record<DockerStatus, string> = {
  RUNNING: '실행 중',
  STOPPED: '중지',
  ERROR: '오류',
  NOT_CONFIGURED: '미설정',
};

const dockerStatusColor: Record<DockerStatus, string> = {
  RUNNING: 'bg-success/10 text-success',
  STOPPED: 'bg-muted text-muted-foreground',
  ERROR: 'bg-destructive/10 text-destructive',
  NOT_CONFIGURED: 'bg-muted text-muted-foreground',
};

const serverTypeLabel: Record<Project['serverType'], string> = {
  DEV: '개발',
  TEST: '테스트',
  PROD: '운영',
};

const containerTypeLabel: Record<string, string> = {
  DB: 'DB',
  PLAYOPS: 'AI-TestOps',
  RUNNER: 'Runner',
  BUILD: 'Build',
  OTHER: 'Other',
};

const containerTypeColor: Record<string, string> = {
  DB: 'bg-success/10 text-success',
  PLAYOPS: 'bg-ai-accent/10 text-ai-accent',
  RUNNER: 'bg-primary/10 text-primary',
  BUILD: 'bg-warning/10 text-warning',
  OTHER: 'bg-muted text-muted-foreground',
};

const containerTypeOrder: Record<string, number> = {
  DB: 0,
  PLAYOPS: 1,
  RUNNER: 2,
  BUILD: 3,
  OTHER: 4,
};

const byteUnits: Record<string, number> = {
  B: 1,
  kB: 1000,
  MB: 1000 ** 2,
  GB: 1000 ** 3,
  TB: 1000 ** 4,
  KiB: 1024,
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
  TiB: 1024 ** 4,
};

function parsePercent(value: string): number {
  const parsed = Number(value.replace('%', '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseByteValue(value: string): number {
  const match = value.trim().match(/^([\d.]+)\s*([KMGT]?i?B)$/);
  if (!match) return 0;
  return Number(match[1]) * (byteUnits[match[2]] ?? 1);
}

function parseFirstByteValue(value: string): number {
  return parseByteValue(value.split('/')[0] ?? '');
}

function parseIoPair(value: string): { read: number; write: number } {
  const [left = '', right = ''] = value.split('/');
  return {
    read: parseByteValue(left),
    write: parseByteValue(right),
  };
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '-';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)}${units[index]}`;
}

function formatBytePair(used?: number | null, total?: number | null): string {
  if (used == null || total == null || total <= 0) return '-';
  return `${formatBytes(used)} / ${formatBytes(total)}`;
}

function formatPercent(value: number): string {
  return `${value.toFixed(value >= 10 ? 1 : 2)}%`;
}

function formatDockerCreatedAt(value: string): string {
  if (!value) return '-';
  const normalized = value.replace(/\s\+\d{4}\sUTC$/, 'Z').replace(' ', 'T');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

const defaultCapacityDraft: RunnerCapacityFormData = {
  autoScaleEnabled: true,
  baseConcurrency: 2,
  maxConcurrency: 4,
  queueCapacity: 20,
  scaleDownIdleSeconds: 60,
};

export function RunnerContainersPage() {
  const [containers, setContainers] = useState<RunnerContainer[]>([]);
  const [capacity, setCapacity] = useState<RunnerCapacity | null>(null);
  const [hostResources, setHostResources] = useState<DockerHostResource | null>(null);
  const [capacityDraft, setCapacityDraft] = useState<RunnerCapacityFormData>(defaultCapacityDraft);
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [capacitySaving, setCapacitySaving] = useState(false);
  const [capacityMessage, setCapacityMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadContainers = useCallback(async () => {
    setLoading(true);
    try {
      setContainers(await api.getDockerContainers());
    } catch {
      setContainers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRunnerCapacity = useCallback(async () => {
    const next = await api.getRunnerCapacity();
    setCapacity(next);
    setCapacityDraft({
      autoScaleEnabled: next.autoScaleEnabled,
      baseConcurrency: next.baseConcurrency,
      maxConcurrency: next.maxConcurrency,
      queueCapacity: next.queueCapacity,
      scaleDownIdleSeconds: next.scaleDownIdleSeconds,
    });
  }, []);

  const loadHostResources = useCallback(async () => {
    const next = await api.getDockerHostResources();
    setHostResources(next);
  }, []);

  useEffect(() => {
    loadContainers();
    loadRunnerCapacity().catch(() => setCapacity(null));
    loadHostResources().catch(() => setHostResources(null));
  }, [loadContainers, loadRunnerCapacity, loadHostResources]);

  const counts = useMemo(() => {
    return containers.reduce(
      (acc, container) => {
        acc.total += 1;
        if (container.containerType === 'RUNNER') acc.runner += 1;
        if (container.containerType === 'DB') acc.db += 1;
        if (container.containerType === 'PLAYOPS') acc.playops += 1;
        if (container.containerType === 'OTHER') acc.other += 1;
        if (container.dockerStatus === 'RUNNING') acc.running += 1;
        return acc;
      },
      { total: 0, running: 0, db: 0, runner: 0, playops: 0, other: 0 }
    );
  }, [containers]);

  const sortedContainers = useMemo(() => {
    return [...containers].sort((a, b) => {
      const orderA = containerTypeOrder[a.containerType] ?? containerTypeOrder.OTHER;
      const orderB = containerTypeOrder[b.containerType] ?? containerTypeOrder.OTHER;
      if (orderA !== orderB) return orderA - orderB;
      if (a.dockerStatus !== b.dockerStatus) {
        return a.dockerStatus === 'RUNNING' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }, [containers]);

  const totals = useMemo(() => {
    return containers.reduce(
      (acc, container) => {
        acc.cpuPercent += parsePercent(container.cpuPercent);
        acc.memoryBytes += parseFirstByteValue(container.memoryUsage);
        const net = parseIoPair(container.netIo);
        const block = parseIoPair(container.blockIo);
        acc.netReadBytes += net.read;
        acc.netWriteBytes += net.write;
        acc.blockReadBytes += block.read;
        acc.blockWriteBytes += block.write;
        return acc;
      },
      {
        cpuPercent: 0,
        memoryBytes: 0,
        netReadBytes: 0,
        netWriteBytes: 0,
        blockReadBytes: 0,
        blockWriteBytes: 0,
      }
    );
  }, [containers]);

  const dockerDiskUsage = useMemo(() => {
    const usageByType = new Map<string, string>();
    hostResources?.dockerDiskUsage.forEach((item) => usageByType.set(item.type, item.size));
    return {
      images: usageByType.get('Images') ?? '-',
      containers: usageByType.get('Containers') ?? '-',
      volumes: usageByType.get('Local Volumes') ?? '-',
      buildCache: usageByType.get('Build Cache') ?? '-',
    };
  }, [hostResources]);

  const refreshRunnerState = async () => {
    setLoading(true);
    try {
      await api.reconcileRunnerContainers();
      setContainers(await api.getDockerContainers());
      await loadRunnerCapacity();
      await loadHostResources();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Runner 상태 재연결 실패');
    } finally {
      setLoading(false);
    }
  };

  const refreshDockerOverview = () => {
    loadContainers();
    loadHostResources().catch(() => setHostResources(null));
  };

  const updateCapacityDraft = (key: keyof RunnerCapacityFormData, value: number | boolean) => {
    setCapacityMessage(null);
    setCapacityDraft((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'baseConcurrency' && typeof value === 'number' && next.maxConcurrency < value) {
        next.maxConcurrency = value;
      }
      return next;
    });
  };

  const saveRunnerCapacity = async () => {
    setCapacitySaving(true);
    setCapacityMessage(null);
    try {
      const next = await api.updateRunnerCapacity(capacityDraft);
      setCapacity(next);
      setCapacityDraft({
        autoScaleEnabled: next.autoScaleEnabled,
        baseConcurrency: next.baseConcurrency,
        maxConcurrency: next.maxConcurrency,
        queueCapacity: next.queueCapacity,
        scaleDownIdleSeconds: next.scaleDownIdleSeconds,
      });
      setCapacityMessage({ type: 'success', text: 'Runner capacity 설정을 저장했습니다.' });
      window.setTimeout(() => {
        setCapacityMessage((current) => current?.type === 'success' ? null : current);
      }, 3000);
    } catch (err) {
      setCapacityMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Runner capacity 설정 저장 실패',
      });
    } finally {
      setCapacitySaving(false);
    }
  };

  const cleanupUnusedRunners = async () => {
    const ok = confirm('DB 프로젝트에 연결되지 않았거나 Docker Runner가 꺼진 미사용 Runner 컨테이너를 삭제하시겠습니까?');
    if (!ok) return;
    setLoading(true);
    try {
      const result = await api.cleanupRunnerContainers([], true);
      alert(`삭제 ${result.removed.length}건, 건너뜀 ${result.skipped.length}건`);
      setSelectedNames(new Set());
      setContainers(await api.getDockerContainers());
      await loadHostResources();
    } catch (err) {
      alert(err instanceof Error ? err.message : '미사용 Runner 삭제 실패');
    } finally {
      setLoading(false);
    }
  };

  const cleanupSelectedRunners = async () => {
    const names = [...selectedNames];
    if (names.length === 0) return;
    const ok = confirm(`선택한 Runner 컨테이너 ${names.length}개를 삭제하시겠습니까? AI-TestOps/Other 컨테이너는 삭제 대상에서 제외됩니다.`);
    if (!ok) return;
    setLoading(true);
    try {
      const result = await api.cleanupRunnerContainers(names, false);
      alert(`삭제 ${result.removed.length}건, 건너뜀 ${result.skipped.length}건`);
      setSelectedNames(new Set());
      setContainers(await api.getDockerContainers());
      await loadHostResources();
    } catch (err) {
      alert(err instanceof Error ? err.message : '선택 Runner 삭제 실패');
    } finally {
      setLoading(false);
    }
  };

  const toggleSelection = (name: string, selected: boolean) => {
    setSelectedNames((prev) => {
      const next = new Set(prev);
      if (selected) {
        next.add(name);
      } else {
        next.delete(name);
      }
      return next;
    });
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Runner 컨테이너 관리</h2>
          <p className="text-sm text-muted-foreground mt-1">Runner, AI-TestOps 자체 컨테이너, 기타 Docker 컨테이너 상태를 확인합니다.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={refreshDockerOverview} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            조회
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={refreshRunnerState} disabled={loading}>
            재연결
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={cleanupUnusedRunners} disabled={loading}>
            미사용 Runner 삭제
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={cleanupSelectedRunners} disabled={loading || selectedNames.size === 0}>
            <Trash2 className="h-4 w-4" />
            선택 Runner 삭제
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card px-4 py-3">
        <div className="mb-2 flex items-center gap-2">
          <Container className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Runner 현황</h3>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          {[
            ['전체', counts.total],
            ['실행 중', counts.running],
            ['Runner', counts.runner],
            ['AI-TestOps', counts.playops],
            ['DB', counts.db],
            ['Other', counts.other],
            ['CPU', formatPercent(totals.cpuPercent)],
            ['Memory', formatBytes(totals.memoryBytes)],
            ['Net I/O', `${formatBytes(totals.netReadBytes)} / ${formatBytes(totals.netWriteBytes)}`],
            ['Block I/O', `${formatBytes(totals.blockReadBytes)} / ${formatBytes(totals.blockWriteBytes)}`],
          ].map(([label, value]) => (
            <div key={label} className="flex items-baseline gap-1.5 whitespace-nowrap">
              <span className="text-xs text-muted-foreground">{label}</span>
              <span className="font-semibold text-foreground">{value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card px-4 py-3">
        <div className="mb-2 flex items-center gap-2">
          <Server className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">호스트/도커 현황</h3>
          {hostResources?.dockerAvailable === false && (
            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning">
              Docker 확인 필요
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          {[
            ['Host CPU', hostResources?.hostCpuLoadPercent != null ? formatPercent(hostResources.hostCpuLoadPercent) : '-'],
            ['Host Memory', formatBytePair(hostResources?.hostUsedMemoryBytes, hostResources?.hostTotalMemoryBytes)],
            ['Storage', formatBytePair(hostResources?.storageUsedBytes, hostResources?.storageTotalBytes)],
            ['Docker CPU', hostResources?.dockerCpuCount ? `${hostResources.dockerCpuCount} core` : '-'],
            ['Docker Memory', hostResources?.dockerMemoryBytes ? formatBytes(hostResources.dockerMemoryBytes) : '-'],
            ['Images', dockerDiskUsage.images],
            ['Containers', dockerDiskUsage.containers],
            ['Volumes', dockerDiskUsage.volumes],
            ['Build Cache', dockerDiskUsage.buildCache],
          ].map(([label, value]) => (
            <div key={label} className="flex items-baseline gap-1.5 whitespace-nowrap">
              <span className="text-xs text-muted-foreground">{label}</span>
              <span className="font-semibold text-foreground">{value}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span className="max-w-full truncate" title={hostResources ? `${hostResources.osName} ${hostResources.osVersion} ${hostResources.osArch}` : ''}>
            Host {hostResources?.hostName || '-'} · {hostResources?.osName || '-'} {hostResources?.osArch || ''}
          </span>
          <span className="max-w-full truncate" title={hostResources?.dockerRootDir || ''}>
            Docker root {hostResources?.dockerRootDir || '-'}
          </span>
          {hostResources?.message && <span className="text-warning">{hostResources.message}</span>}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-muted px-4 py-3 text-xs leading-5 text-muted-foreground">
        <span className="font-medium text-foreground">수치 기준</span>
        <span className="ml-2">
          Runner 현황은 `docker stats --no-stream`, 호스트는 API 실행 환경과 `docker info/system df` 기준입니다. Docker Desktop에서는 실제 물리 서버와 Docker VM의 CPU/Memory가 다를 수 있습니다.
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="min-w-[1180px] table-fixed text-left text-xs">
          <colgroup>
            <col className="w-10" />
            <col className="w-[210px]" />
            <col className="w-[96px]" />
            <col className="w-[150px]" />
            <col className="w-[96px]" />
            <col className="w-[80px]" />
            <col className="w-[150px]" />
            <col className="w-[140px]" />
            <col className="w-[150px]" />
            <col />
          </colgroup>
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="w-10 px-3 py-2"></th>
              <th className="px-3 py-2">Container</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Project</th>
              <th className="px-3 py-2">상태</th>
              <th className="px-3 py-2">CPU</th>
              <th className="px-3 py-2">Memory</th>
              <th className="px-3 py-2">I/O</th>
              <th className="px-3 py-2">생성 / 사용시간</th>
              <th className="px-3 py-2">Image</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sortedContainers.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">
                  <Container className="mx-auto mb-2 h-5 w-5" />
                  표시할 Docker 컨테이너가 없습니다.
                </td>
              </tr>
            )}
            {sortedContainers.map((container) => (
              <tr key={container.name} className="text-foreground transition hover:bg-primary/5">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selectedNames.has(container.name)}
                    disabled={!container.removable}
                    onChange={(e) => toggleSelection(container.name, e.target.checked)}
                    className="rounded border-border"
                    aria-label={`${container.name} 선택`}
                  />
                </td>
                <td className="px-3 py-2 font-mono">
                  <div className="truncate" title={container.name}>{container.name}</div>
                  <div className="truncate text-[11px] text-muted-foreground" title={container.containerId}>{container.containerId}</div>
                </td>
                <td className="px-3 py-2">
                  <span className={cn('inline-flex rounded-full px-2 py-0.5 font-medium', containerTypeColor[container.containerType] ?? containerTypeColor.OTHER)}>
                    {containerTypeLabel[container.containerType] ?? container.containerType}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <div className="font-mono">{container.projectId || '-'}</div>
                  <div className="text-[11px] text-muted-foreground">{container.serverType ? serverTypeLabel[container.serverType] : ''}</div>
                </td>
                <td className="px-3 py-2">
                  <span className={cn('inline-flex whitespace-nowrap rounded-full px-2 py-0.5 font-medium', dockerStatusColor[container.dockerStatus])}>
                    {dockerStatusLabel[container.dockerStatus]}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono">{container.cpuPercent || '-'}</td>
                <td className="px-3 py-2 font-mono">
                  <div>{container.memoryUsage || '-'}</div>
                  <div className="text-[11px] text-muted-foreground">{container.memoryPercent || ''}</div>
                </td>
                <td className="px-3 py-2 font-mono">
                  <div>{container.netIo || '-'}</div>
                  <div className="text-[11px] text-muted-foreground">{container.blockIo || ''}</div>
                </td>
                <td className="px-3 py-2">
                  <div className="text-foreground">{formatDockerCreatedAt(container.createdAt)}</div>
                  <div className="text-[11px] text-muted-foreground">{container.uptime || '-'}</div>
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                  <div className="truncate" title={container.image}>{container.image}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            <div>
              <h3 className="text-sm font-semibold text-foreground">Runner capacity 설정</h3>
              <p className="text-xs text-muted-foreground">
                기본 {capacity?.baseConcurrency ?? capacityDraft.baseConcurrency}
                {' / '}최대 {capacity?.effectiveMaxConcurrency ?? capacityDraft.maxConcurrency}
                {' · '}Pool {capacity?.poolSize ?? 0}, Active {capacity?.activeCount ?? 0}, Queued {capacity?.queuedCount ?? 0}
              </p>
            </div>
          </div>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {capacityDraft.autoScaleEnabled ? '오토스케일 켜짐' : '고정'}
          </span>
        </div>
        <div className="px-4 py-4">
          <div className="mb-4 grid gap-3 sm:grid-cols-5">
            {[
              ['Pool', capacity?.poolSize ?? 0],
              ['Active', capacity?.activeCount ?? 0],
              ['Queued', capacity?.queuedCount ?? 0],
              ['Queue left', capacity?.remainingQueueCapacity ?? 0],
              ['Largest', capacity?.largestPoolSize ?? 0],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md border border-border bg-muted px-3 py-2">
                <p className="text-[11px] text-muted-foreground">{label}</p>
                <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(220px,auto)]">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm sm:col-span-2 lg:col-span-1">
                <span>
                  <span className="block font-medium text-foreground">오토스케일</span>
                  <span className="block text-xs text-muted-foreground">끄면 기본 수로 고정</span>
                </span>
                <input
                  type="checkbox"
                  checked={capacityDraft.autoScaleEnabled}
                  onChange={(e) => updateCapacityDraft('autoScaleEnabled', e.target.checked)}
                  className="h-4 w-4 rounded border-border"
                />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                기본 동시 실행
                <input
                  type="number"
                  min={1}
                  max={64}
                  value={capacityDraft.baseConcurrency}
                  onChange={(e) => updateCapacityDraft('baseConcurrency', Number(e.target.value))}
                  className="h-8 w-full rounded-md border border-border bg-card px-2 text-sm text-foreground"
                />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                최대 동시 실행
                <input
                  type="number"
                  min={capacityDraft.baseConcurrency}
                  max={128}
                  value={capacityDraft.maxConcurrency}
                  disabled={!capacityDraft.autoScaleEnabled}
                  onChange={(e) => updateCapacityDraft('maxConcurrency', Number(e.target.value))}
                  className="h-8 w-full rounded-md border border-border bg-card px-2 text-sm text-foreground disabled:bg-muted"
                />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                대기열 제한
                <input
                  type="number"
                  min={0}
                  max={10000}
                  value={capacityDraft.queueCapacity}
                  onChange={(e) => updateCapacityDraft('queueCapacity', Number(e.target.value))}
                  className="h-8 w-full rounded-md border border-border bg-card px-2 text-sm text-foreground"
                />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                축소 유휴 시간(초)
                <input
                  type="number"
                  min={1}
                  max={3600}
                  value={capacityDraft.scaleDownIdleSeconds}
                  onChange={(e) => updateCapacityDraft('scaleDownIdleSeconds', Number(e.target.value))}
                  className="h-8 w-full rounded-md border border-border bg-card px-2 text-sm text-foreground"
                />
              </label>
            </div>
            <div className="flex flex-col items-start gap-2 lg:items-end">
              <Button type="button" size="sm" onClick={saveRunnerCapacity} disabled={capacitySaving}>
                <Save className={cn('h-4 w-4', capacitySaving && 'animate-pulse')} />
                {capacitySaving ? '저장 중' : '저장'}
              </Button>
              {capacityMessage && (
                <div
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium',
                    capacityMessage.type === 'success'
                      ? 'bg-success/10 text-success'
                      : 'bg-destructive/10 text-destructive'
                  )}
                >
                  {capacityMessage.type === 'success' ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5" />
                  )}
                  {capacityMessage.text}
                </div>
              )}
            </div>
          </div>
          <div className="mt-3">
            <p className="text-xs text-muted-foreground">
              {capacity?.scaleDownRule ??
                '기본 동시 실행을 초과한 스레드는 설정한 유휴 시간이 지나면 기본 수로 축소됩니다.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
