import { useEffect, useState, type ReactNode } from 'react';

/*
 * 콘솔 테마의 글자 장식. 앱 상단바와 각 페이지 제목이 쓴다.
 */

/** 초 단위 시계. 자기 상태만 바꿔 그래프 전체를 다시 그리지 않는다. */
export function LiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <span className="console-mono tabular-nums">
      {now.getFullYear()}-{pad(now.getMonth() + 1)}-{pad(now.getDate())} {pad(now.getHours())}:{pad(now.getMinutes())}:
      {pad(now.getSeconds())}
    </span>
  );
}


/**
 * 화면 제목 위의 분류 표시 (예: WORKSPACE // PROJECTS). 콘솔 테마에서만 보이고 라이트(KRDS)에서는 숨는다.
 * 장식이라 화면 읽기 프로그램에는 읽히지 않게 한다.
 */
export function ConsoleEyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="console-label mb-1.5 hidden items-center gap-2 dark:flex" aria-hidden="true">
      <span className="h-px w-5 bg-primary shadow-[0_0_6px_var(--color-primary)]" />
      <span className="text-primary">◈</span>
      {children}
    </p>
  );
}
