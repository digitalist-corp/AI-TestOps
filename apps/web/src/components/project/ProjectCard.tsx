import {
  BarChart3,
  ExternalLink,
  FileCode,
  Loader2,
  Pencil,
  Play,
  SlidersHorizontal,
  TriangleAlert,
  Trash2,
} from 'lucide-react';
import type { DockerStatus, ExecutionStatus, Project, RunnerActivity } from '@/types';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import {
  configuredEnvCount,
  resolveEnvRequirementState,
} from '@/lib/envVariables';

const dockerStatusLabel: Record<DockerStatus, string> = {
  RUNNING: '실행 중',
  STOPPED: '중지',
  ERROR: '오류',
  NOT_CONFIGURED: '미설정',
};

const runnerActivityLabel: Record<RunnerActivity, string> = {
  IDLE: '대기',
  TESTING: '테스트 중',
  UNAVAILABLE: '중지',
};

const serverTypeLabel: Record<Project['serverType'], string> = {
  DEV: '개발',
  TEST: '테스트',
  PROD: '운영',
};

const executionStatusLabel: Record<ExecutionStatus, string> = {
  SCHEDULED: '예약',
  PENDING: '대기',
  RUNNING: '실행 중',
  CANCEL_REQUESTED: '중단 중',
  CANCELLED: '중단',
  PASSED: '성공',
  FAILED: '실패',
  ERROR: '오류',
};

const executionStatusTone: Record<ExecutionStatus, string> = {
  SCHEDULED: 'border-ai-accent/30 bg-ai-accent/10 text-ai-accent',
  PENDING: 'border-border bg-muted text-muted-foreground',
  RUNNING: 'border-primary/30 bg-primary/10 text-primary',
  CANCEL_REQUESTED: 'border-warning/30 bg-warning/10 text-warning',
  CANCELLED: 'border-border bg-muted text-muted-foreground',
  PASSED: 'border-success/30 bg-success/10 text-success',
  FAILED: 'border-destructive/30 bg-destructive/10 text-destructive',
  ERROR: 'border-destructive/30 bg-destructive/10 text-destructive',
};

export function isRunnerReady(project: Project) {
  return project.dockerStatus === 'RUNNING'
    || (project.dockerEnabled && project.runnerLifecycle === 'EPHEMERAL');
}

export function envState(project: Project) {
  return resolveEnvRequirementState(project.loginEnvRequired, project.envVariables);
}

/** "2분 전"처럼 사람이 읽는 시간. 하루가 넘으면 날짜로 보여준다. */
function formatRelative(value: string | null): string {
  if (!value) return '';
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return '';
  const diffMin = Math.floor((Date.now() - time) / 60000);
  if (diffMin < 1) return '방금';
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  return new Date(value).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
}

function formatDuration(durationMs: number | null): string {
  if (durationMs == null) return '';
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}초`;
  return `${Math.floor(seconds / 60)}분 ${Math.round(seconds % 60)}초`;
}

function Chip({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[12px] font-bold', tone)}>
      {children}
    </span>
  );
}

function IconButton({
  title,
  onClick,
  children,
  tone,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  tone?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-sm border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
        tone
      )}
    >
      {children}
    </button>
  );
}

/**
 * 프로젝트 한 개를 카드로 보여준다.
 *
 * 표 10칸을 가로로 훑는 대신, 카드 안에서 위에서 아래로 읽히게 묶었다.
 *   이름 · 대상 사이트  →  최근 실행 결과  →  실행 환경 · 러너  →  할 수 있는 일
 */
export function ProjectCard({
  project,
  running,
  justCreated,
  onOpen,
  onRun,
  onEnv,
  onEdit,
  onDelete,
  onGo,
}: {
  project: Project;
  running: boolean;
  justCreated: boolean;
  onOpen: () => void;
  onRun: () => void;
  onEnv: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onGo: (tab: 'results' | 'runs' | 'source') => void;
}) {
  const state = envState(project);
  const missingEnv = state === 'required-missing';
  const status = project.latestExecutionStatus;
  const runnerLabel = project.dockerStatus === 'RUNNING'
    ? runnerActivityLabel[project.runnerActivity ?? 'IDLE']
    : project.dockerEnabled && (project.runnerLifecycle === 'EPHEMERAL' || !project.dockerContainerId)
      ? '준비되면 생성'
      : dockerStatusLabel[project.dockerStatus];

  return (
    <article
      className={cn(
        'flex flex-col rounded-md border bg-card transition-colors',
        justCreated ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-border-strong'
      )}
    >
      {/* 이름 · 대상 사이트 */}
      <div className="flex items-start justify-between gap-3 px-4 pt-4">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onOpen}
            className="block max-w-full truncate text-left text-[17px] font-bold text-foreground hover:text-primary"
            title={project.projectName}
          >
            {project.projectName}
          </button>
          <p className="mt-0.5 truncate font-mono text-[12px] text-muted-foreground" title={project.baseUrl ?? project.projectId}>
            {project.baseUrl ?? project.projectId}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {justCreated && <Chip tone="border-primary/30 bg-primary/10 text-primary">방금 등록됨</Chip>}
          <Chip tone="border-border bg-muted text-secondary-foreground">{serverTypeLabel[project.serverType]}</Chip>
        </div>
      </div>

      {/* 최근 실행 — 카드에서 가장 크게 읽혀야 하는 정보 */}
      <div className="mx-4 mt-3 rounded-sm border border-border bg-background px-3 py-2.5">
        {status ? (
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Chip tone={executionStatusTone[status]}>{executionStatusLabel[status]}</Chip>
              <span className="truncate text-[13px] text-muted-foreground">
                {[formatRelative(project.latestExecutionAt), formatDuration(project.latestExecutionDurationMs)]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
            <button
              type="button"
              onClick={() => onGo('runs')}
              className="shrink-0 text-[13px] font-bold text-primary hover:underline"
            >
              이력
            </button>
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">아직 실행한 적이 없습니다. 실행을 눌러 첫 테스트를 돌려보세요.</p>
        )}
      </div>

      {/* 러너 · 실행 환경 */}
      <dl className="mt-3 grid grid-cols-1 gap-x-3 gap-y-1.5 px-4 text-[12px] @min-[20rem]:grid-cols-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <dt className="shrink-0 text-muted-foreground">러너</dt>
          <dd className="truncate font-medium text-foreground">
            {runnerLabel} · {project.runnerLifecycle === 'EPHEMERAL' ? '일회용' : '상주'}
          </dd>
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          <dt className="shrink-0 text-muted-foreground">환경</dt>
          <dd className="truncate font-medium text-foreground">
            Node {project.nodeVersion} · PW {project.playwrightVersion}
          </dd>
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          <dt className="shrink-0 text-muted-foreground">환경변수</dt>
          <dd className="truncate font-medium text-foreground">{configuredEnvCount(project.envVariables)}개</dd>
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          <dt className="shrink-0 text-muted-foreground">담당</dt>
          <dd className="truncate font-medium text-foreground">{project.managerName || '-'}</dd>
        </div>
      </dl>

      {missingEnv && (
        <p className="mx-4 mt-2.5 flex items-start gap-1.5 rounded-sm border border-destructive bg-destructive/10 px-2.5 py-1.5 text-[12px] text-destructive">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          테스트 계정 환경변수가 필요합니다. 입력해야 실행할 수 있습니다.
        </p>
      )}

      {/* 할 수 있는 일 */}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" onClick={onRun} disabled={running || missingEnv}
                  title={missingEnv ? '환경변수를 먼저 입력하세요' : '전체 테스트 실행'}>
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            실행
          </Button>
          <Button size="sm" variant="outline" onClick={onOpen}>
            열기
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          <IconButton title="결과 리포트" onClick={() => onGo('results')}>
            <BarChart3 className="h-4 w-4" />
          </IconButton>
          <IconButton title="소스" onClick={() => onGo('source')}>
            <FileCode className="h-4 w-4" />
          </IconButton>
          <IconButton
            title="환경변수"
            onClick={onEnv}
            tone={missingEnv ? 'border-destructive text-destructive hover:bg-destructive/10' : undefined}
          >
            <SlidersHorizontal className="h-4 w-4" />
          </IconButton>
          <IconButton title="수정" onClick={onEdit}>
            <Pencil className="h-4 w-4" />
          </IconButton>
          <IconButton title="삭제" onClick={onDelete} tone="hover:border-destructive hover:text-destructive">
            <Trash2 className="h-4 w-4" />
          </IconButton>
        </div>
      </div>
    </article>
  );
}
