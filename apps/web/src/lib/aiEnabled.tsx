import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '@/api/client';

/**
 * AI 기능을 켜고 끄는 사용자별 스위치.
 *
 * AI를 꺼도 화면 구성은 그대로이고, 켜면 그 위에 AI 기능(우하단 채팅 · AI 탭 · 화면 안의 AI 버튼)이 얹힌다.
 * AI 기능을 보여줄지는 화면마다 `active` 하나만 보면 된다.
 */
const AI_ENABLED_KEY = 'playops.aiEnabled';

type AiEnabledState = {
  /** 관리자가 AI 키를 하나라도 등록해 두었는지 */
  available: boolean;
  /** 사용자가 스위치를 켜 두었는지 (기본값 켜짐) */
  enabled: boolean;
  /** available && enabled. AI 기능을 보여줄지는 이 값으로 정한다. */
  active: boolean;
  /** 키 등록 여부를 한 번이라도 확인했는지. 확인 전에는 active 가 false 라서, 이걸 보고 내쫓기 같은 동작을 미룬다. */
  checked: boolean;
  setEnabled: (enabled: boolean) => void;
};

function readStoredEnabled(): boolean {
  try {
    return localStorage.getItem(AI_ENABLED_KEY) !== 'false';
  } catch {
    return true;
  }
}

const AiEnabledContext = createContext<AiEnabledState | null>(null);

export function AiEnabledProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [available, setAvailable] = useState(false);
  const [checked, setChecked] = useState(false);
  const [enabled, setEnabledState] = useState(readStoredEnabled);

  // 관리자가 AI 설정에서 키를 넣거나 빼면 화면을 옮길 때 반영된다.
  useEffect(() => {
    let ignore = false;
    api.getAiAvailability()
      .then((availability) => {
        if (!ignore) setAvailable(availability.anyConfigured);
      })
      .catch(() => {
        if (!ignore) setAvailable(false);
      })
      .finally(() => {
        if (!ignore) setChecked(true);
      });
    return () => {
      ignore = true;
    };
  }, [location.pathname]);

  const setEnabled = (next: boolean) => {
    setEnabledState(next);
    try {
      localStorage.setItem(AI_ENABLED_KEY, String(next));
    } catch {
      // 저장이 막힌 브라우저에서는 이번 접속 동안만 유지한다.
    }
  };

  return (
    <AiEnabledContext.Provider value={{ available, enabled, active: available && enabled, checked, setEnabled }}>
      {children}
    </AiEnabledContext.Provider>
  );
}

export function useAiEnabled() {
  const ctx = useContext(AiEnabledContext);
  if (!ctx) throw new Error('useAiEnabled must be used within AiEnabledProvider');
  return ctx;
}
