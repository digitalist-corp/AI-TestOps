import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { AiJobStatus, DockerStatus, ExecutionStatus, ProjectStatus, UserRole } from '@/types';

/*
 * 코드값 → 화면 이름 (#120). 화면에는 코드값(PASSED, PLANNED, ADMIN …)을 그대로 보이지 않고 여기 이름을 쓴다.
 * 같은 상태라도 문맥에 맞춘 긴 문장(예: "AI가 테스트 코드를 만드는 중...")은 그 화면에 둔다.
 */

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

export const aiJobStatusLabel: Record<AiJobStatus, string> = {
  PROPOSED: '수정 제안',
  PENDING: '대기 중',
  RUNNING: '실행 중',
  DIFF_READY: '결과 처리 중',
  NEEDS_REVIEW: '검토 대기',
  APPLIED: '적용됨',
  REJECTED: '거부됨',
  FAILED: '실패',
  ERROR: '오류',
  CANCELED: '취소됨',
  TIMEOUT: '시간 초과',
};

/** 전역 역할. 프로젝트 안 역할(PM · 팀원)은 lib/access 의 ROLE_LABEL */
export const userRoleLabel: Record<UserRole, string> = {
  ADMIN: '관리자',
  PM: 'PM',
  USER: '팀원',
};

/** 프로젝트 등록 때 PM 으로 고를 수 있는 계정 — 계정 역할이 PM 인 사람만 */
export function pmCandidates(users: { id: number; username: string; displayName?: string | null; role: UserRole }[]) {
  return users
    .filter((u) => u.role === 'PM')
    .map((u) => ({ id: u.id, label: u.displayName ? `${u.displayName} (${u.username})` : u.username }));
}

export const dockerStatusLabel: Record<DockerStatus, string> = {
  RUNNING: '실행 중',
  STOPPED: '중지',
  ERROR: '오류',
  NOT_CONFIGURED: '미설정',
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
