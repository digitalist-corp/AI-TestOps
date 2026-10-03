import { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Bot,
  UserCheck,
  GraduationCap,
  Briefcase,
  AlertTriangle,
  Code2,
  ShieldCheck,
  Send,
  Loader2,
  Wrench,
  RotateCcw,
} from 'lucide-react';
import { api } from '@/api/client';
import type { Execution, UserLevel, AiAnalysisResponse, AiJob, PostApplyVerificationStatus } from '@/types';
import { Button } from '@/components/ui/Button';
import { AiMarkdown } from '@/components/ai/AiMarkdown';
import { useAiChat } from '@/hooks/useAiChat';
import { cn } from '@/lib/utils';

const aiJobStatusLabel: Record<AiJob['status'], string> = {
  PENDING: '대기 중',
  RUNNING: 'AI가 수정 시도 중...',
  DIFF_READY: '결과 처리 중',
  NEEDS_REVIEW: '관리자 검토 대기 (AI 검토 메뉴에서 승인/거부)',
  APPLIED: '적용 완료',
  REJECTED: '거부됨',
  FAILED: '수정 실패 (반복 상한 도달)',
  ERROR: '오류 발생',
  CANCELED: '취소됨',
  TIMEOUT: '시간 초과',
};

const aiJobTerminalStatuses: AiJob['status'][] = [
  'NEEDS_REVIEW', 'APPLIED', 'REJECTED', 'FAILED', 'ERROR', 'CANCELED', 'TIMEOUT',
];

const postApplyVerificationLabel: Record<PostApplyVerificationStatus, string> = {
  PENDING: '확인 중',
  PASSED: '이상 없음',
  REGRESSED: '회귀 감지됨 → 자동 되돌림',
  SKIPPED: '건너뜀',
};

interface AiAnalysisTabProps {
  projectId: string;
  executions: Execution[];
  selectedExecutionId: number | null;
  onSelectExecution: (id: number) => void;
}

const levelRadioOptions: {
  id: UserLevel;
  label: string;
  badge: string;
  icon: typeof UserCheck;
}[] = [
  {
    id: 'NON_DEVELOPER',
    label: '비전공자 / 입문자',
    badge: '쉬운 비유 중심',
    icon: UserCheck,
  },
  {
    id: 'JUNIOR',
    label: '주니어 (학부생/추천)',
    badge: '코드 팁 중심',
    icon: GraduationCap,
  },
  {
    id: 'SENIOR',
    label: '시니어 (전문가/QA)',
    badge: '아키텍처/스택',
    icon: Briefcase,
  },
];

export function AiAnalysisTab({
  projectId,
  executions,
  selectedExecutionId,
  onSelectExecution,
}: AiAnalysisTabProps) {
  const [userLevel, setUserLevel] = useState<UserLevel>('JUNIOR');
  const [targetExecutionId, setTargetExecutionId] = useState<number | null>(
    selectedExecutionId ?? (executions.length > 0 ? executions[0].id : null)
  );

  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<AiAnalysisResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Sandbox 자율 수정 루프(CODE_FIX) 트리거 상태
  const [codeFixInstruction, setCodeFixInstruction] = useState(
    '이 테스트가 실패하는 원인을 분석하고, 테스트를 통과하도록 spec 파일을 수정해줘.'
  );
  const [codeFixLoading, setCodeFixLoading] = useState(false);
  const [codeFixJob, setCodeFixJob] = useState<AiJob | null>(null);
  const [codeFixError, setCodeFixError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCountRef = useRef(0);

  // Chat Q&A State (대화 이력/전송은 공용 훅에 위임)
  const [chatQuestion, setChatQuestion] = useState('');
  const {
    messages: chatMessages,
    loading: chatLoading,
    send: sendChat,
    clear: clearChat,
  } = useAiChat({ executionId: targetExecutionId ?? undefined, userLevel });
  const chatListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = chatListRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatMessages.length, chatLoading]);

  useEffect(() => {
    if (selectedExecutionId) {
      setTargetExecutionId(selectedExecutionId);
    } else if (executions.length > 0 && !targetExecutionId) {
      setTargetExecutionId(executions[0].id);
    }
  }, [selectedExecutionId, executions]);

  const handleRunAnalysis = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.ai.analyzeExecution({
        executionId: targetExecutionId ?? undefined,
        userLevel,
      });
      setAnalysis(res);
    } catch (err: any) {
      setErrorMsg(err.message || 'AI 분석 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = chatQuestion.trim();
    if (!q || chatLoading) return;
    setChatQuestion('');
    await sendChat(q);
  };

  const currentExec = executions.find((e) => e.id === targetExecutionId);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => stopPolling, []);

  const handleTriggerCodeFix = async () => {
    if (!currentExec || !currentExec.specPath) return;
    setCodeFixLoading(true);
    setCodeFixError('');
    stopPolling();
    try {
      const job = await api.aiJobs.create(projectId, {
        failedExecutionId: currentExec.id,
        targetSpecPath: currentExec.specPath,
        instruction: codeFixInstruction,
      });
      setCodeFixJob(job);
      pollCountRef.current = 0;

      pollRef.current = setInterval(async () => {
        try {
          const jobs = await api.aiJobs.listByProject(projectId);
          const updated = jobs.find((j) => j.id === job.id);
          if (updated) {
            setCodeFixJob(updated);
            pollCountRef.current += 1;
            // APPLIED 이후에도 사후 검증(안전망)이 비동기로 진행되므로, 그 결과(postApplyVerificationStatus)가
            // PENDING을 벗어날 때까지 잠깐 더 폴링한다 — 다만 검증이 오래 걸리는 경우를 대비해 상한(최대 40회≈2분)을 둔다.
            const verificationPending =
              updated.status === 'APPLIED' &&
              (!updated.postApplyVerificationStatus || updated.postApplyVerificationStatus === 'PENDING');
            const done = aiJobTerminalStatuses.includes(updated.status) && !verificationPending;
            if (done || pollCountRef.current > 40) {
              stopPolling();
            }
          }
        } catch {
          // 폴링 중 일시적 오류는 무시하고 다음 tick에 재시도
        }
      }, 3000);
    } catch (err: any) {
      setCodeFixError(err.message || 'AI 수정 요청 실패');
    } finally {
      setCodeFixLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 1. 상단 컨트롤 바 (다른 페이지와 100% 동일한 깔끔한 백색 카드 디자인) */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex flex-col @5xl:flex-row @5xl:items-center justify-between gap-4">
          {/* 타겟 실행 이력 선택 */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">실행 이력:</span>
            <select
              value={targetExecutionId ?? ''}
              onChange={(e) => {
                const val = Number(e.target.value);
                setTargetExecutionId(val);
                onSelectExecution(val);
              }}
              className="rounded-lg border border-border bg-muted px-3 py-1.5 text-xs font-semibold text-foreground focus:border-primary focus:bg-card focus:outline-none"
            >
              {executions.length === 0 ? (
                <option value="">실행 이력 없음</option>
              ) : (
                executions.map((e) => (
                  <option key={e.id} value={e.id}>
                    #{e.id} [{e.status}] - {e.finishedAt ? new Date(e.finishedAt).toLocaleTimeString() : '진행중'} (통과:{e.passedTests}/실패:{e.failedTests})
                  </option>
                ))
              )}
            </select>
            {currentExec && (
              <span
                className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                  currentExec.status === 'PASSED'
                    ? 'bg-success/10 text-success border border-success/30'
                    : currentExec.status === 'FAILED'
                    ? 'bg-destructive/10 text-destructive border border-destructive/30'
                    : 'bg-warning/10 text-warning border border-warning/30'
                }`}
              >
                {currentExec.status} ({currentExec.durationMs ?? 0}ms)
              </span>
            )}
          </div>

          {/* 컴팩트 직무 수준 라디오 세그먼트 버튼 */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">분석 수준:</span>
            <div className="inline-flex rounded-lg bg-muted p-1 border border-border">
              {levelRadioOptions.map((opt) => {
                const isSelected = userLevel === opt.id;
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setUserLevel(opt.id)}
                    className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                      isSelected
                        ? 'bg-card text-primary shadow-sm border border-border font-bold'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                    }`}
                  >
                    <Icon className={`h-3.5 w-3.5 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} />
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* AI 분석 실행 버튼 */}
          <Button
            onClick={handleRunAnalysis}
            disabled={loading}
            className="bg-primary hover:opacity-90 text-primary-foreground font-semibold px-4 py-2 rounded-lg text-xs transition-colors shrink-0"
          >
            {loading ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                AI 분석 중...
              </>
            ) : (
              <>
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                AI 분석 실행
              </>
            )}
          </Button>
        </div>
      </div>

      {/* 오류 메시지 */}
      {errorMsg && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Sandbox 자율 수정 루프 (CODE_FIX) 트리거 */}
      {currentExec?.status === 'FAILED' && (
        <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 space-y-3">
          <div className="flex items-center gap-2 text-warning font-bold text-xs">
            <Wrench className="h-4 w-4" />
            AI 자율 수정 시도 (Sandbox 루프)
          </div>

          {!currentExec.specPath ? (
            <p className="text-xs text-muted-foreground">
              단일 spec 파일 실행이 아니라 자동 수정 대상을 특정할 수 없습니다 (spec 파일 하나를 지정해 재실행한 케이스에서만 사용할 수 있습니다).
            </p>
          ) : !codeFixJob ? (
            <>
              <textarea
                rows={2}
                value={codeFixInstruction}
                onChange={(e) => setCodeFixInstruction(e.target.value)}
                className="w-full rounded-lg border border-warning/30 bg-card px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-warning/50"
              />
              <p className="text-[11px] text-muted-foreground">
                대상 파일: <span className="font-mono">{currentExec.specPath}</span> — AI가 최대 반복 횟수까지 수정→재실행을 시도합니다.
                수정 결과는 자동 반영되지 않고, 관리자가 "AI 검토" 메뉴에서 승인해야 실제 파일에 적용됩니다.
              </p>
              <Button
                onClick={handleTriggerCodeFix}
                disabled={codeFixLoading}
                className="bg-warning hover:opacity-90 text-warning-foreground font-semibold text-xs"
              >
                {codeFixLoading ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> 요청 중...
                  </>
                ) : (
                  <>
                    <Wrench className="mr-1.5 h-3.5 w-3.5" /> AI로 수정 시도
                  </>
                )}
              </Button>
            </>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-foreground">Job #{codeFixJob.id}</span>
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-warning/15 text-warning">
                  {aiJobStatusLabel[codeFixJob.status]}
                </span>
                {!aiJobTerminalStatuses.includes(codeFixJob.status) && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-warning" />
                )}
                {codeFixJob.status === 'APPLIED' && codeFixJob.postApplyVerificationStatus && (
                  <span
                    className={cn(
                      'text-[11px] font-medium px-2 py-0.5 rounded-full',
                      codeFixJob.postApplyVerificationStatus === 'REGRESSED' && 'bg-destructive/10 text-destructive',
                      codeFixJob.postApplyVerificationStatus === 'PASSED' && 'bg-success/10 text-success',
                      codeFixJob.postApplyVerificationStatus === 'SKIPPED' && 'bg-muted text-muted-foreground',
                      codeFixJob.postApplyVerificationStatus === 'PENDING' && 'bg-warning/15 text-warning',
                    )}
                  >
                    사후 검증: {postApplyVerificationLabel[codeFixJob.postApplyVerificationStatus]}
                  </span>
                )}
              </div>
              {codeFixJob.riskFlags && codeFixJob.riskFlags !== '[]' && (
                <p className="text-[11px] text-warning font-mono break-all">위험 신호: {codeFixJob.riskFlags}</p>
              )}
              {codeFixJob.summary && (
                <p className="text-xs text-muted-foreground whitespace-pre-wrap">{codeFixJob.summary}</p>
              )}
              {codeFixJob.errorMessage && <p className="text-xs text-destructive">{codeFixJob.errorMessage}</p>}
              {aiJobTerminalStatuses.includes(codeFixJob.status) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCodeFixJob(null)}
                  className="text-xs mt-1"
                >
                  다시 시도
                </Button>
              )}
            </div>
          )}

          {codeFixError && <p className="text-xs text-destructive">{codeFixError}</p>}
        </div>
      )}

      {/* 2. AI 분석 결과 리포트 (깔끔한 백색 미니멀 카드) */}
      {analysis ? (
        <div className="space-y-4">
          {/* 한 줄 요약 */}
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
            <div className="flex items-center gap-2 text-primary font-bold text-xs mb-1">
              <Sparkles className="h-4 w-4 text-primary" />
              AI 한 줄 진단 요약
            </div>
            <p className="text-foreground text-sm font-semibold leading-relaxed pl-6">
              {analysis.summary}
            </p>
          </div>

          {/* 3대 상세 해설 카드 */}
          <div className="grid grid-cols-1 @3xl:grid-cols-3 gap-4">
            {/* 🔍 맞춤형 원인 해설 */}
            <div className="rounded-xl border border-border bg-card p-4 flex flex-col space-y-2">
              <div className="flex items-center justify-between border-b border-border pb-2">
                <div className="flex items-center gap-1.5 text-foreground font-bold text-xs">
                  <Bot className="h-4 w-4 text-primary" />
                  맞춤형 원인 해설
                </div>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                  {userLevel}
                </span>
              </div>
              <div className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line pt-1 flex-1">
                {analysis.detailedExplanation}
              </div>
            </div>

            {/* 💡 추천 조치 & 소스 코드 팁 */}
            <div className="rounded-xl border border-border bg-card p-4 flex flex-col space-y-2">
              <div className="flex items-center gap-1.5 text-foreground font-bold text-xs border-b border-border pb-2">
                <Code2 className="h-4 w-4 text-warning" />
                추천 조치 & 소스 코드 팁
              </div>
              <div className="text-xs text-foreground leading-relaxed whitespace-pre-line font-mono bg-muted p-2.5 rounded-lg border border-border text-[11px] overflow-x-auto flex-1">
                {analysis.recommendedCodeFix}
              </div>
            </div>

            {/* 🛡️ 향후 예방 팁 */}
            <div className="rounded-xl border border-border bg-card p-4 flex flex-col space-y-2">
              <div className="flex items-center gap-1.5 text-foreground font-bold text-xs border-b border-border pb-2">
                <ShieldCheck className="h-4 w-4 text-success" />
                향후 재발 방지 팁
              </div>
              <div className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line pt-1 flex-1">
                {analysis.preventionTips}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-muted/50 p-8 text-center space-y-2">
          <Sparkles className="mx-auto h-8 w-8 text-muted-foreground" />
          <h4 className="text-xs font-bold text-foreground">AI 분석 대기 중</h4>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            상단 [AI 분석 실행] 버튼을 누르시면 선택한 기술 수준({userLevel})에 맞춰 테스트 실패 원인과 개선 코드를 진단해 드립니다.
          </p>
        </div>
      )}

      {/* 3. 대화형 AI 추가 질문 (깔끔한 미니멀 디자인) */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-foreground font-bold text-xs">
            <Bot className="h-4 w-4 text-primary" />
            AI 대화형 도우미 (이 오류나 시나리오에 대해 자유롭게 질문해 보세요)
          </div>
          {chatMessages.length > 0 && (
            <button
              type="button"
              onClick={clearChat}
              disabled={chatLoading}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              title="대화 초기화"
            >
              <RotateCcw className="h-3 w-3" />
              대화 초기화
            </button>
          )}
        </div>

        {/* 대화 목록 */}
        {chatMessages.length > 0 && (
          <div ref={chatListRef} className="space-y-2.5 max-h-64 overflow-y-auto p-3 rounded-lg bg-muted border border-border">
            {chatMessages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex gap-2 text-xs ${
                  msg.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                <div
                  className={`max-w-xl rounded-xl px-3.5 py-2 ${
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground font-medium rounded-br-none'
                      : 'bg-card border border-border text-foreground rounded-bl-none'
                  }`}
                >
                  {msg.role === 'user' ? (
                    <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                  ) : (
                    <AiMarkdown content={msg.content} className="leading-relaxed" />
                  )}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin text-primary" />
                AI 답변 작성 중...
              </div>
            )}
          </div>
        )}

        {/* Q&A 질문 입력폼 */}
        <form onSubmit={handleSendChat} className="flex gap-2">
          <input
            type="text"
            value={chatQuestion}
            onChange={(e) => setChatQuestion(e.target.value)}
            placeholder="예: 이 오류를 고치려면 Playwright 코드에서 waitForTimeout 대신 무얼 써야 하나요?"
            className="flex-1 rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:bg-card focus:outline-none"
          />
          <Button
            type="submit"
            disabled={chatLoading || !chatQuestion.trim()}
            className="bg-primary hover:opacity-90 text-primary-foreground rounded-lg px-4 text-xs font-semibold"
          >
            {chatLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          </Button>
        </form>
      </div>
    </div>
  );
}
