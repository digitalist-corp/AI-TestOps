type Cell = string | number | null | undefined;

/** 엑셀이 수식으로 읽는 첫 글자. 앞에 작은따옴표를 붙여 실행을 막는다 (CSV 인젝션). */
const FORMULA_START = /^[=+\-@]/;

function cell(value: Cell): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** 엑셀에서 바로 여는 CSV. UTF-8 BOM 으로 시작해 한글이 깨지지 않는다. */
export function toCsv(rows: Cell[][]): string {
  return '﻿' + rows.map((row) => row.map(cell).join(',') + '\r\n').join('');
}

export function downloadCsv(fileName: string, rows: Cell[][]): void {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
