import { describe, expect, it } from 'vitest';
import {
  cancelAssistantMessage,
  createAssistantMessage,
  getToolLabel,
  reduceAssistantMessage,
  reduceChatMessages,
} from './chatReducer';
import type { ChatStreamEvent } from '@/types';

describe('reduceAssistantMessage', () => {
  it('연속된 text_delta 를 하나의 text 블록으로 누적한다', () => {
    let msg = createAssistantMessage(10);
    msg = reduceAssistantMessage(msg, { type: 'text_delta', data: { delta: '안녕' } });
    msg = reduceAssistantMessage(msg, { type: 'text_delta', data: { delta: '하세요, ' } });
    msg = reduceAssistantMessage(msg, { type: 'text_delta', data: { delta: '반갑습니다.' } });

    expect(msg.blocks).toEqual([{ type: 'text', text: '안녕하세요, 반갑습니다.' }]);
  });

  it('도구 호출 뒤에 오는 text_delta 는 새 text 블록으로 분리한다', () => {
    let msg = createAssistantMessage(10);
    msg = reduceAssistantMessage(msg, { type: 'text_delta', data: { delta: '먼저 파일을 확인합니다.' } });
    msg = reduceAssistantMessage(msg, {
      type: 'tool_start',
      data: { callId: 'call-1', name: 'read_file', tier: 'READ', input: { path: 'tests/a.spec.ts' } },
    });
    msg = reduceAssistantMessage(msg, {
      type: 'tool_end',
      data: {
        callId: 'call-1',
        status: 'ok',
        summary: 'tests/a.spec.ts',
        output: 'test("login", ...)',
        durationMs: 42,
      },
    });
    msg = reduceAssistantMessage(msg, { type: 'text_delta', data: { delta: '파일을 읽었습니다.' } });
    msg = reduceAssistantMessage(msg, { type: 'text_delta', data: { delta: ' 문제는 12행입니다.' } });

    expect(msg.blocks).toHaveLength(3);
    expect(msg.blocks[0]).toEqual({ type: 'text', text: '먼저 파일을 확인합니다.' });
    expect(msg.blocks[1]).toEqual({
      type: 'tool',
      callId: 'call-1',
      name: 'read_file',
      tier: 'READ',
      input: { path: 'tests/a.spec.ts' },
      status: 'ok',
      summary: 'tests/a.spec.ts',
      output: 'test("login", ...)',
      durationMs: 42,
    });
    expect(msg.blocks[2]).toEqual({ type: 'text', text: '파일을 읽었습니다. 문제는 12행입니다.' });
  });

  it('tool_start → tool_end 상태 변화와 display 정보를 반영한다', () => {
    let msg = createAssistantMessage(10);
    msg = reduceAssistantMessage(msg, {
      type: 'tool_start',
      data: { callId: 'call-sql', name: 'sql_query', tier: 'READ', input: { sql: 'SELECT id FROM ai_ro.executions' } },
    });

    expect(msg.blocks[0]).toMatchObject({
      type: 'tool',
      callId: 'call-sql',
      status: 'running',
    });

    msg = reduceAssistantMessage(msg, {
      type: 'tool_end',
      data: {
        callId: 'call-sql',
        status: 'ok',
        summary: '2행',
        durationMs: 18,
        display: {
          kind: 'table',
          data: {
            columns: ['id'],
            rows: [[1], [2]],
            truncated: false,
            sql: 'SELECT id FROM ai_ro.executions',
          },
        },
      },
    });

    expect(msg.blocks[0]).toEqual({
      type: 'tool',
      callId: 'call-sql',
      name: 'sql_query',
      tier: 'READ',
      input: { sql: 'SELECT id FROM ai_ro.executions' },
      status: 'ok',
      summary: '2행',
      durationMs: 18,
      display: {
        kind: 'table',
        data: {
          columns: ['id'],
          rows: [[1], [2]],
          truncated: false,
          sql: 'SELECT id FROM ai_ro.executions',
        },
      },
    });
  });

  it('permission_request 와 permission_resolved 이벤트를 해당 도구 블록에 기록한다', () => {
    let msg = createAssistantMessage(10);
    msg = reduceAssistantMessage(msg, {
      type: 'tool_start',
      data: { callId: 'call-run', name: 'run_tests', tier: 'RUN', input: { specPath: 'tests/login.spec.ts' } },
    });
    msg = reduceAssistantMessage(msg, {
      type: 'permission_request',
      data: {
        requestId: 'req-1',
        callId: 'call-run',
        name: 'run_tests',
        input: { specPath: 'tests/login.spec.ts' },
        reason: 'tests/login.spec.ts 테스트를 실행합니다.',
      },
    });

    expect(msg.blocks[0]).toMatchObject({
      type: 'tool',
      callId: 'call-run',
      status: 'running',
      permission: {
        requestId: 'req-1',
        reason: 'tests/login.spec.ts 테스트를 실행합니다.',
      },
    });

    msg = reduceAssistantMessage(msg, {
      type: 'permission_resolved',
      data: { requestId: 'req-1', decision: 'ALLOW_SESSION' },
    });

    expect(msg.blocks[0]).toMatchObject({
      type: 'tool',
      callId: 'call-run',
      permission: {
        requestId: 'req-1',
        reason: 'tests/login.spec.ts 테스트를 실행합니다.',
        decision: 'ALLOW_SESSION',
      },
    });
  });

  it('usage 와 message_end stopReason 을 기록한다', () => {
    let msg = createAssistantMessage(-1);
    const events: ChatStreamEvent[] = [
      { type: 'message_start', data: { userMessageId: 100, messageId: 101 } },
      { type: 'text_delta', data: { delta: '답변 완료' } },
      { type: 'usage', data: { inputTokens: 320, outputTokens: 85 } },
      { type: 'message_end', data: { messageId: 101, stopReason: 'END' } },
    ];
    for (const ev of events) {
      msg = reduceAssistantMessage(msg, ev);
    }

    expect(msg.id).toBe(101);
    expect(msg.stopReason).toBe('END');
    expect(msg.usage).toEqual({ inputTokens: 320, outputTokens: 85 });
  });

  it('취소 시 stopReason 을 CANCELLED 로 바꾸고 실행 중이던 도구를 cancelled 상태로 마감한다', () => {
    let msg = createAssistantMessage(55);
    msg = reduceAssistantMessage(msg, {
      type: 'tool_start',
      data: { callId: 'call-1', name: 'search_logs', tier: 'READ', input: { query: 'TimeoutError' } },
    });

    const cancelled = cancelAssistantMessage(msg);
    expect(cancelled.stopReason).toBe('CANCELLED');
    expect(cancelled.blocks[0]).toMatchObject({
      type: 'tool',
      callId: 'call-1',
      status: 'cancelled',
    });

    // 서버에서 message_end{CANCELLED} 로 닫히는 경우에도 동일하게 처리된다
    const endedByServer = reduceAssistantMessage(msg, {
      type: 'message_end',
      data: { messageId: 55, stopReason: 'CANCELLED' },
    });
    expect(endedByServer.stopReason).toBe('CANCELLED');
    expect(endedByServer.blocks[0]).toMatchObject({
      type: 'tool',
      callId: 'call-1',
      status: 'cancelled',
    });
  });
});

describe('reduceChatMessages', () => {
  it('start_turn 후 message_start 가 오면 사용자 · 어시스턴트 메시지 id 를 서버 id 로 갱신한다', () => {
    let messages = reduceChatMessages([], {
      type: 'start_turn',
      userText: '최근 실패 보여줘',
      tempUserId: -1,
      tempAssistantId: -2,
      now: '2026-11-01T09:00:00Z',
    });
    expect(messages).toHaveLength(2);

    messages = reduceChatMessages(messages, {
      type: 'stream_event',
      event: { type: 'message_start', data: { userMessageId: 11, messageId: 12 } },
    });
    messages = reduceChatMessages(messages, {
      type: 'stream_event',
      event: { type: 'text_delta', data: { delta: '조회하겠습니다.' } },
    });

    expect(messages[0].id).toBe(11);
    expect(messages[1].id).toBe(12);
    expect(messages[1].blocks).toEqual([{ type: 'text', text: '조회하겠습니다.' }]);
  });
});

describe('getToolLabel', () => {
  it('계약된 도구 13종의 한국어 라벨을 돌려주고 모르는 이름은 그대로 반환한다', () => {
    expect(getToolLabel('sql_query')).toBe('DB 조회');
    expect(getToolLabel('read_file')).toBe('파일 읽기');
    expect(getToolLabel('list_files')).toBe('파일 목록');
    expect(getToolLabel('grep_files')).toBe('코드 검색');
    expect(getToolLabel('search_logs')).toBe('로그 검색');
    expect(getToolLabel('list_executions')).toBe('실행 목록');
    expect(getToolLabel('get_execution_detail')).toBe('실행 상세');
    expect(getToolLabel('get_case_history')).toBe('케이스 이력');
    expect(getToolLabel('get_sitemap')).toBe('화면 구조');
    expect(getToolLabel('get_job_status')).toBe('작업 상태');
    expect(getToolLabel('run_tests')).toBe('테스트 실행');
    expect(getToolLabel('fix_test')).toBe('테스트 수정');
    expect(getToolLabel('generate_scenario')).toBe('테스트 생성');
    expect(getToolLabel('custom_unknown_tool')).toBe('custom_unknown_tool');
  });
});
