import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * KRDS button.
 * 사이즈 L 56 / M 48 / S 40px, 변형 primary · secondary · tertiary.
 * hover는 primary-60, pressed는 primary-70으로 한 단계씩 어두워지며 transform·scale은 쓰지 않는다.
 * 비활성은 opacity가 아니라 평면 색 전환(bg-subtle + fg-4)으로 처리한다.
 */
const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap font-bold transition-colors cursor-pointer disabled:cursor-not-allowed disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground disabled:border-border',
  {
    variants: {
      variant: {
        // primary — 화면당 하나의 주 행동
        default: 'bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-pressed',
        // secondary — 파란 테두리 보조 행동
        secondary: 'border border-primary bg-card text-primary hover:bg-primary-subtle',
        // tertiary — 가장 절제된 보조 행동
        outline: 'border border-border bg-card text-foreground hover:bg-accent',
        ghost: 'text-foreground hover:bg-accent',
        destructive: 'bg-destructive text-destructive-foreground hover:opacity-90',
      },
      size: {
        lg: 'h-14 rounded-md px-7 text-[19px]',
        default: 'h-12 rounded-sm px-6 text-[17px]',
        sm: 'h-10 rounded-sm px-4 text-[15px]',
        // 밀집한 툴바·표 안에서 쓰는 우리 확장 사이즈
        xs: 'h-8 rounded-sm px-2.5 text-[13px]',
        icon: 'h-10 w-10 rounded-sm',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
