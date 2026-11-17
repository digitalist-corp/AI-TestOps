import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { ExecutionStatus, ProjectStatus } from '@/types';

export const executionStatusLabel: Record<ExecutionStatus, string> = {
  SCHEDULED: '예약됨',
  PENDING: '대기',
  RUNNING: '실행 중',
  CANCEL_REQUESTED: '중단 중',
  CANCELLED: '중단됨',
  PASSED: '성공',
  FAILED: '실패',
  ERROR: '오류',
};

export const projectStatusLabel: Record<ProjectStatus, string> = {
  PLANNED: '계획',
  RUNNING: '실행',
  CLOSED: '종료',
};

/** 실행에 걸린 시간. "2분 44초", 1분 미만은 "44초". 값이 없으면 빈 문자열. */
export function formatDuration(durationMs: number | null | undefined): string {
  if (durationMs == null) return '';
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  if (totalSeconds < 60) return `${totalSeconds}초`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds ? `${minutes}분 ${seconds}초` : `${minutes}분`;
}

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
