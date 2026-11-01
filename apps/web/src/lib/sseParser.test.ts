import { describe, expect, it } from 'vitest';
import type { ChatStreamEvent } from '@/types';
import {
  createSseParser,
  parseChatStreamEvent,
  readSseStream,
  type RawSseEvent,
} from './sseParser';

describe('createSseParser', () => {
  it('한 청크에 담긴 여러 SSE 이벤트를 순서대로 파싱한다', () => {
    const events: RawSseEvent[] = [];
    const parser = createSseParser((ev) => events.push(ev));

    parser.push(
      'event: message_start\ndata: {"userMessageId":1,"messageId":2}\n\n' +
        'event: text_delta\ndata: {"delta":"안녕"}\n\n' +
        'event: message_end\ndata: {"messageId":2,"stopReason":"END"}\n\n'
    );
    parser.finish();

    expect(events).toEqual([
      { event: 'message_start', data: '{"userMessageId":1,"messageId":2}' },
      { event: 'text_delta', data: '{"delta":"안녕"}' },
      { event: 'message_end', data: '{"messageId":2,"stopReason":"END"}' },
    ]);
  });

  it('청크 경계에서 이벤트 줄과 빈 줄이 쪼개져도 정확히 이어 붙인다', () => {
    const events: RawSseEvent[] = [];
    const parser = createSseParser((ev) => events.push(ev));

    parser.push('even');
    parser.push('t: text_del');
    parser.push('ta\nda');
    parser.push('ta: {"delta":"반갑');
    parser.push('습니다"}\n');
    expect(events).toHaveLength(0);

    // 빈 줄이 들어오는 순간 이벤트가 방출된다
    parser.push('\nevent: message_end\r');
    expect(events).toEqual([{ event: 'text_delta', data: '{"delta":"반갑습니다"}' }]);

    parser.push('\ndata: {"messageId":10,"stopReason":"END"}\r\n\r\n');
    parser.finish();

    expect(events).toEqual([
      { event: 'text_delta', data: '{"delta":"반갑습니다"}' },
      { event: 'message_end', data: '{"messageId":10,"stopReason":"END"}' },
    ]);
  });

  it('콜론(:)으로 시작하는 ping · 주석 줄과 빈 이벤트는 무시한다', () => {
    const events: RawSseEvent[] = [];
    const parser = createSseParser((ev) => events.push(ev));

    parser.push(': ping\n\n');
    parser.push(':keep-alive\n');
    parser.push('event: text_delta\n: 중간 주석\ndata: {"delta":"테스트"}\n\n');
    parser.push(': ping\n\n');
    parser.finish();

    expect(events).toEqual([{ event: 'text_delta', data: '{"delta":"테스트"}' }]);
  });

  it('한글 멀티바이트(UTF-8 3바이트)가 청크 경계에서 잘려도 깨지지 않고 복원한다', () => {
    const events: RawSseEvent[] = [];
    const parser = createSseParser((ev) => events.push(ev));

    const raw = 'event: text_delta\ndata: {"delta":"한글 스트리밍 테스트"}\n\n';
    const bytes = new TextEncoder().encode(raw);

    // "한"(0xED 0x95 0x9C) 등 멀티바이트 한가운데를 1~2바이트씩 잘라서 넣는다
    for (let i = 0; i < bytes.length; i += 2) {
      parser.push(bytes.subarray(i, Math.min(i + 2, bytes.length)));
    }
    parser.finish();

    expect(events).toEqual([{ event: 'text_delta', data: '{"delta":"한글 스트리밍 테스트"}' }]);
  });

  it('ReadableStream 에서도 청크를 끝까지 읽어 ChatStreamEvent 로 변환한다', async () => {
    const encoder = new TextEncoder();
    const chunks = [
      encoder.encode(': ping\n\nevent: tool_start\n'),
      encoder.encode('data: {"callId":"c1","name":"sql_query","tier":"READ","input":{"sql":"SELECT 1"}}\n\n'),
    ];

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });

    const parsed: ChatStreamEvent[] = [];
    await readSseStream(stream, (raw) => {
      const ev = parseChatStreamEvent(raw);
      if (ev) parsed.push(ev);
    });

    expect(parsed).toEqual([
      {
        type: 'tool_start',
        data: { callId: 'c1', name: 'sql_query', tier: 'READ', input: { sql: 'SELECT 1' } },
      },
    ]);
  });
});
