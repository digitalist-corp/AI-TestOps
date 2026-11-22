// AI-TestOps 성과공유회 포스터 v3 — A1 세로(594x841mm), pptxgenjs + 테마
// node poster.js <이미지 폴더> <출력.pptx> <apply_theme.js 경로>
const path = require('path');
const fs = require('fs');
const pptxgen = require('pptxgenjs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const sharp = require('sharp');
const si = require('react-icons/si');
const lu = require('react-icons/lu');
const { imageSize } = require('./imgsize');

const [IMG, OUT, THEME_JS] = process.argv.slice(2);
const { applyTheme } = require(THEME_JS);

const THEME = {
  name: 'aQm Poster',
  headFontFace: 'Malgun Gothic',
  bodyFontFace: 'Malgun Gothic',
  colors: {
    dk1: '1B2130', lt1: 'FFFFFF', dk2: '15213F', lt2: 'F1F4F9',
    accent1: '3460D9', accent2: '1E9E6A', accent3: 'D64545', accent4: 'E3A220',
    accent5: '6A7385', accent6: 'C9D0DC', hlink: '3460D9', folHlink: '6A7385',
  },
};
const HEX = THEME.colors;

const pres = new pptxgen();
pres.defineLayout({ name: 'A1P', width: 594 / 25.4, height: 841 / 25.4 });
pres.layout = 'A1P';
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.title = 'AI-TestOps 포스터';
const C = pres.SchemeColor;
const INK = C.text1, NAVY = C.text2, PAPER = C.background2, WHITE = C.background1;
const BLUE = C.accent1, GREEN = C.accent2, RED = C.accent3, GRAY = C.accent5, LINE = C.accent6;

const u = (mm) => mm / 25.4;
const slide = pres.addSlide();
slide.background = { color: 'FFFFFF' };

function text(str, x, y, w, h, o = {}) {
  slide.addText(str, {
    x: u(x), y: u(y), w: u(w), h: u(h), margin: 0, isTextBox: true, valign: 'top',
    fontSize: 18, color: INK, ...o,
  });
}
function rect(x, y, w, h, o = {}) {
  slide.addShape(o.radius ? pres.shapes.ROUNDED_RECTANGLE : pres.shapes.RECTANGLE, {
    x: u(x), y: u(y), w: u(w), h: u(h), line: { type: 'none' }, ...o,
    rectRadius: o.radius ? u(o.radius) : undefined,
  });
}
const soft = () => ({ type: 'outer', color: '15213F', opacity: 0.16, blur: 14, offset: 3, angle: 90 });

/** 그림을 w 폭으로 넣는다. h 를 주면 그 칸을 채우도록 잘라 넣는다(cover). 넣은 높이를 돌려준다. */
function image(file, x, y, w, h) {
  const p = path.join(IMG, file);
  const { width, height } = imageSize(p);
  if (!h) {
    h = (w * height) / width;
    slide.addImage({ path: p, x: u(x), y: u(y), w: u(w), h: u(h) });
  } else {
    slide.addImage({ path: p, x: u(x), y: u(y), w: u(w), h: u(h), sizing: { type: 'cover', w: u(w), h: u(h) } });
  }
  return h;
}

/** 브라우저 창 틀에 넣은 화면. 포스터 전체의 공통 모양(모티프). */
function browser(file, x, y, w, h, shadow = true) {
  const bar = Math.max(4, w * 0.028);
  rect(x, y, w, h + bar, { fill: { color: 'FFFFFF' }, line: { color: HEX.accent6, width: 0.75 }, radius: 2.2, shadow: shadow ? soft() : undefined });
  rect(x + 0.4, y + 0.4, w - 0.8, bar - 0.4, { fill: { color: 'EEF1F6' }, radius: 1.8 });
  [0, 1, 2].forEach((i) => slide.addShape(pres.shapes.OVAL, {
    x: u(x + 3 + i * bar * 0.55), y: u(y + bar * 0.32), w: u(bar * 0.36), h: u(bar * 0.36),
    fill: { color: ['F26D6D', 'F2C14E', '5CC27A'][i] }, line: { type: 'none' },
  }));
  return bar + image(file, x + 0.4, y + bar, w - 0.8, h);
}

async function icon(Comp, hex, px = 384) {
  const svg = renderToStaticMarkup(React.createElement(Comp, { color: '#' + hex, size: px }));
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return 'image/png;base64,' + buf.toString('base64');
}

const brand = { SiReact: '149ECA', SiSpringboot: '6DB33F', SiPostgresql: '4169E1', SiDocker: '2496ED', SiClaude: 'D97757', LuMonitorPlay: '2EAD33' };
const ORANGE = 'F08A24';

/** 둥근 칸 안의 아이콘 */
async function badge(Ic, x, y, size, color, bg, round = true) {
  if (bg) slide.addShape(round ? pres.shapes.OVAL : pres.shapes.ROUNDED_RECTANGLE, {
    x: u(x), y: u(y), w: u(size), h: u(size), fill: { color: bg }, line: { type: 'none' }, rectRadius: round ? undefined : u(size * 0.22),
  });
  const pad = bg ? size * 0.24 : 0;
  slide.addImage({ data: await icon(Ic, color), x: u(x + pad), y: u(y + pad), w: u(size - 2 * pad), h: u(size - 2 * pad) });
}
const chevron = (x, y, w = 3, h = 5, color = HEX.accent6) =>
  slide.addShape(pres.shapes.CHEVRON, { x: u(x), y: u(y), w: u(w), h: u(h), fill: { color }, line: { type: 'none' } });
const downArrow = (x, y, w, h, color) =>
  slide.addShape(pres.shapes.DOWN_ARROW, { x: u(x), y: u(y), w: u(w), h: u(h), fill: { color }, line: { type: 'none' } });
const quote = (str, x, y, w, h, accent) => {
  rect(x, y, w, h, { fill: { color: HEX.dk2 }, radius: 3 });
  const parts = accent ? [{ text: '“ ' + str, options: { color: 'FFFFFF' } }, { text: accent + ' ”', options: { color: '9FB4E8' } }]
    : [{ text: '“ ' + str + ' ”', options: { color: 'FFFFFF' } }];
  text(parts, x + 6, y, w - 12, h, { fontSize: 16.5, bold: true, align: 'center', valign: 'middle', lineSpacingMultiple: 1.25 });
};

(async () => {
  const M = 26, W = 594 - 2 * M;
  const heading = (t, y) => { y += 5; text(t, M, y, W, 14, { fontSize: 36, bold: true, color: NAVY }); return y + 17; };
  const sub = (t, x, y, w = 200) => { text(t, x, y, w, 9, { fontSize: 20, bold: true, color: BLUE }); return y + 11; };

  // ============================================================ 표지
  rect(0, 0, 594, 90, { fill: { color: HEX.dk2 } });
  text('2026-2학기 산학공동연구프로젝트 성과공유회', M, 13, 300, 7, { fontSize: 17, color: 'C9D0DC' });
  text([{ text: '[aQm] ', options: { color: '9FB4E8' } }, { text: 'AI-TestOps', options: { color: 'FFFFFF' } }],
    M, 19, 420, 28, { fontSize: 78, bold: true });
  text('AI가 테스트 생성부터 오류 분석까지 자동화하는 테스트 품질관리 플랫폼', M, 54, 440, 10, { fontSize: 24, bold: true, color: WHITE });
  text([
    { text: '지도교수  ', options: { color: '9FB4E8', bold: true } }, { text: '양옥수', options: { color: 'FFFFFF' } },
    { text: '      참여학생  ', options: { color: '9FB4E8', bold: true } },
    { text: '장준호(팀장) · 김윤재 · 장동현 · 박준서 · 김상원', options: { color: 'FFFFFF' } },
  ], M, 70, 440, 9, { fontSize: 19 });
  rect(594 - M - 50, 12, 50, 50, { fill: { color: 'FFFFFF' }, radius: 2.5 });
  slide.addImage({ path: path.join(IMG, 'qr.png'), x: u(594 - M - 47.5), y: u(14.5), w: u(45), h: u(45) });
  text('QR로 바로 써 보기', 594 - M - 60, 68, 60, 8, { fontSize: 17, bold: true, color: WHITE, align: 'center' });

  // ============================================================ 프로젝트 개요
  let y = heading('프로젝트 개요', 95);
  const PW = 258, PH = 150, PX2 = M + W - PW;

  // ---- [플랫폼 정의]
  let px = M;
  rect(px, y, PW, PH, { fill: { color: 'EEF3FC' }, radius: 4 });
  text('플랫폼 정의', px + 8, y + 6, 100, 7, { fontSize: 15, bold: true, color: BLUE });
  text('AI가 테스트 생성부터 오류 분석까지\n자동화하는 품질관리 플랫폼', px + 8, y + 13, PW - 16, 20,
    { fontSize: 23, bold: true, color: NAVY, align: 'center', lineSpacingMultiple: 1.15 });
  text('웹과 앱 서비스의 테스트 업무를 AI로 자동화하여 테스트 케이스 생성, 실행, 자동 수정, 오류 원인 분석까지 수행하는 '
    + 'Playwright · LangGraph 등 오픈소스 기반 품질관리 플랫폼입니다.', px + 12, y + 35, PW - 24, 20,
  { fontSize: 15, color: INK, align: 'center', lineSpacingMultiple: 1.3 });
  // 기기 그림: 노트북 + 휴대폰 + 확인 표시
  const dy = y + 62;
  rect(px + 12, dy + 4, 82, 52, { fill: { color: 'FFFFFF' }, line: { color: HEX.accent6, width: 1 }, radius: 3, shadow: soft() });
  rect(px + 12.5, dy + 4.5, 81, 6, { fill: { color: 'E3E9F4' }, radius: 2.5 });
  [[16, 70, 'DCE4F2'], [22, 50, 'E9EEF6'], [28, 58, 'E9EEF6'], [34, 40, 'E9EEF6']].forEach(([oy, w, c]) =>
    rect(px + 18, dy + 4 + oy, w, 3.5, { fill: { color: c }, radius: 1.5 }));
  rect(px + 18, dy + 44, 30, 7, { fill: { color: HEX.accent1 }, radius: 2 });
  rect(px + 6, dy + 56, 94, 3, { fill: { color: 'B7C3D8' }, radius: 1.5 });
  rect(px + 78, dy + 24, 22, 38, { fill: { color: 'FFFFFF' }, line: { color: HEX.accent6, width: 1 }, radius: 3, shadow: soft() });
  [[31, 14], [36, 10], [41, 12]].forEach(([oy, w]) => rect(px + 82, dy + oy, w, 2.5, { fill: { color: 'E9EEF6' }, radius: 1 }));
  await badge(lu.LuCircleCheck, px + 70, dy - 2, 15, 'FFFFFF', HEX.accent2);
  // AI 로봇
  await badge(lu.LuBot, px + 106, dy + 8, 40, 'FFFFFF', HEX.accent1);
  text('AI', px + 106, dy + 50, 40, 8, { fontSize: 18, bold: true, color: BLUE, align: 'center' });
  // 체크리스트 판
  const cx0 = px + 154, cw0 = PW - 154 - 10;
  rect(cx0, dy, cw0, 60, { fill: { color: 'FFFFFF' }, line: { color: HEX.dk2, width: 2 }, radius: 4, shadow: soft() });
  const checks = ['테스트 자동 생성', '자동 실행', '화면 변경 시 자동 수정', '오류 원인 분석'];
  for (let i = 0; i < checks.length; i++) {
    await badge(lu.LuSquareCheck, cx0 + 5, dy + 5 + i * 13.5, 9, HEX.accent2);
    text(checks[i], cx0 + 16, dy + 5 + i * 13.5, cw0 - 18, 9, { fontSize: 15.5, bold: true, valign: 'middle' });
  }
  rect(px + 14, y + PH - 18, PW - 28, 12, { fill: { color: HEX.accent1 }, radius: 6 });
  text('“ 더 좋은 서비스를, 더 빠르고, 더 안정적으로 ”', px + 14, y + PH - 18, PW - 28, 12,
    { fontSize: 17, bold: true, color: WHITE, align: 'center', valign: 'middle' });

  // ---- 가운데 주황 점 화살표
  const ax = M + PW + 4, ay = y + PH / 2;
  const dots = [[0, -12], [0, -6], [0, 0], [0, 6], [0, 12], [5, -9], [5, -3], [5, 3], [5, 9], [10, -6], [10, 0], [10, 6], [15, -3], [15, 3], [20, 0]];
  dots.forEach(([dx, dy2], i) => slide.addShape(pres.shapes.OVAL, {
    x: u(ax + dx * 0.9), y: u(ay + dy2 - 2), w: u(4), h: u(4), fill: { color: ORANGE, transparency: Math.max(0, 70 - dx * 3.5) }, line: { type: 'none' },
  }));

  // ---- [기존 서비스 문제점]
  px = PX2;
  rect(px, y, PW, PH, { fill: { color: 'F5F6F8' }, radius: 4 });
  text('기존 서비스 문제점', px + 8, y + 6, 120, 7, { fontSize: 15, bold: true, color: RED });
  text('서비스는 더 빠르게 변하고, 테스트는 더 복잡해지고 있습니다', px + 8, y + 13, PW - 16, 10,
    { fontSize: 19, bold: true, color: NAVY, align: 'center' });
  const domains = [[lu.LuShoppingCart, '쇼핑', 'E5484D'], [lu.LuLandmark, '금융', HEX.dk2], [lu.LuGraduationCap, '교육', HEX.dk2], [lu.LuBuilding2, '공공서비스', HEX.dk2]];
  const DW = (PW - 16 - 3 * 5) / 4;
  for (let i = 0; i < domains.length; i++) {
    const [Ic, t, c] = domains[i];
    const bx = px + 8 + i * (DW + 5);
    rect(bx, y + 26, DW, 12, { fill: { color: 'FFFFFF' }, line: { color: HEX.accent6, width: 0.75 }, radius: 2 });
    await badge(Ic, bx + 5, y + 28.5, 7, c);
    text(t, bx + 14, y + 26, DW - 16, 12, { fontSize: 15, bold: true, valign: 'middle' });
  }
  text('우리가 사용하는 대부분의 서비스가 웹과 앱으로 제공되고,\n새로운 기능과 서비스가 하루에도 여러 차례 변경되고 배포됩니다.',
    px + 10, y + 41, PW - 20, 12, { fontSize: 14, color: GRAY, align: 'center', lineSpacingMultiple: 1.25 });
  const pains = [
    [lu.LuCircleAlert, 'UI가 조금만 바뀌어도 테스트 실패\n→ 다시 수정해야 함', 'E5484D'],
    [lu.LuFileText, '새로운 기능 추가 시\n테스트 케이스 다시 작성', HEX.accent1],
    [lu.LuSearchCode, '실패 원인 파악이 어려움\n(UI · API · 데이터 · 코드 로그 직접 확인)', 'E5484D'],
    [lu.LuClock, '서비스가 복잡할수록 시간과 비용 증가\n또 다른 반복 업무 발생', HEX.accent1],
    [lu.LuLock, '보안이 중요한 금융 · 공공기관은\n외부 클라우드(SaaS) 사용이 어려움', HEX.accent1],
  ];
  const QW = (PW - 16 - 6) / 2;
  for (let i = 0; i < pains.length; i++) {
    const [Ic, t, c] = pains[i];
    const col = i < 3 ? 0 : 1, row = i < 3 ? i : i - 3;
    const bx = px + 8 + col * (QW + 6), by = y + 56 + row * 21 + (col ? 10.5 : 0);
    rect(bx, by, QW, 18.5, { fill: { color: 'FFFFFF' }, radius: 2.5 });
    await badge(Ic, bx + 3, by + 4.5, 9.5, c);
    text(t, bx + 15, by, QW - 17, 18.5, { fontSize: 14, valign: 'middle', lineSpacingMultiple: 1.18 });
  }
  quote('사람이 반복적으로 테스트를 만들고 실행하고 수정하고 분석하는 업무를', px + 8, y + PH - 24, PW - 16, 18, '\nAI가 대신할 수 없을까?');
  y += PH + 4;

  // ============================================================ 수행 내용 및 방법
  y = heading('수행 내용 및 방법', y);
  y = sub('서비스 기능 흐름', M, y);
  const steps = [['01', '테스트 점검 사이트 등록', 'f-projects.jpg'], ['02', '테스트 네비게이션', 'g-graph.jpg'],
    ['03', '점검표 작성', 'g-aigen.jpg'], ['04', 'AI 자동 점검(영상 녹화)', 'g-results.jpg'], ['05', '결과 검증 및 통계', 'g-rounds.jpg']];
  const SG = 9, SW = (W - 4 * SG) / 5, SH = SW * 0.56;
  let bh = 0;
  steps.forEach(([n, t, img], i) => {
    const sx = M + i * (SW + SG);
    bh = browser(img, sx, y, SW, SH, false);
    text(n, sx, y + bh + 3, 16, 9, { fontSize: 21, bold: true, color: BLUE });
    text(t, sx + 13, y + bh + 3.5, SW - 13, 9, { fontSize: 17.5, bold: true });
    if (i < 4) chevron(sx + SW + SG / 2 - 1.5, y + bh / 2 - 2.5);
  });
  y += bh + 16;

  const fy0 = sub('서비스 주요 기능', M, y);
  const features = [[lu.LuFileSearch, '코드 분석'], [lu.LuNetwork, '지식 그래프'], [lu.LuSparkles, 'AI 점검표 작성'],
    [lu.LuMousePointerClick, '클릭 녹화'], [lu.LuContainer, '독립 실행과 기록'], [lu.LuWorkflow, 'Work Flow']];
  const FAW = 382, FG = 8, FW = (FAW - 2 * FG) / 3;
  for (let i = 0; i < features.length; i++) {
    const [Ic, t] = features[i];
    const fx = M + (i % 3) * (FW + FG), fy = fy0 + Math.floor(i / 3) * 19;
    rect(fx, fy, FW, 16, { fill: { color: HEX.lt2 }, radius: 3 });
    await badge(Ic, fx + 4, fy + 3, 10, HEX.accent1);
    text(t, fx + 17, fy, FW - 19, 16, { fontSize: 18, bold: true, valign: 'middle' });
  }
  // GitHub QR 칸
  const gx = M + FAW + 12, gwid = W - FAW - 12;
  rect(gx, y, gwid, 49, { fill: { color: HEX.lt2 }, radius: 3 });
  rect(gx + 6, y + 5, 39, 39, { fill: { color: 'FFFFFF' }, radius: 2 });
  slide.addImage({ path: path.join(IMG, 'qr-github.png'), x: u(gx + 7.5), y: u(y + 6.5), w: u(36), h: u(36) });
  await badge(si.SiGithub, gx + 51, y + 7, 9, HEX.dk2);
  text('서비스 기능 및 산출물', gx + 51, y + 18, gwid - 55, 8, { fontSize: 17, bold: true });
  text('GitHub 저장소\n소스 코드 · 문서 공개', gx + 51, y + 27, gwid - 55, 14, { fontSize: 14, color: GRAY, lineSpacingMultiple: 1.25 });
  y = Math.max(fy0 + 2 * 19, y + 49) + 4;

  y = sub('기술 스택', M, y);
  const stack = [['FE', 'React · TypeScript', si.SiReact, 'SiReact'], ['BE', 'Spring Boot · Java 21', si.SiSpringboot, 'SiSpringboot'],
    ['DB', 'PostgreSQL', si.SiPostgresql, 'SiPostgresql'], ['Test', 'Playwright', lu.LuMonitorPlay, 'LuMonitorPlay'],
    ['Infra', 'Docker · GitHub Actions', si.SiDocker, 'SiDocker'], ['AI', 'Claude · GPT', si.SiClaude, 'SiClaude']];
  const KG = 6, KW = (W - 5 * KG) / 6;
  for (let i = 0; i < stack.length; i++) {
    const [k, v, Ic, name] = stack[i];
    const kx = M + i * (KW + KG);
    rect(kx, y, KW, 20, { fill: { color: 'FFFFFF' }, line: { color: HEX.accent6, width: 0.75 }, radius: 2.5 });
    slide.addImage({ data: await icon(Ic, brand[name]), x: u(kx + 3.5), y: u(y + 6), w: u(8), h: u(8) });
    text(k, kx + 14, y + 3, KW - 16, 6, { fontSize: 12.5, bold: true, color: BLUE });
    text(v, kx + 14, y + 9, KW - 16, 9, { fontSize: 13.5, bold: true });
  }
  y += 22;

  // ============================================================ 주요 성과
  y = heading('주요 성과', y);
  const CW = (W - 12) / 2, CH = 142;
  let cx = M;
  rect(cx, y, CW, CH, { fill: { color: HEX.lt2 }, radius: 4 });
  text('GitHub 저장소만 연결하면', cx + 10, y + 8, CW - 20, 9, { fontSize: 18, color: BLUE, bold: true });
  text('소스를 읽어 AI로 자동 점검하여\n원인분석 및 해결방향을 제시', cx + 10, y + 17, CW - 20, 22, { fontSize: 22, bold: true, lineSpacingMultiple: 1.15 });
  const flow = [[si.SiGithub, '저장소 연결', '웹사이트의\n소스 코드'], [lu.LuFileSearch, '코드 분석', '페이지 · 입력칸 ·\n버튼 찾기'],
    [lu.LuNetwork, '사이트 지도', '화면 9개와\n이동 경로'], [lu.LuPlay, '자동 점검', '점검표를 만들고\n바로 실행']];
  const NW = (CW - 20 - 3 * 7) / 4;
  for (let i = 0; i < flow.length; i++) {
    const [Ic, t, d] = flow[i];
    const nx = cx + 10 + i * (NW + 7), ny = y + 44;
    rect(nx, ny, NW, 52, { fill: { color: 'FFFFFF' }, radius: 3, shadow: soft() });
    await badge(Ic, nx + NW / 2 - 7, ny + 6, 14, i === 3 ? HEX.accent2 : HEX.dk2);
    text(t, nx + 2, ny + 23, NW - 4, 9, { fontSize: 17, bold: true, align: 'center' });
    text(d, nx + 2, ny + 32, NW - 4, 16, { fontSize: 14, color: GRAY, align: 'center', lineSpacingMultiple: 1.2 });
    if (i < 3) chevron(nx + NW + 2, ny + 23.5);
  }
  text('테스트 케이스를 자동으로 만들고 실행하며, 화면이 변경되면 테스트를 스스로 수정하고, 오류가 발생하면 원인까지 분석합니다.',
    cx + 10, y + 104, CW - 20, 30, { fontSize: 17, lineSpacingMultiple: 1.35 });

  cx = M + CW + 12;
  rect(cx, y, CW, CH, { fill: { color: HEX.lt2 }, radius: 4 });
  text('지식 그래프로', cx + 10, y + 8, CW - 20, 9, { fontSize: 18, color: BLUE, bold: true });
  text('점검 중인 웹사이트를 쉽게 확인하도록\n점검 상태를 Visual화', cx + 10, y + 17, CW - 20, 22, { fontSize: 22, bold: true, lineSpacingMultiple: 1.15 });
  const gw2 = CW - 20;
  const gh = browser('graph-wide.jpg', cx + 10, y + 42, gw2, 80, true);
  [['2E9E5B', '점검 통과'], ['3B82F6', '화면만 확인'], ['9AA3B2', '아직 안 봄'], ['D64545', '막힘 · 고칠 곳']].forEach(([c, t], i) => {
    const lx = cx + 10 + i * (gw2 / 4);
    slide.addShape(pres.shapes.OVAL, { x: u(lx), y: u(y + 42 + gh + 4.5), w: u(4), h: u(4), fill: { color: c }, line: { type: 'none' } });
    text(t, lx + 6, y + 42 + gh + 3.5, gw2 / 4 - 6, 7, { fontSize: 15 });
  });
  y += CH + 2;

  // ============================================================ 결과의 활용 가능성 및 확장성
  y = heading('결과의 활용 가능성 및 확장성', y);
  const LH = 822 - y;
  // ---- 기존 방식 vs 제안 방식
  px = M;
  rect(px, y, PW, LH, { fill: { color: 'F5F6F8' }, radius: 4 });
  text('테스트 자동화를 다시 사람이 관리해야 하는 문제를 해결합니다', px + 8, y + 5, PW - 16, 9, { fontSize: 17, bold: true, color: NAVY, align: 'center' });
  const rows = [
    ['기존 방식', '(사람 중심)', 'E1E4EA', NAVY, [[lu.LuPencilLine, '테스트\n작성'], [lu.LuSettings, '자동\n실행'], [lu.LuCircleX, '실패'], [lu.LuSearch, '사람이\n원인 분석'], [lu.LuWrench, '사람이\n수정'], [lu.LuRotateCw, '재실행']]],
    ['제안 방식', '(AI 자동화)', 'DCE6FA', BLUE, [[lu.LuClipboardList, '요구사항\n(문서 등)'], [lu.LuBot, 'AI\n테스트 생성'], [lu.LuSettings, '자동\n실행'], [lu.LuRefreshCw, 'AI\nSelf-Healing'], [lu.LuSearchCode, 'AI\n오류 분석'], [lu.LuLightbulb, '개선방향\n제시']]],
  ];
  const RH = 50, RLW = 38;
  for (let r = 0; r < rows.length; r++) {
    const [lab, lab2, bg, col, items] = rows[r];
    const ry = y + 19 + r * (RH + 16);
    rect(px + 8, ry, PW - 16, RH, { fill: { color: 'FFFFFF' }, line: { color: r ? HEX.accent1 : HEX.accent6, width: r ? 1.5 : 0.75 }, radius: 3 });
    rect(px + 8, ry, RLW, RH, { fill: { color: bg }, radius: 3 });
    text([{ text: lab, options: { bold: true, breakLine: true } }, { text: lab2, options: { fontSize: 14 } }],
      px + 8, ry, RLW, RH, { fontSize: 17, color: col, align: 'center', valign: 'middle', lineSpacingMultiple: 1.2 });
    const iw = (PW - 16 - RLW - 4) / items.length;
    for (let i = 0; i < items.length; i++) {
      const [Ic, t] = items[i];
      const ix = px + 8 + RLW + 2 + i * iw;
      const c = r === 0 ? (i === 2 ? 'E5484D' : HEX.dk2) : (i === 5 ? ORANGE : HEX.accent1);
      await badge(Ic, ix + iw / 2 - 6.5, ry + 7, 13, c);
      text(t, ix, ry + 24, iw, 20, { fontSize: 14, bold: true, align: 'center', lineSpacingMultiple: 1.15 });
      if (i < items.length - 1) chevron(ix + iw - 1.5, ry + 11, 2.5, 4.5);
    }
    if (r === 0) downArrow(px + PW / 2 - 5, ry + RH + 3, 10, 10, HEX.accent1);
  }
  quote('반복적인 테스트 관리에서 벗어나, 개발자는 더 중요한 개발과\n서비스 개선에 집중할 수 있습니다', px + 8, y + LH - 21, PW - 16, 16);

  // ---- 기대효과 (실제로 잰 숫자)
  px = PX2;
  rect(px, y, PW, LH, { fill: { color: 'F2EFFB' }, radius: 4 });
  text('더 빠르고, 더 효율적이며, 더 안정적인 서비스를 제공합니다', px + 8, y + 5, PW - 16, 9, { fontSize: 17, bold: true, color: NAVY, align: 'center' });
  const stats = [[lu.LuNetwork, '화면 자동 발견', '9 / 9', '대상 사이트 화면 모두'], [lu.LuBadgeCheck, '자동 점검', '508개', '배포마다 자체 검증'],
    [lu.LuShieldCheck, '승인 없는 AI 반영', '0건', '모든 변경은 사람 승인']];
  const SW3 = (PW - 16 - 2 * 5) / 3;
  for (let i = 0; i < stats.length; i++) {
    const [Ic, k, big, d] = stats[i];
    const sx = px + 8 + i * (SW3 + 5);
    rect(sx, y + 19, SW3, 46, { fill: { color: 'FFFFFF' }, radius: 3 });
    await badge(Ic, sx + 5, y + 24, 10, '6D4AC7');
    text(k, sx + 18, y + 24, SW3 - 20, 10, { fontSize: 15, bold: true, color: GRAY, valign: 'middle' });
    text(big, sx + 5, y + 36, SW3 - 10, 15, { fontSize: 36, bold: true, color: '5B3DB8' });
    text(d, sx + 5, y + 54, SW3 - 10, 8, { fontSize: 13, color: GRAY });
  }
  const who = [[lu.LuCode, '개발자', '반복 테스트 업무에서 벗어나\n제품과 서비스 개발에 집중'], [lu.LuBuilding, '기업', '테스트 비용 절감\n개발 생산성 향상'],
    [lu.LuUser, '사용자', '더 안정적이고 신뢰할 수 있는\n서비스 제공']];
  for (let i = 0; i < who.length; i++) {
    const [Ic, k, d] = who[i];
    const sx = px + 8 + i * (SW3 + 5);
    rect(sx, y + 71, SW3, 62, { fill: { color: 'FFFFFF' }, radius: 3 });
    await badge(Ic, sx + SW3 / 2 - 7, y + 77, 14, '6D4AC7');
    text(k, sx, y + 94, SW3, 8, { fontSize: 17, bold: true, color: '5B3DB8', align: 'center' });
    text(d, sx + 2, y + 105, SW3 - 4, 24, { fontSize: 14, color: INK, align: 'center', lineSpacingMultiple: 1.25 });
  }
  quote('AI가 만드는 더 높은 소프트웨어 품질,\n', px + 8, y + LH - 21, PW - 16, 16, '더 큰 비즈니스 가치를 실현합니다');

  text('한성대학교 2026-2학기 산학공동연구프로젝트 · 팀 aQm', M, 830, W, 6, { fontSize: 13.5, color: GRAY });
  console.log('활용 칸 높이 =', LH.toFixed(1), '(105 이상 권장)');
  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
})().catch((e) => { console.error(e); process.exit(1); });
