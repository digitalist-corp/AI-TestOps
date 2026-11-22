import { describe, expect, it } from 'vitest';
import type { ProjectMember } from '@/types';
import { parsePlanPaste, validPlanTitle } from './planPaste';

const screens = [{ routeKey: '/login', title: '로그인' }, { routeKey: '/account', title: '계정' }];
const members: ProjectMember[] = [{ userId: 7, username: 'min', displayName: '민지', role: 'MEMBER' }];

describe('parsePlanPaste', () => {
  it('엑셀 TSV 머리글을 건너뛰고 화면 이름, 담당자 이름, 점으로 나눈 날짜와 한글 우선순위를 해석한다', () => {
    const rows = parsePlanPaste(
      '\ufeff제목\t화면\t담당자\t마감일\t우선순위\t확인할 내용\r\n계정에 로그인\t로그인\t민지\t2026.11.22\t높음\t홈 화면이 보인다\r\n',
      screens, members,
    );
    expect(rows).toEqual([{
      entry: {
        title: '계정에 로그인', screenRouteKey: '/login', assigneeUserId: 7, dueDate: '2026-11-22',
        priority: 'HIGH', expected: '홈 화면이 보인다',
      },
      warnings: [], invalidTitle: false,
    }]);
  });

  it('CSV의 쉼표, 이중 따옴표, 여러 줄 내용과 경로·아이디를 처리한다', () => {
    const rows = parsePlanPaste(
      '"이름, 변경",/account,7,2028-02-29,MEDIUM,"이름은 ""민지""\n저장 상태, 성공"\n로그아웃,,min,,LOW,',
      screens, members,
    );
    expect(rows[0].entry).toEqual({
      title: '이름, 변경', screenRouteKey: '/account', assigneeUserId: 7, dueDate: '2028-02-29',
      priority: 'MEDIUM', expected: '이름은 "민지"\n저장 상태, 성공',
    });
    expect(rows[1].entry).toMatchObject({ assigneeUserId: 7, priority: 'LOW', expected: null });
  });

  it('매칭하지 못한 화면과 담당자는 비우고 유효하지 않은 날짜·우선순위도 표시한다', () => {
    const [row] = parsePlanPaste('확인,알 수 없음,999,2026.02.29,긴급,', screens, members);
    expect(row.entry).toMatchObject({ screenRouteKey: null, assigneeUserId: null, dueDate: null, priority: null });
    expect(row.warnings).toEqual([
      '화면 미지정 (알 수 없음)', '담당자 미지정 (999)', '마감일 미지정 (2026.02.29)', '우선순위 미지정 (긴급)',
    ]);
  });

  it('필수 제목이 비었거나 @ 또는 줄바꿈이 들어 있으면 추가할 수 없다', () => {
    const rows = parsePlanPaste('",\n잘못된 제목",/login\n@태그,,\n,/login', screens, members);
    expect(rows.map((row) => row.invalidTitle)).toEqual([true, true, true]);
    expect(validPlanTitle('x'.repeat(201))).toBe(false);
    expect(validPlanTitle('  유효한 제목  ')).toBe(true);
  });
});
