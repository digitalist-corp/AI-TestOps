import type {
  ChatBlock,
  ChatMessage,
  ChatStreamEvent,
  ChatToolBlock,
  PermissionDecision,
} from '@/types';

/** 계약 문서(P1)의 도구 이름 한국어 라벨. 사전에 없는 이름은 원래 이름을 그대로 쓴다. */
export const TOOL_LABELS: Record<string, string> = {
  sql_query: 'DB 조회',
  read_file: '파일 읽기',
  list_files: '파일 목록',
  grep_files: '코드 검색',
  search_logs: '로그 검색',
  list_executions: '실행 목록',
  get_execution_detail: '실행 상세',
  get_case_history: '케이스 이력',
  get_sitemap: '화면 구조',
  get_job_status: '작업 상태',
  run_tests: '테스트 실행',
  fix_test: '테스트 수정',
  generate_scenario: '테스트 생성',
  set_env_variables: '환경변수 저장',
};

export function getToolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name;
}

export function createAssistantMessage(
  id = -Date.now(),
  createdAt = new Date().toISOString()
): ChatMessage {
  return {
    id,
    role: 'assistant',
    createdAt,
    blocks: [],
  };
}

function updateToolBlocks(
  blocks: ChatBlock[],
  predicate: (block: ChatToolBlock) => boolean,
  updater: (block: ChatToolBlock) => ChatToolBlock
): { blocks: ChatBlock[]; matched: boolean } {
  let matched = false;
  const next = blocks.map((block) => {
    if (block.type === 'tool' && predicate(block)) {
      matched = true;
      return updater(block);
    }
    return block;
  });
  return { blocks: matched ? next : blocks, matched };
}

/**
 * 진행 중이던 답변이 중단됐을 때 stopReason 과 실행 중인 도구 상태를 마감한다.
 */
export function cancelAssistantMessage(message: ChatMessage): ChatMessage {
  const blocks = message.blocks.map((block) => {
    if (block.type === 'tool' && block.status === 'running') {
      return { ...block, status: 'cancelled' as const };
    }
    return block;
  });
  return {
    ...message,
    blocks,
    stopReason: 'CANCELLED',
  };
}

/**
 * SSE 이벤트 한 건을 받아 assistant 메시지의 blocks · 상태를 갱신하는 순수 리듀서.
 */
export function reduceAssistantMessage(
  message: ChatMessage,
  event: ChatStreamEvent
): ChatMessage {
  switch (event.type) {
    case 'message_start': {
      return {
        ...message,
        id: event.data.messageId,
      };
    }

    case 'text_delta': {
      const { delta } = event.data;
      if (!delta) return message;
      const blocks = message.blocks;
      const last = blocks[blocks.length - 1];
      if (last && last.type === 'text') {
        return {
          ...message,
          blocks: [
            ...blocks.slice(0, -1),
            { type: 'text', text: last.text + delta },
          ],
        };
      }
      return {
        ...message,
        blocks: [...blocks, { type: 'text', text: delta }],
      };
    }

    case 'tool_start': {
      const { callId, name, tier, input } = event.data;
      const { blocks, matched } = updateToolBlocks(
        message.blocks,
        (b) => b.callId === callId,
        (b) => ({ ...b, name, tier, input, status: 'running' })
      );
      if (matched) {
        return { ...message, blocks };
      }
      const nextTool: ChatToolBlock = {
        type: 'tool',
        callId,
        name,
        tier,
        input,
        status: 'running',
      };
      return {
        ...message,
        blocks: [...message.blocks, nextTool],
      };
    }

    case 'permission_request': {
      const { requestId, callId, name, input, reason } = event.data;
      const { blocks, matched } = updateToolBlocks(
        message.blocks,
        (b) => b.callId === callId,
        (b) => ({
          ...b,
          permission: { requestId, reason, decision: b.permission?.decision },
        })
      );
      if (matched) {
        return { ...message, blocks };
      }
      const fallbackTool: ChatToolBlock = {
        type: 'tool',
        callId,
        name,
        tier: 'RUN',
        input,
        status: 'running',
        permission: { requestId, reason },
      };
      return {
        ...message,
        blocks: [...message.blocks, fallbackTool],
      };
    }

    case 'permission_resolved': {
      const { requestId, decision } = event.data;
      const { blocks } = updateToolBlocks(
        message.blocks,
        (b) => b.permission?.requestId === requestId,
        (b) => ({
          ...b,
          permission: b.permission
            ? { ...b.permission, decision }
            : { requestId, reason: '', decision },
        })
      );
      return { ...message, blocks };
    }

    case 'tool_end': {
      const { callId, status, summary, output, display, durationMs } = event.data;
      const { blocks } = updateToolBlocks(
        message.blocks,
        (b) => b.callId === callId,
        (b) => {
          const updated: ChatToolBlock = {
            ...b,
            status,
          };
          if (summary !== undefined) updated.summary = summary;
          if (output !== undefined) updated.output = output;
          if (display !== undefined) updated.display = display;
          if (durationMs !== undefined) updated.durationMs = durationMs;
          return updated;
        }
      );
      return { ...message, blocks };
    }

    case 'usage': {
      return {
        ...message,
        usage: {
          inputTokens: event.data.inputTokens,
          outputTokens: event.data.outputTokens,
        },
      };
    }

    case 'error': {
      return {
        ...message,
        errorMessage: event.data.message,
      };
    }

    case 'message_end': {
      const { messageId, stopReason } = event.data;
      if (stopReason === 'CANCELLED') {
        const cancelled = cancelAssistantMessage(message);
        return {
          ...cancelled,
          id: messageId || message.id,
        };
      }
      return {
        ...message,
        id: messageId || message.id,
        stopReason,
      };
    }
  }
}

export type ChatMessagesAction =
  | { type: 'set_messages'; messages: ChatMessage[] }
  | {
      type: 'start_turn';
      userText: string;
      tempUserId?: number;
      tempAssistantId?: number;
      now?: string;
    }
  | { type: 'stream_event'; event: ChatStreamEvent }
  | { type: 'resolve_permission'; requestId: string; decision: PermissionDecision }
  | { type: 'cancel_turn' }
  | { type: 'fail_turn'; errorMessage: string };

/**
 * 한 세션의 전체 메시지 배열을 갱신하는 순수 리듀서.
 */
export function reduceChatMessages(
  messages: ChatMessage[],
  action: ChatMessagesAction
): ChatMessage[] {
  switch (action.type) {
    case 'set_messages':
      return action.messages;

    case 'start_turn': {
      const now = action.now ?? new Date().toISOString();
      const userId = action.tempUserId ?? -Date.now();
      const assistantId = action.tempAssistantId ?? userId - 1;
      const userMsg: ChatMessage = {
        id: userId,
        role: 'user',
        createdAt: now,
        blocks: [{ type: 'text', text: action.userText }],
      };
      const assistantMsg = createAssistantMessage(assistantId, now);
      return [...messages, userMsg, assistantMsg];
    }

    case 'stream_event': {
      if (messages.length === 0) return messages;
      const next = [...messages];
      const lastIdx = next.length - 1;
      const lastMsg = next[lastIdx];

      if (action.event.type === 'message_start') {
        // 직전 user 메시지가 임시 id 면 서버가 저장한 userMessageId 로 교체한다.
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].role === 'user') {
            next[i] = { ...next[i], id: action.event.data.userMessageId };
            break;
          }
        }
      }

      if (lastMsg.role === 'assistant') {
        next[lastIdx] = reduceAssistantMessage(lastMsg, action.event);
      }
      return next;
    }

    case 'resolve_permission': {
      return messages.map((msg) =>
        msg.role === 'assistant'
          ? reduceAssistantMessage(msg, {
              type: 'permission_resolved',
              data: { requestId: action.requestId, decision: action.decision },
            })
          : msg
      );
    }

    case 'cancel_turn': {
      if (messages.length === 0) return messages;
      const lastIdx = messages.length - 1;
      const last = messages[lastIdx];
      if (last.role !== 'assistant') return messages;
      return [...messages.slice(0, lastIdx), cancelAssistantMessage(last)];
    }

    case 'fail_turn': {
      if (messages.length === 0) return messages;
      const lastIdx = messages.length - 1;
      const last = messages[lastIdx];
      if (last.role !== 'assistant') return messages;
      const blocks = last.blocks.map((b) =>
        b.type === 'tool' && b.status === 'running' ? { ...b, status: 'error' as const } : b
      );
      return [
        ...messages.slice(0, lastIdx),
        {
          ...last,
          blocks,
          errorMessage: action.errorMessage,
          stopReason: last.stopReason ?? 'ERROR',
        },
      ];
    }
  }
}
