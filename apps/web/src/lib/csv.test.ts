import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';

describe('toCsv — 엑셀에서 그대로 여는 CSV', () => {
  it('UTF-8 BOM 으로 시작해 엑셀이 한글을 깨뜨리지 않는다', () => {
    expect(toCsv([['케이스명'], ['로그인']]).startsWith('﻿케이스명\r\n')).toBe(true);
  });

  it('= + - @ 로 시작하는 글자는 앞에 작은따옴표를 붙여 수식으로 실행되지 않게 한다', () => {
    const csv = toCsv([['=1+1', '+SUM(A1)', '-2+3', '@cmd', '정상']]);
    expect(csv).toBe("﻿'=1+1,'+SUM(A1),'-2+3,'@cmd,정상\r\n");
  });

  it('숫자 값은 그대로 두고 null · undefined 는 빈 칸', () => {
    expect(toCsv([[-3, 0, null, undefined]])).toBe('﻿-3,0,,\r\n');
  });

  it('쉼표 · 따옴표 · 줄바꿈이 있으면 따옴표로 감싸고 따옴표는 두 번', () => {
    expect(toCsv([['a,b', 'say "hi"', '줄\n바꿈']])).toBe('﻿"a,b","say ""hi""","줄\n바꿈"\r\n');
  });

  it('수식 가드와 따옴표 감싸기가 함께 걸린다', () => {
    expect(toCsv([['=HYPERLINK("x")']])).toBe('﻿"\'=HYPERLINK(""x"")"\r\n');
  });
});
