import { cn } from '@/lib/utils';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]', 'host.docker.internal'];

/** 배포 주소로 연 화면인지. 로컬 개발 화면에는 운영 메시지를 띄우지 않는다. */
export const isLiveServer = (hostname = window.location.hostname) => !LOCAL_HOSTS.includes(hostname);

/** "테스트 서버에서 실제 운영 중" (#87, U-4) — 시연 화면이 목업이 아니라 실제로 도는 서버임을 알린다. */
export function ServerNotice({ className }: { className?: string }) {
  if (!isLiveServer()) return null;
  return (
    <span
      role="status"
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-xs font-medium text-success',
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
      테스트 서버에서 실제 운영 중
    </span>
  );
}
