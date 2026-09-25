import { useId } from 'react';
import { cn } from '@/lib/utils';

type BrandLogoProps = {
  /** 마크 한 변의 크기(px) */
  size?: number;
  /** 마크 옆에 제품명을 함께 표시할지 */
  showText?: boolean;
  /** 제품명 아래 보조 문구 */
  subtitle?: string;
  /** 어두운 배경(사이드바 등)에서 쓰는 밝은 글자색 */
  tone?: 'light' | 'dark';
  className?: string;
};

/**
 * AI-TestOps 브랜드 마크.
 *
 * 둥근 타일 위의 "AIT" 모노그램과, T의 세로획에서 이어지는 체크 표시.
 * AIT = AI-TestOps, 체크 = 테스트 통과를 뜻한다.
 * 글자를 폰트가 아닌 도형으로 그려서 파비콘 · OS 아이콘 어디서나 같은 모양으로 보인다.
 * 같은 도형이 apps/web/public/favicon.svg · logo.svg 에도 들어 있다.
 */
export function BrandLogo({ size = 32, showText = false, subtitle, tone = 'dark', className }: BrandLogoProps) {
  const gradientId = useId();

  const mark = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      role="img"
      aria-label="AI-TestOps"
      className="shrink-0"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2563EB" />
          <stop offset="1" stopColor="#06B6D4" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="44" height="44" rx="12" fill={`url(#${gradientId})`} />
      {/* A I T 모노그램 */}
      <g stroke="#FFFFFF" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8.5 27 L14 12 L19.5 27" />
        <path d="M10.9 22.4 H17.1" />
        <path d="M24 12 V27" />
        <path d="M28.5 12 H39.5" />
        <path d="M34 12 V27" />
      </g>
      {/* 체크 — T의 세로획에서 이어진다 */}
      <path d="M15 33.6 L20.6 39 L33 27.8" stroke="#FFFFFF" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  if (!showText) return <span className={className}>{mark}</span>;

  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      {mark}
      <span className="min-w-0">
        <span
          className={cn(
            'block truncate text-xl font-bold tracking-tight',
            tone === 'light' ? 'text-white' : 'text-foreground',
          )}
        >
          AI-TestOps
        </span>
        {subtitle ? (
          <span
            className={cn(
              'mt-0.5 block truncate text-xs',
              tone === 'light' ? 'text-sidebar-foreground/60' : 'text-muted-foreground',
            )}
          >
            {subtitle}
          </span>
        ) : null}
      </span>
    </span>
  );
}

export default BrandLogo;
