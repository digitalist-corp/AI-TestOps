import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowUp,
  Ban,
  ChevronDown,
  ChevronRight,
  Database,
  FileCode2,
  FileText,
  FolderTree,
  History,
  ListChecks,
  Loader2,
  Maximize2,
  MessageCircleQuestion,
  MessageSquarePlus,
  Minimize2,
  Network,
  Play,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  Wrench,
  X,
  XCircle,
} from 'lucide-react';
import { AiMarkdown } from '@/components/ai/AiMarkdown';
import { AiActionCard } from '@/components/shell/AiActionCard';
import { AiTaskQueue } from '@/components/shell/AiTaskQueue';
import { ChatQuestionCard } from '@/components/shell/ChatQuestionCard';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useChatSession } from '@/hooks/useChatSession';
import { getToolLabel } from '@/lib/chatReducer';
import type {
  AiChatAction,
  ChatBlock,
  ChatMessage,
  ChatToolBlock,
  ChatUiAction,
  PermissionDecision,
  ToolDisplay,
  UserLevel,
} from '@/types';
import { cn, formatDuration } from '@/lib/utils';

const LEVEL_STORAGE_KEY = 'playops.aiChat.userLevel';

const levelOptions: { id: UserLevel; label: string }[] = [
  { id: 'NON_DEVELOPER', label: '비전공자' },
  { id: 'JUNIOR', label: '주니어' },
  { id: 'SENIOR', label: '시니어' },
];

const DECISION_LABELS: Record<PermissionDecision, string> = {
  ALLOW: '허용함',
  ALLOW_SESSION: '이 대화에서 항상 허용함',
  DENY: '거부함',
};

/** 빈 대화에서 눌러 바로 입력창에 넣는 시작 예시. */
const STARTER_PROMPTS = [
  '최근 실패한 테스트의 원인을 알려 줘',
  '지난 실행 결과를 한눈에 요약해 줘',
  '로그인 화면을 확인하는 테스트를 만들어 줘',
];

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
    case 'ask_user':
      return MessageCircleQuestion;
    default:
      return Terminal;
  }
}

function toolDuration(durationMs?: number): string | null {
  if (durationMs == null) return null;
  return durationMs < 1000 ? '1초 미만' : formatDuration(durationMs);
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

/**
 * 도구 한 줄의 상태 표시. 성공은 조용히(도구 아이콘만), 그 밖의 상태는 아이콘 + 짧은 글로 분명히 보인다.
 */
function toolStatusView(block: ChatToolBlock): { icon: typeof Terminal; iconClass: string; text?: string; textClass?: string; spin?: boolean } {
  if (block.permission && !block.permission.decision) {
    return { icon: ShieldAlert, iconClass: 'text-warning', text: '허락 대기', textClass: 'text-warning' };
  }
  switch (block.status) {
    case 'running':
      return { icon: Loader2, iconClass: 'text-ai-accent', text: '실행 중', textClass: 'text-ai-accent', spin: true };
    case 'ok':
      return { icon: toolIconFor(block.name), iconClass: 'text-muted-foreground' };
    case 'error':
      return { icon: XCircle, iconClass: 'text-destructive', text: '실패', textClass: 'text-destructive' };
    case 'denied':
      return { icon: Ban, iconClass: 'text-warning', text: '거부됨', textClass: 'text-warning' };
    case 'cancelled':
      return { icon: XCircle, iconClass: 'text-muted-foreground', text: '취소됨', textClass: 'text-muted-foreground' };
  }
}

const codeBoxClass =
  'overflow-auto rounded-md bg-muted p-2 font-mono text-[11px] leading-relaxed text-foreground';

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
            <pre className={codeBoxClass}>
              <code>{sql}</code>
            </pre>
          )}
          <div className="overflow-x-auto rounded-md border border-border">
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
        <div className="overflow-hidden rounded-md bg-muted">
          {(path || language) && (
            <div className="flex items-center justify-between border-b border-border px-2 py-1 text-[11px] text-muted-foreground">
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
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-[12px]">
          <div className="flex items-center gap-2">
            <Play className="h-3.5 w-3.5 text-ai-accent" aria-hidden />
            <span className="font-semibold text-foreground">실행 #{executionId}</span>
            <Badge variant={status === 'FAILED' || status === 'ERROR' ? 'destructive' : 'info'}>
              {status}
            </Badge>
          </div>
          {targetProjectId && (
            <Link
              to={`/projects/${targetProjectId}/runs`}
              className="inline-flex items-center gap-0.5 font-semibold text-ai-accent hover:underline hover:underline-offset-2"
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
        <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md bg-muted p-2 text-[12px]">
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

    case 'a2ui':
      // 질문 화면은 도구 줄이 아니라 ChatQuestionCard 로 따로 그린다.
      return null;
  }
}

/** 허락 요청: 기다리는 동안만 눈에 띄는 카드로 세우고, 결정되면 한 줄로 줄인다. */
function PermissionPrompt({
  block,
  onRespondPermission,
}: {
  block: ChatToolBlock;
  onRespondPermission: (requestId: string, decision: PermissionDecision) => Promise<void>;
}) {
  const [responding, setResponding] = useState(false);
  const permission = block.permission;
  if (!permission) return null;

  if (permission.decision) {
    const denied = permission.decision === 'DENY';
    const Icon = denied ? Ban : ShieldCheck;
    return (
      <p className="flex items-center gap-1.5 pl-7 text-[11px] text-muted-foreground">
        <Icon className={cn('h-3 w-3 shrink-0', denied ? 'text-destructive' : 'text-success')} aria-hidden />
        <span className={cn('font-semibold', denied ? 'text-destructive' : 'text-foreground')}>
          {DECISION_LABELS[permission.decision]}
        </span>
        {permission.reason && <span className="min-w-0 truncate">· {permission.reason}</span>}
      </p>
    );
  }

  const inputSummary = summarizeInput(block.input);
  const decide = async (decision: PermissionDecision) => {
    if (responding) return;
    setResponding(true);
    try {
      await onRespondPermission(permission.requestId, decision);
    } finally {
      setResponding(false);
    }
  };

  return (
    <div className="rounded-xl border border-warning/40 bg-warning/5 p-3 text-[12px]">
      <p className="flex items-center gap-1.5 text-[12px] font-semibold text-warning">
        <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
        허락이 필요해요
      </p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-foreground">{permission.reason}</p>
      {inputSummary && (
        <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{inputSummary}</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Button type="button" size="xs" disabled={responding} onClick={() => void decide('ALLOW')}>
          허용
        </Button>
        <Button
          type="button"
          size="xs"
          variant="secondary"
          disabled={responding}
          onClick={() => void decide('ALLOW_SESSION')}
        >
          이 대화에서 항상 허용
        </Button>
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={responding}
          onClick={() => void decide('DENY')}
        >
          거부
        </Button>
      </div>
    </div>
  );
}

/**
 * 도구 호출 한 건. 평소에는 조용한 한 줄이고, 누르면 입력 · 결과 상세가 펼쳐진다.
 * 사용자가 행동해야 하는 것(허락 요청, AI 작업 승인, 실행 링크)은 접혀 있어도 바로 보인다.
 */
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

  const label = getToolLabel(block.name);
  const durationText = toolDuration(block.durationMs);
  const headerSummary = block.summary || summarizeInput(block.input);
  const status = toolStatusView(block);
  const StatusIcon = status.icon;
  const alwaysVisibleDisplay =
    block.display?.kind === 'job' || block.display?.kind === 'execution';

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="group -mx-1.5 flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12px] text-muted-foreground transition-colors hover:bg-accent"
      >
        <StatusIcon
          className={cn('h-3.5 w-3.5 shrink-0', status.iconClass, status.spin && 'animate-spin')}
          aria-hidden
        />
        <span className="shrink-0 font-semibold text-secondary-foreground">{label}</span>
        <span className="min-w-0 flex-1 truncate text-[12px]">{headerSummary}</span>
        {status.text ? (
          <span className={cn('shrink-0 text-[11px] font-semibold', status.textClass)}>{status.text}</span>
        ) : (
          <>
            <span className="sr-only">성공</span>
            {durationText && <span className="shrink-0 font-mono text-[11px]">{durationText}</span>}
          </>
        )}
        <ChevronRight
          className={cn('h-3.5 w-3.5 shrink-0 opacity-50 transition-transform group-hover:opacity-100', open && 'rotate-90')}
          aria-hidden
        />
      </button>

      <PermissionPrompt block={block} onRespondPermission={onRespondPermission} />

      {!open && alwaysVisibleDisplay && block.display && (
        <ToolDisplayView display={block.display} block={block} projectId={projectId} />
      )}

      {open && (
        <div className="ml-1.5 space-y-2.5 border-l-2 border-border pl-3">
          <div>
            <p className="mb-1 text-[11px] font-semibold text-muted-foreground">입력</p>
            <pre className={cn(codeBoxClass, 'max-h-40')}>
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
                <pre className={cn(codeBoxClass, 'max-h-56 whitespace-pre-wrap')}>
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

function InlineError({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-1.5 rounded-lg bg-destructive/10 px-2.5 py-2 text-[12px] text-destructive">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

function AssistantMessageView({
  message,
  isStreamingMessage,
  isLatestAssistant,
  streaming,
  projectId,
  questionError,
  onRespondPermission,
  onAnswerQuestion,
}: {
  message: ChatMessage;
  isStreamingMessage: boolean;
  /** 가장 최근 assistant 메시지인가. 여기 있는 질문만 답할 수 있다. */
  isLatestAssistant: boolean;
  streaming: boolean;
  projectId?: string;
  questionError: { surfaceId: string; message: string } | null;
  onRespondPermission: (requestId: string, decision: PermissionDecision) => Promise<void>;
  onAnswerQuestion: (content: string, uiAction: ChatUiAction) => void;
}) {
  const renderBlock = (block: ChatBlock, idx: number) => {
    const isLastBlock = idx === message.blocks.length - 1;
    if (block.type === 'text') {
      return (
        <div key={`text-${idx}`} className="text-[14px] leading-relaxed text-foreground">
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

    if (block.display?.kind === 'a2ui') {
      const data = block.display.data;
      return (
        <ChatQuestionCard
          key={block.callId || `question-${idx}`}
          data={data}
          messageId={message.id}
          interactive={isLatestAssistant}
          busy={streaming}
          error={questionError?.surfaceId === data.surfaceId ? questionError.message : undefined}
          onAnswer={onAnswerQuestion}
        />
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

  const notes = [
    message.stopReason === 'CANCELLED' ? '답변이 중단되었습니다.' : null,
    message.stopReason === 'MAX_TURNS' ? '도구 실행 한도에 도달해 답변을 마무리했습니다.' : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-2">
      {message.blocks.length === 0 && isStreamingMessage ? (
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-ai-accent" aria-hidden />
          <span>AI가 답변을 준비하고 있습니다...</span>
        </p>
      ) : (
        message.blocks.map(renderBlock)
      )}

      {message.errorMessage && <InlineError>{message.errorMessage}</InlineError>}

      {notes.map((note) => (
        <p key={note} className="text-[11px] text-muted-foreground">
          {note}
        </p>
      ))}

      {message.usage && (
        <p className="text-[11px] text-muted-foreground/80">
          입력 {message.usage.inputTokens.toLocaleString()} · 출력{' '}
          {message.usage.outputTokens.toLocaleString()} 토큰
        </p>
      )}
    </div>
  );
}

/** 헤더의 작은 분할 버튼 묶음 (보기 탭 · 답변 수준). */
function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  role,
}: {
  label: string;
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  role?: 'tablist';
}) {
  return (
    <div role={role ?? 'group'} aria-label={label} className="inline-flex shrink-0 rounded-lg bg-muted p-0.5">
      {options.map((opt) => {
        const selected = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role={role ? 'tab' : undefined}
            aria-selected={role ? selected : undefined}
            aria-pressed={role ? undefined : selected}
            onClick={() => onChange(opt.id)}
            className={cn(
              'rounded-md px-2.5 py-1 text-[12px] font-semibold transition-colors',
              selected
                ? 'bg-card text-foreground shadow-sm ring-1 ring-border'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

const VIEW_TABS = [
  { id: 'tasks', label: '작업' },
  { id: 'chat', label: '대화' },
] as const;

const iconButtonClass =
  'rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground';

/**
 * 오른쪽 아래에 뜨는 AI 채팅 에이전트 창.
 *
 * 세션별로 대화가 서버에 저장되고, 답변 글과 도구 실행 · 허락 요청이 실시간 스트리밍으로 쌓인다.
 * 답변 본문이 주인공이고, 도구 호출은 조용한 한 줄로 두었다가 펼치면 상세를 보여 준다.
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
    questionError,
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

  // 작업 탭에서는 입력창이 숨겨져 높이가 0 으로 재지므로, 대화 탭으로 올 때도 다시 잰다.
  useEffect(() => {
    resizeInput();
  }, [question, view, resizeInput]);

  useEffect(() => {
    try {
      window.localStorage.setItem(LEVEL_STORAGE_KEY, userLevel);
    } catch {
      // 저장 실패는 무시한다.
    }
  }, [userLevel]);

  // 새 메시지나 스트리밍 조각이 붙거나 대화 탭으로 오면 최신 위치로 스크롤한다.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming, view]);

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

  const submitQuestion = () => {
    const q = question.trim();
    if (!q || streaming) return;
    setQuestion('');
    void sendMessage(q);
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    submitQuestion();
  };

  /**
   * Enter 로 보내고 Shift+Enter 로 줄을 바꾼다.
   * 한글 입력 중(조합 중)에는 Enter 가 글자 확정에 쓰이므로 보내지 않는다.
   */
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    submitQuestion();
  };

  const handleAnswerQuestion = (content: string, uiAction: ChatUiAction) => {
    if (streaming) return;
    void sendMessage(content, uiAction);
  };

  const sessionTitle = currentSession?.title?.trim() || '새 대화';
  let latestAssistantIdx = -1;
  messages.forEach((msg, idx) => {
    if (msg.role === 'assistant') latestAssistantIdx = idx;
  });

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
      {/* 헤더: 세션 선택(제목 + 맥락) · 새 대화 · 넓게 보기 · 닫기, 아래 줄에 보기 탭 · 답변 수준 */}
      <header className="shrink-0 border-b border-border px-3 pt-2.5 pb-2">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ai-accent/10 text-ai-accent">
            <Sparkles className="h-4 w-4" aria-hidden />
          </span>

          <div className="relative min-w-0 flex-1" ref={menuRef}>
            <button
              type="button"
              onClick={() => setSessionMenuOpen((prev) => !prev)}
              aria-haspopup="listbox"
              aria-expanded={sessionMenuOpen}
              aria-label="대화 세션 선택"
              className="flex max-w-full flex-col items-start rounded-md px-1.5 py-0.5 text-left hover:bg-accent"
            >
              <span className="flex max-w-full items-center gap-1 text-[13px] font-bold text-foreground">
                <span className="truncate">{sessionTitle}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              </span>
              <span className="max-w-full truncate text-[11px] text-muted-foreground" title={contextLabel}>
                {contextLabel}
              </span>
            </button>

            {sessionMenuOpen && (
              <div
                role="listbox"
                aria-label="대화 목록"
                className="absolute left-0 top-full z-50 mt-1 w-72 max-w-[calc(100vw-3rem)] overflow-hidden rounded-xl border border-border bg-card shadow-lg"
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
                    <MessageSquarePlus className="h-4 w-4 shrink-0" aria-hidden />
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
                            'group flex items-center gap-1 rounded-md px-2 py-1 text-[13px]',
                            active ? 'bg-primary-subtle font-semibold text-ai-accent' : 'text-foreground hover:bg-accent'
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
                            className="shrink-0 rounded p-1 text-muted-foreground opacity-60 hover:bg-destructive/10 hover:text-destructive hover:opacity-100 group-hover:opacity-100"
                            title="대화 삭제"
                            aria-label={`${title} 삭제`}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center">
            <button type="button" onClick={startNewSession} className={iconButtonClass} title="새 대화" aria-label="새 대화">
              <MessageSquarePlus className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => setWide((prev) => !prev)}
              className={iconButtonClass}
              title={wide ? '작게 보기' : '넓게 보기'}
              aria-label={wide ? '작게 보기' : '넓게 보기'}
            >
              {wide ? <Minimize2 className="h-4 w-4" aria-hidden /> : <Maximize2 className="h-4 w-4" aria-hidden />}
            </button>
            <button
              type="button"
              onClick={onClose}
              className={iconButtonClass}
              title="닫기 (Esc · Ctrl+/)"
              aria-label="AI 채팅 닫기"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <Segmented role="tablist" label="AI 패널 보기" options={VIEW_TABS} value={view} onChange={setView} />
          {view === 'chat' && (
            <Segmented label="답변 수준" options={levelOptions} value={userLevel} onChange={setUserLevel} />
          )}
        </div>
      </header>

      {view === 'tasks' && (
        <div className="flex-1 overflow-y-auto bg-background p-3">
          <AiTaskQueue projectId={projectId} />
        </div>
      )}

      {/* 대화 본문 */}
      <div
        ref={listRef}
        className={cn('flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-4', view !== 'chat' && 'hidden')}
      >
        {loadingSession && messages.length === 0 ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-ai-accent" aria-hidden />
            <span>대화를 불러오는 중...</span>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-1 flex-col justify-center gap-4">
            <div className="space-y-1.5">
              <Sparkles className="h-6 w-6 text-ai-accent" aria-hidden />
              <h2 className="text-[15px] font-bold text-foreground">무엇을 도와드릴까요?</h2>
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                실패 원인, 셀렉터, 실행 결과, DB 조회까지 물어보세요. 답변과 도구 실행 과정이 여기에 차례로 보여요.
              </p>
            </div>
            <ul className="flex flex-col gap-1.5" aria-label="시작 예시">
              {STARTER_PROMPTS.map((prompt) => (
                <li key={prompt}>
                  <button
                    type="button"
                    onClick={() => {
                      setQuestion(prompt);
                      inputRef.current?.focus();
                    }}
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-left text-[13px] text-foreground transition-colors hover:border-ai-accent/40 hover:bg-accent"
                  >
                    <span>{prompt}</span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
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
                <div key={msg.id || idx} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-[14px] leading-relaxed text-foreground">
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
                isLatestAssistant={idx === latestAssistantIdx}
                streaming={streaming}
                projectId={projectId}
                questionError={questionError}
                onRespondPermission={respondPermission}
                onAnswerQuestion={handleAnswerQuestion}
              />
            );
          })
        )}

        {error && <InlineError>{error}</InlineError>}
      </div>

      {/* 입력창: 여러 줄 입력, 진행 중에는 보내기 버튼 자리에 중단 버튼을 둔다 */}
      <form onSubmit={handleSend} className={cn('shrink-0 border-t border-border p-3', view !== 'chat' && 'hidden')}>
        <div className="flex items-end gap-2 rounded-xl border border-border bg-background py-1.5 pl-3 pr-1.5 transition-colors focus-within:border-primary focus-within:ring-1 focus-within:ring-primary">
          <textarea
            ref={inputRef}
            rows={1}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="AI에게 보낼 메시지"
            placeholder="무엇이든 물어보세요 (Shift+Enter 로 줄바꿈)"
            className="min-w-0 flex-1 resize-none overflow-y-auto bg-transparent py-1 text-[14px] leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:outline-none"
          />
          {streaming ? (
            <button
              type="button"
              onClick={() => void cancel()}
              className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-foreground px-3 text-[12px] font-semibold text-background hover:opacity-90"
              title="답변 중단"
              aria-label="중단"
            >
              <Square className="h-3 w-3 fill-current" aria-hidden />
              <span>중단</span>
            </button>
          ) : (
            <button
              type="submit"
              disabled={!question.trim()}
              // 콘솔 테마의 발광 그림자(index.css, 레이어 밖)는 !important 로만 끌 수 있다.
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary-hover disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none!"
              aria-label="보내기"
            >
              <ArrowUp className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
      </form>
    </aside>
  );
}
