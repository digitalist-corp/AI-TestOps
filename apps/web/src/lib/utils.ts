import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** "2분 전"처럼 사람이 읽는 시간. 하루가 넘으면 날짜로 보여준다. */
export function formatRelative(value: string | null): string {
  if (!value) return '';
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return '';
  const diffMin = Math.floor((Date.now() - time) / 60000);
  if (diffMin < 1) return '방금';
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  return new Date(value).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
}
