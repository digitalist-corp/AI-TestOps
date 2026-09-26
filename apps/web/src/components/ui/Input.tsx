import { cn } from '@/lib/utils';

/**
 * KRDS input-text.
 * 높이 48px · 패딩 14px · radius 6px · 1px border-default.
 * hover에서 보더가 짙어지고, focus는 전역 포커스 아웃라인(index.css)이 담당한다.
 * 비활성은 opacity가 아니라 평면 색 전환으로 처리한다.
 *
 * 밀집한 툴바·필터에서는 className으로 h-10(40px)을 덮어쓴다.
 */
export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'flex h-12 w-full rounded-sm border border-border bg-card px-3.5 text-[15px] text-foreground transition-colors',
        'placeholder:text-muted-foreground hover:border-border-strong',
        'disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground',
        className
      )}
      {...props}
    />
  );
}
