import { useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock, MessageCircleQuestion } from 'lucide-react';
import { A2uiSurface, type A2uiActionMessage } from '@/components/a2ui/A2uiSurface';
import { applyUiAnswer, summarizeUiAction } from '@/lib/chatA2ui';
import type { ChatUiAction, ToolDisplayA2uiData } from '@/types';
import { cn } from '@/lib/utils';

/**
 * AI 가 `ask_user` 로 띄운 질문 화면 (docs/design/chat-a2ui-contract.md "웹 표시").
 *
 * - 가장 최근 assistant 메시지의 답 안 한 질문만 조작할 수 있다(interactive).
 * - 답한 질문은 고른 값이 보이는 채로 잠기고 "보낸 답" 을 붙인다. 지나간 옛 질문은 잠근다.
 * - 답변 스트림 중(busy)에는 막는다. 렌더러가 거부하면 카드 대신 안내 한 줄만 보인다.
 */
export function ChatQuestionCard({
  data,
  messageId,
  interactive,
  busy,
  error,
  onAnswer,
}: {
  data: ToolDisplayA2uiData;
  messageId: number;
  interactive: boolean;
  busy: boolean;
  error?: string;
  onAnswer: (content: string, uiAction: ChatUiAction) => void;
}) {
  // 서버가 거절해 답이 걷혀도 사용자가 고른 값은 남겨 다시 보낼 수 있게 한다.
  const [lastSent, setLastSent] = useState<ChatUiAction | null>(null);
  const answer = data.answer;
  const locked = Boolean(answer) || !interactive || busy;
  const shown = answer ?? lastSent;

  const messages = useMemo(
    () => (shown ? applyUiAnswer(data.messages, shown) : data.messages),
    [data.messages, shown]
  );

  const handleAction = ({ action }: A2uiActionMessage) => {
    if (locked) return;
    const uiAction: ChatUiAction = {
      messageId,
      surfaceId: data.surfaceId,
      name: action.name === 'cancel' ? 'cancel' : 'submit',
      context: action.context ?? {},
    };
    setLastSent(uiAction);
    onAnswer(summarizeUiAction(data.messages, action), uiAction);
  };

  return (
    <A2uiSurface
      messages={messages}
      onAction={handleAction}
      fallback="질문 화면을 보여 주지 못했어요."
      frame={(surface) => (
        <section
          aria-label={`질문: ${data.question}`}
          className={cn(
            'flex flex-col gap-3 rounded-xl border bg-card p-3.5',
            answer || !interactive ? 'border-border' : 'border-ai-accent/40 shadow-sm'
          )}
        >
          <h3 className="flex items-start gap-2 text-[13px] font-semibold leading-snug text-foreground">
            <MessageCircleQuestion className="mt-0.5 h-4 w-4 shrink-0 text-ai-accent" aria-hidden />
            <span>{data.question}</span>
          </h3>
          <fieldset disabled={locked} aria-label="질문 답" className="min-w-0">
            {surface}
          </fieldset>
          {answer ? (
            <p className="flex items-start gap-1.5 border-t border-border pt-2.5 text-[12px] text-muted-foreground">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
              <span>
                보낸 답: <span className="text-foreground">{answer.summary}</span>
              </span>
            </p>
          ) : !interactive ? (
            <p className="flex items-center gap-1.5 border-t border-border pt-2.5 text-[12px] text-muted-foreground">
              <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
              지나간 질문이에요
            </p>
          ) : null}
          {error && !answer && (
            <p role="alert" className="flex items-start gap-1.5 text-[12px] text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>{error}</span>
            </p>
          )}
        </section>
      )}
    />
  );
}
