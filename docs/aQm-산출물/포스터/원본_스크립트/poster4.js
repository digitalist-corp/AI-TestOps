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

(async () => {
  const M = 26, W = 594 - 2 * M;
  const heading = (t, y) => { y += 5; text(t, M, y, W, 14, { fontSize: 36, bold: true, color: NAVY }); return y + 17; };
  const sub = (t, y) => { text(t, M, y, W, 9, { fontSize: 21, bold: true, color: BLUE }); return y + 11; };

  // ============================================================ 표지: [팀명] 프로젝트명 / 참여자
  rect(0, 0, 594, 90, { fill: { color: HEX.dk2 } });
  text('2026-2학기 산학공동연구프로젝트 성과공유회', M, 13, 300, 7, { fontSize: 17, color: 'C9D0DC' });
  text([
    { text: '[aQm] ', options: { color: '9FB4E8' } },
    { text: 'AI-TestOps', options: { color: 'FFFFFF' } },
  ], M, 19, 420, 28, { fontSize: 78, bold: true });
  text('웹사이트가 제대로 동작하는지 사람 대신 자동으로 점검해 주는 서비스', M, 54, 430, 10, { fontSize: 25, bold: true, color: WHITE });
  text([
    { text: '지도교수  ', options: { color: '9FB4E8', bold: true } },
    { text: '양옥수', options: { color: 'FFFFFF' } },
    { text: '      참여학생  ', options: { color: '9FB4E8', bold: true } },
    { text: '장준호(팀장) · 김윤재 · 장동현 · 박준서 · 김상원', options: { color: 'FFFFFF' } },
  ], M, 70, 430, 9, { fontSize: 19 });
  // QR
  rect(594 - M - 50, 12, 50, 50, { fill: { color: 'FFFFFF' }, radius: 2.5 });
  slide.addImage({ path: path.join(IMG, 'qr.png'), x: u(594 - M - 47.5), y: u(14.5), w: u(45), h: u(45) });
  text('QR로 바로 써 보기', 594 - M - 60, 68, 60, 8, { fontSize: 17, bold: true, color: WHITE, align: 'center' });

  // ============================================================ 프로젝트 개요
  let y = heading('프로젝트 개요', 95);
  const LW = 262, RX = M + LW + 14, RW = W - LW - 14;
  text('이런 서비스입니다', M, y, LW, 8, { fontSize: 19, bold: true, color: BLUE });
  text([
    { text: '웹사이트는 고칠 때마다 로그인이 되는지, 버튼이 눌리는지 다시 확인해야 합니다.', options: { breakLine: true } },
    { text: 'AI-TestOps', options: { bold: true } },
    { text: '는 이 확인을 대신 해 줍니다. 주소만 알려 주면 사이트를 둘러보며 어떤 화면이 있는지 지도로 그리고, '
      + '사람 대신 버튼을 눌러 보는 점검표를 만들어 몇 번이든 자동으로 실행합니다.', options: {} },
  ], M, y + 10, LW, 44, { fontSize: 18.5, lineSpacingMultiple: 1.38 });
  // 지금 / 바뀐 뒤
  const cy0 = y + 57;
  [['지금은', '고칠 때마다 사람이 화면을 하나하나 눌러 확인합니다', 'F3F4F6', GRAY],
   ['AI-TestOps는', '주소만 넣으면 점검표를 만들고 결과를 그림으로 보여 줍니다', 'E8EEFB', BLUE]].forEach(([k, d, bg, col], i) => {
    const ry = cy0 + i * 15;
    rect(M, ry, LW, 12.5, { fill: { color: bg }, radius: 2 });
    text(k, M + 5, ry, 46, 12.5, { fontSize: 17, bold: true, color: col, valign: 'middle' });
    text(d, M + 52, ry, LW - 56, 12.5, { fontSize: 16.5, color: INK, valign: 'middle' });
  });
  // 용어 풀이
  const gy = cy0 + 36;
  text('처음 보는 말 풀이', M, gy, LW, 8, { fontSize: 19, bold: true, color: BLUE });
  const terms = [
    ['테스트(점검표)', '사람 대신 사이트를 눌러 보며 확인하는 자동 점검'],
    ['지식 그래프', '사이트의 화면과 화면 사이 이동 경로를 정리한 지도'],
    ['컨테이너', '점검끼리 섞이지 않게 따로 떼어 놓은 작은 실험실'],
    ['생성형 AI', 'Claude · GPT처럼 글과 코드를 대신 써 주는 AI'],
  ];
  const TCW = (LW - 8) / 2;
  terms.forEach(([k, d], i) => {
    const tx = M + (i % 2) * (TCW + 8), ty = gy + 10 + Math.floor(i / 2) * 23;
    text([{ text: k, options: { bold: true, color: INK, breakLine: true } }, { text: d, options: { color: GRAY } }],
      tx, ty, TCW, 20, { fontSize: 15, lineSpacingMultiple: 1.25 });
  });
  const hh = browser('hero2.jpg', RX, y + 2, RW, 0);
  text('실제 화면: 점검 중인 사이트의 지도와 막힌 곳 목록', RX, y + 2 + hh + 2.5, RW, 7, { fontSize: 15, color: GRAY });
  y = Math.max(gy + 10 + 46, y + 2 + hh + 10) + 4;

  // ============================================================ 수행 내용 및 방법
  y = heading('수행 내용 및 방법', y);
  y = sub('사용 흐름', y);
  const steps = [
    ['01', '사이트 등록', '점검할 웹사이트 주소나\nGitHub 저장소를 넣습니다', 'f-projects.jpg'],
    ['02', '사이트 둘러보기', '화면과 버튼을 찾아\n사이트 지도를 그립니다', 'g-graph.jpg'],
    ['03', '점검표 만들기', '확인할 내용을 말로 쓰거나\n직접 눌러 녹화합니다', 'g-aigen.jpg'],
    ['04', '자동 점검', '독립된 공간에서 실행하고\n실패한 순간을 영상으로 남깁니다', 'g-results.jpg'],
    ['05', '결과 비교', '1차 · 2차 결과를 비교해\n새로 고장 난 곳을 찾습니다', 'g-rounds.jpg'],
  ];
  const SG = 9, SW = (W - 4 * SG) / 5, SH = SW * 0.58;
  steps.forEach(([n, t, d, img], i) => {
    const sx = M + i * (SW + SG);
    const bh = browser(img, sx, y, SW, SH, false);
    text(n, sx, y + bh + 3, 18, 9, { fontSize: 23, bold: true, color: BLUE });
    text(t, sx + 15, y + bh + 3.5, SW - 15, 9, { fontSize: 20, bold: true });
    text(d, sx, y + bh + 12.5, SW, 14, { fontSize: 15, color: GRAY, lineSpacingMultiple: 1.25 });
    if (i < 4) slide.addShape(pres.shapes.CHEVRON, { x: u(sx + SW + SG / 2 - 1.5), y: u(y + bh / 2 - 2.5), w: u(3), h: u(5), fill: { color: HEX.accent6 }, line: { type: 'none' } });
  });
  y += SH + 4 + 32;

  y = sub('주요 기능', y);
  const features = [
    [lu.LuGithub, '코드 분석', '소스 코드에서 페이지 · 입력칸 · 버튼을\n찾아 화면 목록을 만듭니다'],
    [lu.LuNetwork, '사이트 지도 (지식 그래프)', '화면과 화면 사이 이동을\n하나의 지도로 저장하고 보여 줍니다'],
    [lu.LuSparkles, 'AI 점검표 작성', '확인할 내용을 문장으로 쓰면\nAI가 점검 코드를 대신 씁니다'],
    [lu.LuMousePointerClick, '클릭 녹화', '직접 눌러 본 순서를 그대로 점검표로\n저장합니다 (AI 없이도 가능)'],
    [lu.LuContainer, '독립 실행과 기록', '점검마다 컨테이너에서 따로 돌리고\n화면 · 영상 · 기록을 남깁니다'],
    [lu.LuShieldCheck, '사람 승인 후 반영', 'AI가 고친 내용은 사람이 확인하고\n승인해야 실제로 반영됩니다'],
  ];
  const FG = 12, FW = (W - 2 * FG) / 3;
  for (let i = 0; i < features.length; i++) {
    const [Ic, t, d] = features[i];
    const fx = M + (i % 3) * (FW + FG), fy = y + Math.floor(i / 3) * 31;
    rect(fx, fy, 14, 14, { fill: { color: 'E8EEFB' }, radius: 3.2 });
    slide.addImage({ data: await icon(Ic, HEX.accent1), x: u(fx + 3.25), y: u(fy + 3.25), w: u(7.5), h: u(7.5) });
    text(t, fx + 19, fy - 0.5, FW - 19, 8.5, { fontSize: 19.5, bold: true });
    text(d, fx + 19, fy + 8, FW - 19, 15, { fontSize: 15, color: GRAY, lineSpacingMultiple: 1.22 });
  }
  y += 2 * 31 + 3;

  y = sub('기술 스택', y);
  const stack = [
    ['FE', 'React · TypeScript', si.SiReact, 'SiReact'], ['BE', 'Spring Boot · Java 21', si.SiSpringboot, 'SiSpringboot'],
    ['DB', 'PostgreSQL', si.SiPostgresql, 'SiPostgresql'], ['Test', 'Playwright', lu.LuMonitorPlay, 'LuMonitorPlay'],
    ['Infra', 'Docker · GitHub Actions', si.SiDocker, 'SiDocker'], ['AI', 'Claude · GPT', si.SiClaude, 'SiClaude'],
  ];
  const KG = 6, KW = (W - 5 * KG) / 6;
  for (let i = 0; i < stack.length; i++) {
    const [k, v, Ic, name] = stack[i];
    const kx = M + i * (KW + KG);
    rect(kx, y, KW, 20, { fill: { color: 'FFFFFF' }, line: { color: HEX.accent6, width: 0.75 }, radius: 2.5 });
    slide.addImage({ data: await icon(Ic, brand[name]), x: u(kx + 3.5), y: u(y + 6), w: u(8), h: u(8) });
    text(k, kx + 14, y + 3, KW - 16, 6, { fontSize: 12.5, bold: true, color: BLUE });
    text(v, kx + 14, y + 9, KW - 16, 9, { fontSize: 13.5, bold: true, color: INK });
  }
  y += 26;

  // ============================================================ 주요 성과
  y = heading('주요 성과', y);
  const CW = (W - 12) / 2, CH = 166;
  let cx = M;
  rect(cx, y, CW, CH, { fill: { color: HEX.lt2 }, radius: 4 });
  text('GitHub 저장소만 연결하면', cx + 10, y + 8, CW - 20, 9, { fontSize: 19, color: BLUE, bold: true });
  text('코드를 읽어 자동 점검까지 알아서 돌아갑니다', cx + 10, y + 17, CW - 20, 12, { fontSize: 25, bold: true });
  const flow = [
    [si.SiGithub, '저장소 연결', '웹사이트의\n소스 코드'],
    [lu.LuFileSearch, '코드 분석', '페이지 · 입력칸 ·\n버튼 찾기'],
    [lu.LuNetwork, '사이트 지도', '화면 9개와\n이동 경로'],
    [lu.LuPlay, '자동 점검', '점검표를 만들고\n바로 실행'],
  ];
  const NW = (CW - 20 - 3 * 7) / 4;
  for (let i = 0; i < flow.length; i++) {
    const [Ic, t, d] = flow[i];
    const nx = cx + 10 + i * (NW + 7), ny = y + 38;
    rect(nx, ny, NW, 56, { fill: { color: 'FFFFFF' }, radius: 3, shadow: soft() });
    slide.addImage({ data: await icon(Ic, i === 3 ? HEX.accent2 : HEX.dk2), x: u(nx + NW / 2 - 7), y: u(ny + 7), w: u(14), h: u(14) });
    text(t, nx + 2, ny + 25, NW - 4, 9, { fontSize: 17.5, bold: true, align: 'center' });
    text(d, nx + 2, ny + 35, NW - 4, 16, { fontSize: 14.5, color: GRAY, align: 'center', lineSpacingMultiple: 1.2 });
    if (i < 3) slide.addShape(pres.shapes.CHEVRON, { x: u(nx + NW + 2), y: u(ny + 25.5), w: u(3), h: u(5), fill: { color: HEX.accent6 }, line: { type: 'none' } });
  }
  text('등록하는 순간부터 첫 점검까지 사람 손이 필요 없습니다. AI가 지어낸 이름은 실제 코드와 대조해 걸러 내고, 바뀐 부분만 다시 읽어 빠릅니다.',
    cx + 10, y + 103, CW - 20, 30, { fontSize: 17, lineSpacingMultiple: 1.35 });
  text([{ text: '분석 결과  ', options: { color: GRAY } }, { text: '시험 사이트의 화면 9개를 모두 찾았습니다', options: { bold: true, color: GREEN } }],
    cx + 10, y + 146, CW - 20, 9, { fontSize: 18 });

  cx = M + CW + 12;
  rect(cx, y, CW, CH, { fill: { color: HEX.lt2 }, radius: 4 });
  text('지식 그래프로', cx + 10, y + 8, CW - 20, 9, { fontSize: 19, color: BLUE, bold: true });
  text('점검 중인 웹사이트를 지도처럼 봅니다', cx + 10, y + 17, CW - 20, 12, { fontSize: 25, bold: true });
  const gw = CW - 20;
  const gh = browser('graph-wide.jpg', cx + 10, y + 34, gw, 94, true);
  [['2E9E5B', '점검 통과'], ['3B82F6', '화면만 확인'], ['9AA3B2', '아직 안 봄'], ['D64545', '막힘 · 고칠 곳']].forEach(([c, t], i) => {
    const lx = cx + 10 + i * (gw / 4);
    slide.addShape(pres.shapes.OVAL, { x: u(lx), y: u(y + 34 + gh + 5.5), w: u(4), h: u(4), fill: { color: c }, line: { type: 'none' } });
    text(t, lx + 6, y + 34 + gh + 4.5, gw / 4 - 6, 7, { fontSize: 15 });
  });
  text('화면 하나가 상자 하나, 색이 곧 상태입니다. 막힌 곳을 누르면 이유와 고칠 방법이 나옵니다',
    cx + 10, y + 34 + gh + 13, CW - 20, 12, { fontSize: 15.5, color: GRAY, lineSpacingMultiple: 1.25 });
  y += CH + 9;

  const facts = [
    ['지금도 운영 중', '실제 서버에서 동작하고\n고치면 자동으로 다시 배포'],
    ['자체 점검 508개', '우리 서비스도 배포할 때마다\n508개 자동 점검을 통과'],
    ['AI 단독 반영 0건', 'AI가 바꾼 내용은\n반드시 사람이 승인'],
    ['특허 발명신고', 'Playwright · 도커 · 생성형 AI를 활용한\n웹 자동화 테스트 플랫폼'],
  ];
  const XW = (W - 3 * 10) / 4;
  facts.forEach(([k, d], i) => {
    const kx = M + i * (XW + 10);
    text(k, kx, y, XW, 10, { fontSize: 22, bold: true, color: NAVY });
    text(d, kx, y + 10, XW, 14, { fontSize: 15, color: GRAY, lineSpacingMultiple: 1.22 });
  });
  y += 32;

  // ============================================================ 결과의 활용 가능성 및 확장성
  y = heading('결과의 활용 가능성 및 확장성', y);
  const UW = (W - 14) / 2;
  const blocks = [
    ['누가 바로 쓸 수 있나', ['품질 점검 인력이 따로 없는 스타트업 · 1인 개발 서비스', '쇼핑몰 · 기관 홈페이지 운영자의 업데이트 전 점검', '사내 품질 관리 도구, 소프트웨어 교육 실습']],
    ['어디까지 넓힐 수 있나', ['실패 원인을 찾아 고치고 다시 점검하는 자동 수정', '휴대폰 기종별 점검과 오류 관리 기능', '특허 출원과 기업용 서비스로 사업화']],
  ];
  blocks.forEach(([t, items], i) => {
    const bx = M + i * (UW + 14);
    rect(bx, y, UW, 44, { fill: { color: HEX.lt2 }, radius: 3 });
    text(t, bx + 8, y + 5, UW - 16, 8, { fontSize: 19, bold: true, color: BLUE });
    text(items.map((s, j) => ({ text: s, options: { bullet: { indent: 14 }, breakLine: j < items.length - 1 } })),
      bx + 8, y + 14, UW - 16, 28, { fontSize: 16, lineSpacingMultiple: 1.3 });
  });
  const end = y + 44;

  text('한성대학교 2026-2학기 산학공동연구프로젝트 · 팀 aQm', M, 830, W, 6, { fontSize: 13.5, color: GRAY });
  console.log('본문 끝 y =', end.toFixed(1), '(828 전이어야 함)');
  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
})().catch((e) => { console.error(e); process.exit(1); });
