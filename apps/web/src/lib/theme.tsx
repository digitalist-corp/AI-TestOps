import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

/** dark 는 콘솔 테마다. Tailwind 의 dark: 변형을 그대로 쓰려고 이름은 바꾸지 않았다. */
type Theme = 'light' | 'dark';

/**
 * 라이트를 기본으로 되돌리면서 키를 새로 뒀다. 예전 키(v2)에는 처음 열 때 저장된 기본값(dark)이 들어 있어
 * 사용자가 직접 고른 값과 구분할 수 없다. 새 키로 시작하면 모두 라이트로 열리고, 그 뒤로는 고른 값을 따른다.
 */
const THEME_KEY = 'playops.theme.v3';

export const THEME_LABEL: Record<Theme, string> = {
  dark: '콘솔',
  light: '라이트 (KRDS)',
};

/** 기본값은 라이트. 사용자가 한 번이라도 고른 값이 있으면 그 선택을 따른다. */
function resolveInitialTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return 'light';
}

const ThemeContext = createContext<{ theme: Theme; toggleTheme: () => void } | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(resolveInitialTheme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const toggleTheme = () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
