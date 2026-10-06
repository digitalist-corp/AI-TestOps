import { NavLink } from 'react-router-dom';
import { MessageSquare, PanelLeftClose } from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { RAIL_ITEMS } from '@/config/shellNav';
import { cn } from '@/lib/utils';

/** 아이콘 옆에 붙는 말풍선 라벨. 레일이 좁아서 글자를 넣을 수 없으니 hover로 보여준다. */
function RailTooltip({ label }: { label: string }) {
  return (
    <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-sidebar-active px-2 py-1 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
      {label}
    </span>
  );
}

/**
 * 화면 맨 왼쪽 세로 아이콘 줄.
 * 프로젝트에 매이지 않는 전역 메뉴만 둔다(프로젝트 작업 탭은 상단바 담당).
 */
export function AppRail({
  admin,
  aiCollapsed,
  onToggleAi,
}: {
  admin: boolean;
  aiCollapsed: boolean;
  onToggleAi: () => void;
}) {
  return (
    <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-sidebar-active bg-sidebar py-3">
      <NavLink to="/projects" className="mb-2 rounded-xl transition-opacity hover:opacity-80" title="AI-TestOps">
        <BrandLogo size={30} />
      </NavLink>

      {RAIL_ITEMS.map(({ to, label, icon: Icon, adminOnly }) => {
        const disabled = Boolean(adminOnly && !admin);
        if (disabled) {
          return (
            <span
              key={to}
              className="group relative flex h-10 w-10 items-center justify-center rounded-xl text-sidebar-foreground/30"
            >
              <Icon className="h-[18px] w-[18px]" />
              <RailTooltip label={`${label} (관리자 전용)`} />
            </span>
          );
        }

        return (
          <NavLink
            key={to}
            to={to}
            end={to === '/projects'}
            className={({ isActive }) =>
              cn(
                'group relative flex h-10 w-10 items-center justify-center rounded-xl transition-colors',
                isActive
                  ? 'bg-primary/20 text-white ring-1 ring-primary/40'
                  : 'text-sidebar-foreground/70 hover:bg-sidebar-active hover:text-white'
              )
            }
          >
            <Icon className="h-[18px] w-[18px]" />
            <RailTooltip label={label} />
          </NavLink>
        );
      })}

      <button
        type="button"
        onClick={onToggleAi}
        className={cn(
          'group relative mt-auto flex h-10 w-10 items-center justify-center rounded-xl transition-colors',
          aiCollapsed
            ? 'bg-ai-accent/20 text-ai-accent ring-1 ring-ai-accent/40 hover:bg-ai-accent/30'
            : 'text-sidebar-foreground/70 hover:bg-sidebar-active hover:text-white'
        )}
        aria-label={aiCollapsed ? 'AI 패널 펼치기' : 'AI 패널 접기'}
      >
        {aiCollapsed ? <MessageSquare className="h-[18px] w-[18px]" /> : <PanelLeftClose className="h-[18px] w-[18px]" />}
        <RailTooltip label={aiCollapsed ? 'AI 패널 펼치기 (Ctrl+/)' : 'AI 패널 접기 (Ctrl+/)'} />
      </button>
    </nav>
  );
}
