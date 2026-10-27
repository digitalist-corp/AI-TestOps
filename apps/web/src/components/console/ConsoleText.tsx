import { useEffect, useState, type ReactNode } from 'react';

/*
 * 콘솔 테마의 글자 장식. 구조 그래프와 앱 상단바가 함께 쓰므로 그래프 라이브러리에 기대지 않는다.
 */

const GLYPHS = 'ABCDEF0123456789/:_-#';

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** 글자가 무작위 기호에서 왼쪽부터 풀려 나오는 표시. 화면 읽기 프로그램에는 원래 글자만 읽힌다. */
export function DecodeText({ text, className }: { text: string; className?: string }) {
  const [shown, setShown] = useState(text);
  useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(text);
      return;
    }
    const frames = 16;
    let frame = 0;
    let raf = 0;
    const tick = () => {
      frame += 1;
      const reveal = Math.floor((text.length * frame) / frames);
      setShown(
        frame >= frames
          ? text
          : [...text].map((c, i) => (i < reveal || c === ' ' ? c : GLYPHS[(Math.random() * GLYPHS.length) | 0])).join('')
      );
      if (frame < frames) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text]);
  return (
    <span className={className}>
      <span aria-hidden="true">{shown}</span>
      <span className="sr-only">{text}</span>
    </span>
  );
}

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
