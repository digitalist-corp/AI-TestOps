import { useEffect, useMemo, useRef } from 'react';
import { MessageProcessor, type ActionPayload, type ProcessableMessage } from '@a2ui/web_core/v1_0';
import { A2uiSurface as A2uiSurfaceView, type ReactCatalogComponent } from '@a2ui/react';
import { onboardingCatalog } from './onboardingCatalog';

/** 렌더러가 서버로 보내는 A2UI v1.0 `action` 메시지. `context` 의 바인딩은 누른 순간의 값으로 풀려 있다. */
export interface A2uiActionMessage {
  version: '1.0';
  action: ActionPayload;
}

interface Props {
  /** 서버가 보낸 A2UI v1.0 메시지 배열 (`createSurface` → `updateComponents`). */
  messages: unknown[];
  onAction: (message: A2uiActionMessage) => void;
}

/**
 * A2UI 메시지를 공식 렌더러(`@a2ui/react`)와 우리 카탈로그로 그린다.
 * 서버가 갱신된 메시지를 주면 내용 기준으로 processor 를 새로 만들어 처음부터 다시 그린다.
 * (같은 내용으로 다시 받으면 그대로 두어 사용자가 바꾼 체크 상태를 지킨다)
 */
export function A2uiSurface({ messages, onAction }: Props) {
  const onActionRef = useRef(onAction);
  useEffect(() => {
    onActionRef.current = onAction;
  });

  const content = JSON.stringify(messages);
  const surface = useMemo(() => {
    // StrictMode 의 이중 effect 와 엇갈리지 않게 dispose 하지 않고 GC 에 맡긴다. 전역에 남는 구독은 없다.
    const processor = new MessageProcessor<ReactCatalogComponent>([onboardingCatalog], (action) => {
      onActionRef.current({ version: '1.0', action });
    });
    try {
      processor.processMessages(JSON.parse(content) as ProcessableMessage[]);
    } catch {
      return null;
    }
    return processor.model.surfacesMap.values().next().value ?? null;
  }, [content]);

  if (!surface) {
    return <p className="text-xs text-muted-foreground">정리한 내용을 보여 주지 못했어요.</p>;
  }
  return <A2uiSurfaceView surface={surface} />;
}
