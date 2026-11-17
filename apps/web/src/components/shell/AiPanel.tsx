import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Ban,
  Briefcase,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  FileCode2,
  FileText,
  FolderTree,
  GraduationCap,
  History,
  ListChecks,
  Loader2,
  Maximize2,
  ListTodo,
  MessageSquare,
  MessageSquarePlus,
  Minimize2,
  Network,
  Play,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  UserCheck,
  Wrench,
  X,
  XCircle,
} from 'lucide-react';
import { AiMarkdown } from '@/components/ai/AiMarkdown';
import { AiActionCard } from '@/components/shell/AiActionCard';
import { AiTaskQueue } from '@/components/shell/AiTaskQueue';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useChatSession } from '@/hooks/useChatSession';
import { getToolLabel } from '@/lib/chatReducer';
import type {
  AiChatAction,
  ChatBlock,
  ChatMessage,
  ChatToolBlock,
  PermissionDecision,
  ToolDisplay,
  UserLevel,
} from '@/types';
import { cn } from '@/lib/utils';

const LEVEL_STORAGE_KEY = 'playops.aiChat.userLevel';

const levelOptions: { id: UserLevel; label: string; icon: typeof UserCheck }[] = [
  { id: 'NON_DEVELOPER', label: '비전공자', icon: UserCheck },
  { id: 'JUNIOR', label: '주니어', icon: GraduationCap },
  { id: 'SENIOR', label: '시니어', icon: Briefcase },
];

const DECISION_LABELS: Record<PermissionDecision, string> = {
  ALLOW: '허용함',
  ALLOW_SESSION: '이 대화에서 항상 허용함',
  DENY: '거부함',
};

function readStoredLevel(): UserLevel {
  try {
    const raw = window.localStorage.getItem(LEVEL_STORAGE_KEY);
    if (levelOptions.some((opt) => opt.id === raw)) return raw as UserLevel;
  } catch {
    // localStorage 접근 불가 시 기본값 사용
  }
  return 'JUNIOR';
}

function toolIconFor(name: string) {
  switch (name) {
    case 'sql_query':
      return Database;
    case 'read_file':
      return FileText;
    case 'list_files':
      return FolderTree;
    case 'grep_files':
    case 'search_logs':
      return Search;
    case 'list_executions':
    case 'get_execution_detail':
      return ListChecks;
    case 'get_case_history':
      return History;
    case 'get_sitemap':
      return Network;
    case 'get_job_status':
    case 'fix_test':
      return Wrench;
    case 'generate_scenario':
      return FileCode2;
    case 'run_tests':
      return Play;
    default:
      return Terminal;
  }
}

function formatDuration(durationMs?: number): string | null {
  if (durationMs === undefined || durationMs === null) return null;
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function summarizeInput(input: Record<string, unknown>): string {
  const entries = Object.entries(input).filter(
    ([, v]) => v !== undefined && v !== null && v !== ''
  );
  if (entries.length === 0) return '';
  return entries
    .map(([k, v]) => {
      const text = typeof v === 'string' ? v : JSON.stringify(v);
      const compact = text.length > 60 ? `${text.slice(0, 57)}...` : text;
      return `${k}: ${compact}`;
    })
    .join(' · ');
}

function ToolStatusIcon({ status }: { status: ChatToolBlock['status'] }) {
  switch (status) {
    case 'running':
      return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-ai-accent" aria-label="실행 중" />;
    case 'ok':
      return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" aria-label="성공" />;
    case 'error':
      return <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" aria-label="실패" />;
    case 'denied':
      return <Ban className="h-3.5 w-3.5 shrink-0 text-warning" aria-label="거부됨" />;
    case 'cancelled':
      return <XCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="취소됨" />;
  }
}

function ToolDisplayView({
  display,
  block,
  projectId,
}: {
  display: ToolDisplay;
  block: ChatToolBlock;
  projectId?: string;
}) {
  switch (display.kind) {
    case 'table': {
      const { columns, rows, truncated, sql } = display.data;
      return (
        <div className="space-y-1.5">
          {sql && (
            <pre className="overflow-x-auto rounded-sm border border-border bg-muted p-2 font-mono text-[11px] leading-relaxed text-foreground">
              <code>{sql}</code>
            </pre>
          )}
          <div className="overflow-x-auto rounded-sm border border-border bg-card">
            <table className="w-full border-collapse text-left text-[11px]">
              <thead className="bg-muted">
                <tr>
                  {columns.map((col, idx) => (
                    <th
                      key={idx}
                      className="border-b border-border px-2 py-1 font-semibold whitespace-nowrap text-foreground"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={Math.max(columns.length, 1)}
                      className="px-2 py-2 text-center text-muted-foreground"
                    >
                      조회된 행이 없습니다
                    </td>
                  </tr>
                ) : (
                  rows.map((row, rIdx) => (
                    <tr key={rIdx} className="border-b border-border last:border-b-0">
                      {row.map((cell, cIdx) => (
                        <td
                          key={cIdx}
                          className="px-2 py-1 align-top whitespace-nowrap text-foreground"
                        >
                          {cell === null ? (
                            <span className="text-muted-foreground">NULL</span>
                          ) : (
                            String(cell)
                          )}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {truncated && (
            <p className="text-[11px] text-muted-foreground">200행까지만 표시</p>
          )}
        </div>
      );
    }

    case 'code': {
      const { path, language, content } = display.data;
      return (
        <div className="overflow-hidden rounded-sm border border-border bg-card">
          {(path || language) && (
            <div className="flex items-center justify-between border-b border-border bg-muted px-2 py-1 text-[11px] text-muted-foreground">
              <span className="truncate font-mono font-semibold text-foreground">
                {path ?? '코드'}
              </span>
              {language && <span className="uppercase">{language}</span>}
            </div>
          )}
          <pre className="max-h-64 overflow-auto p-2 font-mono text-[11px] leading-relaxed text-foreground">
            <code>{content}</code>
          </pre>
        </div>
      );
    }

    case 'job': {
      const { jobId, jobType, status, specPath } = display.data;
      const action: AiChatAction = {
        type:
          jobType === 'TEMPLATE_GENERATE' || block.name === 'generate_scenario'
            ? 'GENERATE_SCENARIO'
            : 'FIX_TEST',
        status: status === 'FAILED' || block.status === 'error' ? 'FAILED' : 'CREATED',
        label:
          block.summary ||
          (block.name === 'generate_scenario' ? '테스트 시나리오 생성' : '테스트 코드 수정'),
        detail: specPath ? `대상 파일: ${specPath}` : null,
        jobId,
        projectId:
          projectId ??
          (typeof block.input.projectId === 'string' ? block.input.projectId : null),
        specPath:
          specPath ??
          (typeof block.input.specPath === 'string' ? block.input.specPath : null),
      };
      return <AiActionCard action={action} />;
    }

    case 'execution': {
      const { executionId, status, projectId: execProjectId } = display.data;
      const targetProjectId = execProjectId || projectId;
      return (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card p-2.5 text-[12px]">
          <div className="flex items-center gap-2">
            <Play className="h-3.5 w-3.5 text-ai-accent" />
            <span className="font-semibold text-foreground">실행 #{executionId}</span>
            <Badge variant={status === 'FAILED' || status === 'ERROR' ? 'destructive' : 'info'}>
              {status}
            </Badge>
          </div>
          {targetProjectId && (
            <Link
              to={`/projects/${targetProjectId}/runs`}
              className="font-semibold text-ai-accent underline underline-offset-2 hover:opacity-80"
            >
              실행 탭에서 보기
            </Link>
          )}
        </div>
      );
    }

    case 'list': {
      const { items } = display.data;
      return (
        <ul className="max-h-56 space-y-1 overflow-y-auto rounded-sm border border-border bg-card p-2 text-[12px]">
          {items.length === 0 ? (
            <li className="text-muted-foreground">항목이 없습니다</li>
          ) : (
            items.map((item, idx) => (
              <li key={idx} className="flex flex-col gap-0.5 border-b border-border pb-1 last:border-b-0 last:pb-0">
                <span className="break-all font-mono text-[11px] font-medium text-foreground">
                  {item.label}
                </span>
                {item.detail && (
                  <span className="break-words text-[11px] text-muted-foreground">
                    {item.detail}
                  </span>
                )}
              </li>
            ))
          )}
        </ul>
      );
    }
  }
}

function ChatToolCard({
  block,
  projectId,
  onRespondPermission,
}: {
  block: ChatToolBlock;
  projectId?: string;
  onRespondPermission: (requestId: string, decision: PermissionDecision) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [responding, setResponding] = useState(false);

  const Icon = toolIconFor(block.name);
  const label = getToolLabel(block.name);
  const durationText = formatDuration(block.durationMs);
  const inputSummary = summarizeInput(block.input);
  const headerSummary = block.summary || inputSummary;
  const permission = block.permission;
  const alwaysVisibleDisplay =
    block.display?.kind === 'job' || block.display?.kind === 'execution';

  const handleDecision = async (decision: PermissionDecision) => {
    if (!permission || responding) return;
    setResponding(true);
    try {
      await onRespondPermission(permission.requestId, decision);
    } finally {
      setResponding(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-muted/40 text-[12px]">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-accent/60"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <Icon className="h-3.5 w-3.5 shrink-0 text-ai-accent" />
        <span className="shrink-0 font-semibold text-foreground">{label}</span>
        {headerSummary && (
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
            {headerSummary}
          </span>
        )}
        {!headerSummary && <span className="flex-1" />}
        {durationText && (
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
            {durationText}
          </span>
        )}
        <ToolStatusIcon status={block.status} />
      </button>

      {/* 허락 카드: RUN 도구가 사용자 허락을 기다리거나 결정된 결과를 바로 보여준다 */}
      {permission && (
        <div className="border-t border-border bg-card p-2.5">
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="font-semibold text-foreground">{permission.reason}</p>
              {inputSummary && (
                <p className="break-all font-mono text-[11px] text-muted-foreground">
                  {inputSummary}
                </p>
              )}
              {permission.decision ? (
                <div className="pt-0.5">
                  <Badge
                    variant={permission.decision === 'DENY' ? 'destructive' : 'ai'}
                  >
                    {DECISION_LABELS[permission.decision]}
                  </Badge>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <Button
                    type="button"
                    size="xs"
                    disabled={responding}
                    onClick={() => void handleDecision('ALLOW')}
                  >
                    허용
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="secondary"
                    disabled={responding}
                    onClick={() => void handleDecision('ALLOW_SESSION')}
                  >
                    이 대화에서 항상 허용
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    disabled={responding}
                    onClick={() => void handleDecision('DENY')}
                  >
                    거부
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 승인/실행처럼 바로 행동해야 하는 카드(job, execution)는 접혀 있어도 표시한다 */}
      {!open && alwaysVisibleDisplay && block.display && (
        <div className="border-t border-border p-2.5">
          <ToolDisplayView display={block.display} block={block} projectId={projectId} />
        </div>
      )}

      {open && (
        <div className="space-y-2 border-t border-border bg-background/60 p-2.5">
          <div>
            <p className="mb-1 text-[11px] font-semibold text-muted-foreground">입력 (JSON)</p>
            <pre className="max-h-40 overflow-auto rounded-sm border border-border bg-card p-2 font-mono text-[11px] leading-relaxed text-foreground">
              <code>{JSON.stringify(block.input, null, 2)}</code>
            </pre>
          </div>

          {block.display ? (
            <div>
              <p className="mb-1 text-[11px] font-semibold text-muted-foreground">결과</p>
              <ToolDisplayView display={block.display} block={block} projectId={projectId} />
            </div>
          ) : (
            block.output && (
              <div>
                <p className="mb-1 text-[11px] font-semibold text-muted-foreground">출력</p>
                <pre className="max-h-56 overflow-auto rounded-sm border border-border bg-card p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-foreground">
                  <code>{block.output}</code>
                </pre>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

function AssistantMessageView({
  message,
  isStreamingMessage,
  projectId,
  onRespondPermission,
}: {
  message: ChatMessage;
  isStreamingMessage: boolean;
  projectId?: string;
  onRespondPermission: (requestId: string, decision: PermissionDecision) => Promise<void>;
}) {
  const renderBlock = (block: ChatBlock, idx: number) => {
    const isLastBlock = idx === message.blocks.length - 1;
    if (block.type === 'text') {
      return (
        <div
          key={`text-${idx}`}
          className="rounded-xl rounded-bl-none border border-border bg-card px-3 py-2 text-[14px] leading-relaxed text-foreground"
        >
          <AiMarkdown content={block.text} />
          {isStreamingMessage && isLastBlock && (
            <span
              className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse rounded-xs bg-ai-accent"
              aria-label="작성 중 커서"
            />
          )}
        </div>
      );
    }

    return (
      <ChatToolCard
        key={block.callId || `tool-${idx}`}
        block={block}
        projectId={projectId}
        onRespondPermission={onRespondPermission}
      />
    );
  };

  return (
    <div className="space-y-2">
      {message.blocks.length === 0 && isStreamingMessage ? (
        <div className="inline-flex items-center gap-2 rounded-xl rounded-bl-none border border-border bg-card px-3 py-2 text-[13px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-ai-accent" />
          <span>AI가 답변을 준비하고 있습니다...</span>
        </div>
      ) : (
        message.blocks.map(renderBlock)
      )}

      {message.errorMessage && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-[12px] text-destructive">
          {message.errorMessage}
        </p>
      )}

      {message.stopReason === 'CANCELLED' && (
        <p className="text-[11px] text-muted-foreground">답변이 중단되었습니다.</p>
      )}
      {message.stopReason === 'MAX_TURNS' && (
        <p className="text-[11px] text-muted-foreground">
          도구 실행 한도에 도달해 답변을 마무리했습니다.
        </p>
      )}

      {message.usage && (
        <p className="text-[11px] text-muted-foreground">
          입력 {message.usage.inputTokens.toLocaleString()} · 출력{' '}
          {message.usage.outputTokens.toLocaleString()} 토큰
        </p>
      )}
    </div>
  );
}

/**
 * 오른쪽 아래에 뜨는 AI 채팅 에이전트 창.
 *
 * 세션별로 대화가 서버에 저장되고, 답변 글과 도구 실행 · 허락 요청이 실시간 스트리밍으로 쌓인다.
 */
export function AiPanel({
  onClose,
  contextLabel,
  projectId,
}: {
  onClose: () => void;
  /** 패널 상단에 보여줄 현재 맥락 (예: "example.com · 시나리오"). */
  contextLabel: string;
  /** 지금 보고 있는 프로젝트. 바뀌면 해당 프로젝트의 최근 세션을 연다. */
  projectId?: string;
}) {
  const [question, setQuestion] = useState('');
  const [userLevel, setUserLevel] = useState<UserLevel>(readStoredLevel);
  const [wide, setWide] = useState(false);
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  /** 패널을 열면 작업 큐가 먼저 보인다. 대화는 옆 탭으로 둔다. (D-04) */
  const [view, setView] = useState<'tasks' | 'chat'>('tasks');

  const {
    sessions,
    currentSessionId,
    currentSession,
    messages,
    streaming,
    loadingSession,
    error,
    selectSession,
    startNewSession,
    deleteSession,
    sendMessage,
    cancel,
    respondPermission,
  } = useChatSession({
    projectId,
    userLevel,
  });

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  /** 입력한 줄 수에 맞춰 높이를 늘린다. 너무 길어지면 스크롤로 넘긴다. */
  const resizeInput = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, []);

  useEffect(() => {
    resizeInput();
  }, [question, resizeInput]);

  useEffect(() => {
    try {
      window.localStorage.setItem(LEVEL_STORAGE_KEY, userLevel);
    } catch {
      // 저장 실패는 무시한다.
    }
  }, [userLevel]);

  // 새 메시지나 스트리밍 조각이 붙으면 최신 위치로 스크롤한다.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  // 드롭다운 바깥을 누르면 세션 메뉴를 닫는다.
  useEffect(() => {
    if (!sessionMenuOpen) return;
    const handleClickOutside = (ev: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(ev.target as Node)) {
        setSessionMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [sessionMenuOpen]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || streaming) return;
    setQuestion('');
    await sendMessage(q);
  };

  /**
   * Enter 로 보내고 Shift+Enter 로 줄을 바꾼다.
   * 한글 입력 중(조합 중)에는 Enter 가 글자 확정에 쓰이므로 보내지 않는다.
   */
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!question.trim() || streaming) return;
    const q = question.trim();
    setQuestion('');
    void sendMessage(q);
  };

  const sessionTitle = currentSession?.title?.trim() || '새 대화';

  return (
    <aside
      className={cn(
        'absolute bottom-4 right-4 z-40 flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl transition-[width,height] duration-150',
        wide
          ? 'h-[calc(100%-2rem)] w-[max(56%,min(920px,calc(100%-2rem)))] max-w-[calc(100%-2rem)]'
          : 'h-[min(640px,calc(100%-2rem))] w-[min(420px,calc(100%-2rem))]'
      )}
      role="dialog"
      aria-label="AI 어시스턴트"
    >
      {/* 상단 헤더: 세션 드롭다운 · 넓게 보기 · 닫기 + 맥락 · 수준 선택 */}
      <header className="shrink-0 border-b border-border bg-card px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2" ref={menuRef}>
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ai-accent/15 text-ai-accent ring-1 ring-ai-accent/30">
              <Sparkles className="h-4 w-4" />
            </span>

            <div className="relative min-w-0 flex-1">
              <button
                type="button"
                onClick={() => setSessionMenuOpen((prev) => !prev)}
                aria-haspopup="listbox"
                aria-expanded={sessionMenuOpen}
                aria-label="대화 세션 선택"
                className="flex max-w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-sm font-bold text-foreground hover:bg-accent"
              >
                <span className="truncate">{sessionTitle}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </button>

              {sessionMenuOpen && (
                <div
                  role="listbox"
                  aria-label="대화 목록"
                  className="absolute left-0 top-full z-50 mt-1 w-72 max-w-[calc(100vw-3rem)] overflow-hidden rounded-lg border border-border bg-card shadow-lg"
                >
                  <div className="border-b border-border p-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        startNewSession();
                        setSessionMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] font-semibold text-ai-accent hover:bg-accent"
                    >
                      <MessageSquarePlus className="h-4 w-4 shrink-0" />
                      <span>새 대화</span>
                    </button>
                  </div>

                  <div className="max-h-60 overflow-y-auto p-1.5">
                    {sessions.length === 0 ? (
                      <p className="px-2.5 py-3 text-center text-[12px] text-muted-foreground">
                        저장된 대화가 없습니다
                      </p>
                    ) : (
                      sessions.map((session) => {
                        const active = session.id === currentSessionId;
                        const title = session.title?.trim() || '제목 없는 대화';
                        return (
                          <div
                            key={session.id}
                            className={cn(
                              'flex items-center gap-1 rounded-md px-2 py-1 text-[13px]',
                              active ? 'bg-primary-subtle font-semibold text-ai-accent' : 'hover:bg-accent'
                            )}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                void selectSession(session.id);
                                setSessionMenuOpen(false);
                              }}
                              className="min-w-0 flex-1 truncate py-0.5 text-left"
                              title={title}
                            >
                              {title}
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void deleteSession(session.id);
                              }}
                              className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              title="대화 삭제"
                              aria-label={`${title} 삭제`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={startNewSession}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="새 대화"
              aria-label="새 대화"
            >
              <MessageSquarePlus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setWide((prev) => !prev)}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              title={wide ? '작게 보기' : '넓게 보기'}
              aria-label={wide ? '작게 보기' : '넓게 보기'}
            >
              {wide ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="닫기 (Esc · Ctrl+/)"
              aria-label="AI 채팅 닫기"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div role="tablist" aria-label="AI 패널 보기" className="mt-1.5 inline-flex rounded-lg border border-border bg-muted p-0.5">
          {(
            [
              { id: 'tasks', label: '작업', icon: ListTodo },
              { id: 'chat', label: '대화', icon: MessageSquare },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const selected = view === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setView(tab.id)}
                className={cn(
                  'flex items-center gap-1 rounded-md px-2.5 py-0.5 text-[12px] font-semibold transition-all',
                  selected
                    ? 'border border-border bg-card text-ai-accent shadow-sm'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 truncate text-[12px] text-muted-foreground" title={contextLabel}>
            맥락: {contextLabel}
          </p>
          <div className="inline-flex shrink-0 items-center gap-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              수준
            </span>
            <div className="inline-flex rounded-lg border border-border bg-muted p-0.5">
              {levelOptions.map((opt) => {
                const isSelected = userLevel === opt.id;
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setUserLevel(opt.id)}
                    className={cn(
                      'flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold transition-all',
                      isSelected
                        ? 'border border-border bg-card text-ai-accent shadow-sm'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </header>

      {view === 'tasks' && (
        <div className="flex-1 overflow-y-auto bg-background p-3">
          <AiTaskQueue projectId={projectId} />
        </div>
      )}

      {/* 대화 본문 */}
      <div ref={listRef} className={cn('flex-1 space-y-3 overflow-y-auto bg-background p-3', view !== 'chat' && 'hidden')}>
        {loadingSession && messages.length === 0 ? (
          <div className="flex h-full items-center justify-center gap-2 text-[13px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-ai-accent" />
            <span>대화를 불러오는 중...</span>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground">
            <Sparkles className="h-7 w-7 text-ai-accent/60" />
            <p className="text-[13px] leading-relaxed">
              Playwright 문법, 셀렉터, 실패 원인, DB 조회 등 무엇이든 물어보세요.
              <br />
              답변과 도구 실행 과정이 실시간으로 여기에 표시됩니다.
            </p>
          </div>
        ) : (
          messages.map((msg, idx) => {
            const isLast = idx === messages.length - 1;
            if (msg.role === 'user') {
              const userText = msg.blocks
                .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
                .map((b) => b.text)
                .join('\n');
              return (
                <div key={msg.id || idx} className="flex justify-end text-[14px]">
                  <div className="max-w-[88%] whitespace-pre-wrap rounded-xl rounded-br-none bg-ai-accent px-3 py-2 font-medium leading-relaxed text-ai-accent-foreground">
                    {userText}
                  </div>
                </div>
              );
            }

            return (
              <AssistantMessageView
                key={msg.id || idx}
                message={msg}
                isStreamingMessage={streaming && isLast}
                projectId={projectId}
                onRespondPermission={respondPermission}
              />
            );
          })
        )}

        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-[12px] text-destructive">
            {error}
          </p>
        )}
      </div>

      {/* 입력창: 진행 중에는 보내기 버튼 자리에 중단 버튼을 둔다 */}
      <form onSubmit={handleSend} className={cn('flex items-end gap-2 border-t border-border bg-card p-2.5', view !== 'chat' && 'hidden')}>
        <textarea
          ref={inputRef}
          rows={1}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="무엇이든 물어보세요 (Shift+Enter 로 줄바꿈)"
          className="min-w-0 flex-1 resize-none overflow-y-auto rounded-sm border border-border bg-background px-3 py-2 text-[14px] leading-relaxed text-foreground placeholder:text-muted-foreground focus:border-ai-accent"
        />
        {streaming ? (
          <button
            type="button"
            onClick={() => void cancel()}
            className="inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-lg bg-destructive px-2.5 text-[12px] font-semibold text-destructive-foreground hover:opacity-90"
            title="답변 중단"
            aria-label="중단"
          >
            <Square className="h-3 w-3 fill-current" />
            <span>중단</span>
          </button>
        ) : (
          <button
            type="submit"
            disabled={!question.trim()}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ai-accent text-ai-accent-foreground hover:opacity-90 disabled:opacity-50"
            aria-label="보내기"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        )}
      </form>
    </aside>
  );
}
