// AI-TestOps 창업 아이템 발표 (7분, 12장) — pptxgenjs 구조형 덱
// node pitch.js <이미지 폴더> <출력.pptx> <apply_theme.js> <대본 json 출력>
const path = require('path');
const fs = require('fs');
const pptxgen = require('pptxgenjs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const sharp = require('sharp');
const si = require('react-icons/si');
const lu = require('react-icons/lu');
const { imageSize } = require('./imgsize');

const [IMG, OUT, THEME_JS, SCRIPT_OUT] = process.argv.slice(2);
const { applyTheme } = require(THEME_JS);
const NOTES_FILE = process.argv[6];
const NOTES = NOTES_FILE ? JSON.parse(fs.readFileSync(NOTES_FILE, 'utf8')) : null;

const THEME = {
  name: 'AI-TestOps Pitch',
  headFontFace: 'Malgun Gothic',
  bodyFontFace: 'Malgun Gothic',
  colors: {
    dk1: '1B2130', lt1: 'FFFFFF', dk2: '15213F', lt2: 'F1F4F9',
    accent1: '3460D9', accent2: '1E9E6A', accent3: 'D64545', accent4: 'F08A24',
    accent5: '6A7385', accent6: 'D5DBE5', hlink: '3460D9', folHlink: '6A7385',
  },
};
const HEX = THEME.colors;
const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.title = 'AI-TestOps 창업 아이템 발표';
pres.author = '팀 aQm';
const C = pres.SchemeColor;
const INK = C.text1, NAVY = C.text2, WHITE = C.background1, BLUE = C.accent1, GREEN = C.accent2, RED = C.accent3, ORANGE = C.accent4, GRAY = C.accent5;

// ------------------------------------------------------------ 레이아웃
pres.defineSlideMaster({
  title: 'CONTENT',
  background: { color: 'FFFFFF' },
  objects: [
    { placeholder: { options: { name: 'kicker', type: 'body', x: 0.6, y: 0.38, w: 9, h: 0.32, fontSize: 13, bold: true, color: BLUE, margin: 0, valign: 'top' }, text: '' } },
    { placeholder: { options: { name: 'title', type: 'title', x: 0.6, y: 0.68, w: 12.1, h: 0.7, fontSize: 28, bold: true, color: NAVY, margin: 0, valign: 'top' }, text: '' } },
    { text: { text: 'AI-TestOps  ·  팀 aQm', options: { x: 0.6, y: 7.05, w: 4, h: 0.25, fontSize: 10, color: GRAY, margin: 0 } } },
  ],
  slideNumber: { x: 12.3, y: 7.02, w: 0.45, h: 0.28, fontSize: 10, color: GRAY, align: 'right' },
});
pres.defineSlideMaster({ title: 'DARK', background: { color: HEX.dk2 }, objects: [] });

// ------------------------------------------------------------ 도우미
let slide;
const script = [];
let lastSection = null;
function add(master, section, title, kicker, seconds, notes) {
  if (section !== lastSection) { pres.addSection({ title: section }); lastSection = section; }
  slide = pres.addSlide({ masterName: master, sectionTitle: section });
  if (NOTES) notes = NOTES[script.length];
  if (master === 'CONTENT') {
    slide.addText(kicker, { placeholder: 'kicker' });
    slide.addText(title, { placeholder: 'title' });
  }
  slide.addNotes(notes);
  script.push({ n: script.length + 1, title, seconds, notes });
}
function text(str, x, y, w, h, o = {}) {
  slide.addText(str, { x, y, w, h, margin: 0, isTextBox: true, valign: 'top', fontSize: 14, color: INK, ...o });
}
function box(x, y, w, h, o = {}) {
  slide.addShape(o.r ? pres.shapes.ROUNDED_RECTANGLE : pres.shapes.RECTANGLE,
    { x, y, w, h, line: { type: 'none' }, ...o, rectRadius: o.r });
}
const shadow = () => ({ type: 'outer', color: '15213F', opacity: 0.14, blur: 10, offset: 2, angle: 90 });
async function icon(Comp, hex) {
  const svg = renderToStaticMarkup(React.createElement(Comp, { color: '#' + hex, size: 384 }));
  return 'image/png;base64,' + (await sharp(Buffer.from(svg)).png().toBuffer()).toString('base64');
}
async function badge(Ic, x, y, s, color, bg) {
  if (bg) slide.addShape(pres.shapes.OVAL, { x, y, w: s, h: s, fill: { color: bg }, line: { type: 'none' } });
  const p = bg ? s * 0.24 : 0;
  slide.addImage({ data: await icon(Ic, color), x: x + p, y: y + p, w: s - 2 * p, h: s - 2 * p });
}
/** 브라우저 창 틀 안의 화면. h 를 주면 그 높이에 맞게 잘라 채운다. 넣은 전체 높이를 돌려준다. */
function browser(file, x, y, w, h) {
  const p = path.join(IMG, file);
  const { width, height } = imageSize(p);
  const bar = 0.22;
  const ih = h || (w * height) / width;
  box(x, y, w, ih + bar, { fill: { color: 'FFFFFF' }, line: { color: HEX.accent6, width: 0.75 }, r: 0.08, shadow: shadow() });
  box(x + 0.01, y + 0.01, w - 0.02, bar - 0.01, { fill: { color: 'EEF1F6' }, r: 0.07 });
  ['F26D6D', 'F2C14E', '5CC27A'].forEach((c, i) => slide.addShape(pres.shapes.OVAL,
    { x: x + 0.1 + i * 0.14, y: y + 0.07, w: 0.08, h: 0.08, fill: { color: c }, line: { type: 'none' } }));
  slide.addImage({ path: p, x: x + 0.01, y: y + bar, w: w - 0.02, h: ih,
    sizing: h ? { type: 'cover', w: w - 0.02, h: ih } : undefined });
  return ih + bar;
}
const chevron = (x, y, s = 0.18, color = HEX.accent6) =>
  slide.addShape(pres.shapes.CHEVRON, { x, y, w: s * 0.6, h: s, fill: { color }, line: { type: 'none' } });

(async () => {
  // ================================================================ 1. 표지
  add('DARK', '시작', 'AI-TestOps', '', 20,
    '안녕하세요. 팀 aQm의 장준호입니다. 저희가 소개할 창업 아이템은 AI-TestOps입니다. '
    + '한 문장으로 말씀드리면, 웹사이트 주소 하나만 넣으면 AI가 사이트를 살펴보고, 사람 대신 점검까지 해 주는 서비스입니다. '
    + '현재 한성대학교 양옥수 교수님 지도 아래 산학공동연구 프로젝트로 개발하고 있습니다.');
  text('2026 창업 아이템 발표', 0.7, 0.75, 6, 0.35, { fontSize: 15, color: 'AFC0E6' });
  text('AI-TestOps', 0.7, 1.2, 6.5, 1.1, { fontSize: 60, bold: true, color: WHITE });
  text('웹사이트 주소 하나로\n점검을 만들고, 돌리고, 고치는\nAI 테스트 자동화 서비스', 0.7, 2.45, 6, 1.5,
    { fontSize: 24, bold: true, color: WHITE, lineSpacingMultiple: 1.15 });
  text([
    { text: '팀 aQm', options: { bold: true, color: WHITE, breakLine: true } },
    { text: '장준호 · 김윤재 · 김상원', options: { color: 'D5DBE5', breakLine: true } },
    { text: '한성대학교 산학공동연구프로젝트 · 지도교수 양옥수', options: { color: 'AFC0E6' } },
  ], 0.7, 4.55, 6, 1.1, { fontSize: 15, lineSpacingMultiple: 1.35 });
  browser('hero2.jpg', 7.1, 1.15, 5.7, 0);
  box(0.7, 6.0, 0.95, 0.95, { fill: { color: 'FFFFFF' }, r: 0.06 });
  slide.addImage({ path: path.join(IMG, 'qr.png'), x: 0.74, y: 6.04, w: 0.87, h: 0.87 });
  text('직접 써 보기\n휴대폰 카메라로 QR을 비추세요', 1.8, 6.15, 4, 0.7, { fontSize: 12, color: 'D5DBE5', lineSpacingMultiple: 1.3 });

  // ================================================================ 2. 문제
  add('CONTENT', '문제', '웹사이트는 매일 바뀌는데, 점검은 아직 사람이 합니다', '문제', 40,
    '여러분이 쇼핑몰을 운영한다고 생각해 보겠습니다. 디자인을 조금 바꿨을 뿐인데, 결제 버튼이 안 눌린다는 사실을 고객 문의로 처음 알게 됩니다. '
    + '이런 일을 막으려면 고칠 때마다 누군가 화면을 하나하나 눌러 봐야 합니다. '
    + '자동화하려면 테스트 코드를 직접 짜야 하고, 화면이 바뀌면 그 코드도 다시 고쳐야 합니다. '
    + '특히 점검 담당자가 따로 없는 스타트업과 작은 팀일수록 이 부담이 큽니다.');
  box(0.6, 1.75, 5.3, 4.7, { fill: { color: HEX.lt2 }, r: 0.12 });
  await badge(lu.LuShoppingCart, 0.95, 2.1, 0.75, 'FFFFFF', HEX.accent3);
  text('이런 일이 생깁니다', 0.95, 3.05, 4.6, 0.35, { fontSize: 14, bold: true, color: RED });
  text('쇼핑몰 디자인을 조금 바꿨을 뿐인데,\n결제 버튼이 안 눌린다는 사실을\n고객 문의로 처음 알게 됩니다', 0.95, 3.45, 4.7, 1.5,
    { fontSize: 20, bold: true, color: NAVY, lineSpacingMultiple: 1.3 });
  text('고칠 때마다 누군가 모든 화면을 다시 눌러 봐야 합니다', 0.95, 5.55, 4.7, 0.6, { fontSize: 13.5, color: GRAY });
  const pains = [
    [lu.LuClock, '매번 사람이 직접 확인', '고칠 때마다 같은 화면을 반복해서 눌러 봐야 합니다'],
    [lu.LuCode, '자동화하려면 코드가 필요', '테스트 코드를 짤 수 있는 전문 인력이 있어야 합니다'],
    [lu.LuRefreshCw, '화면이 바뀌면 자동화도 고장', '디자인이 바뀔 때마다 테스트도 다시 고쳐야 합니다'],
  ];
  for (let i = 0; i < pains.length; i++) {
    const [Ic, t, d] = pains[i];
    const y = 1.75 + i * 1.3;
    box(6.3, y, 6.4, 1.1, { fill: { color: 'FFFFFF' }, line: { color: HEX.accent6, width: 0.75 }, r: 0.1 });
    await badge(Ic, 6.55, y + 0.25, 0.6, HEX.accent1, 'E8EEFB');
    text(t, 7.4, y + 0.2, 5.1, 0.35, { fontSize: 17, bold: true });
    text(d, 7.4, y + 0.6, 5.1, 0.35, { fontSize: 13.5, color: GRAY });
  }
  text('점검 담당자가 따로 없는 스타트업 · 작은 팀일수록 부담이 더 큽니다', 6.3, 5.75, 6.4, 0.4, { fontSize: 14, bold: true, color: NAVY });

  // ================================================================ 3. 기존 방법 비교
  add('CONTENT', '문제', '지금 있는 방법들은 하나씩 빠져 있습니다', '기존 방법의 한계', 40,
    '물론 이미 여러 방법이 있습니다. 사람이 직접 확인하면 정확하지만 시간이 너무 많이 듭니다. '
    + '기존 자동화 도구는 빠르지만 코드를 짤 줄 알아야 하고, 화면이 바뀌면 깨집니다. '
    + '요즘은 AI에게 맡기기도 하는데, AI는 실제 화면을 보지 않고 버튼 이름을 짐작해서 쓰기 때문에 실행하면 자주 실패합니다. '
    + 'AI-TestOps는 이 네 가지를 모두 채우는 것을 목표로 만들었습니다.');
  const cols = ['사람이 직접 확인', '기존 자동화 도구', '일반 AI 도우미', 'AI-TestOps'];
  const rows = [
    ['코드를 몰라도 쓸 수 있다', [1, 0, 1, 1]],
    ['실제 화면을 보고 점검한다', [1, 1, 0, 1]],
    ['반복해서 자동으로 돌린다', [0, 1, 1, 1]],
    ['결과를 누구나 한눈에 본다', [0, 0, 0, 1]],
  ];
  const tx = 0.6, tw = 12.1, lw = 3.6, cw = (tw - lw) / 4, ty = 1.85, rh = 0.95;
  box(tx + lw + 3 * cw, ty - 0.1, cw, rh * (rows.length + 1) + 0.2, { fill: { color: 'E8EEFB' }, r: 0.12 });
  cols.forEach((c, i) => text(c, tx + lw + i * cw, ty, cw, rh, { fontSize: 15, bold: true, align: 'center', valign: 'middle', color: i === 3 ? BLUE : INK }));
  for (let r = 0; r < rows.length; r++) {
    const [label, marks] = rows[r];
    const y = ty + (r + 1) * rh;
    slide.addShape(pres.shapes.LINE, { x: tx, y, w: tw, h: 0, line: { color: HEX.accent6, width: 0.75 } });
    text(label, tx + 0.1, y, lw - 0.1, rh, { fontSize: 15.5, bold: true, valign: 'middle' });
    for (let i = 0; i < 4; i++) {
      const ok = marks[i];
      await badge(ok ? lu.LuCircleCheck : lu.LuCircleMinus, tx + lw + i * cw + cw / 2 - 0.22, y + rh / 2 - 0.22, 0.44,
        ok ? (i === 3 ? HEX.accent1 : HEX.accent2) : 'B8C0CC');
    }
  }

  // ================================================================ 4. 솔루션
  add('CONTENT', '해결', '주소만 넣으면, AI가 살펴보고 점검까지 합니다', '해결 방법', 35,
    'AI-TestOps는 세 단계로 동작합니다. 첫째, 점검할 사이트 주소나 GitHub 저장소를 등록합니다. '
    + '둘째, AI가 실제 화면과 코드를 살펴보고 사이트 전체를 지도로 그립니다. '
    + '셋째, 그 지도에 실제로 있는 버튼과 입력칸으로만 점검표를 만들어 자동으로 실행하고, 결과를 보여 줍니다. '
    + '핵심은 짐작하지 않고, 먼저 보고 나서 만든다는 점입니다. 그리고 AI를 꺼도 녹화, 실행, 결과 기능은 그대로 동작합니다.');
  const sol = [
    [lu.LuLink, '등록', '사이트 주소나\nGitHub 저장소를 넣습니다', 'f-projects.jpg'],
    [lu.LuScanEye, '살펴보기', 'AI가 화면과 코드를 살펴\n사이트 지도를 그립니다', 'g-graph.jpg'],
    [lu.LuBadgeCheck, '자동 점검', '지도에 있는 버튼으로 점검하고\n결과와 영상을 남깁니다', 'g-results.jpg'],
  ];
  for (let i = 0; i < sol.length; i++) {
    const [Ic, t, d, img] = sol[i];
    const x = 0.6 + i * 4.1;
    browser(img, x, 1.8, 3.75, 2.05);
    await badge(Ic, x, 4.35, 0.6, 'FFFFFF', HEX.accent1);
    text(`${i + 1}  ${t}`, x + 0.75, 4.42, 2.9, 0.45, { fontSize: 20, bold: true, color: NAVY });
    text(d, x, 5.1, 3.75, 0.8, { fontSize: 14.5, color: GRAY, lineSpacingMultiple: 1.3 });
    if (i < 2) chevron(x + 3.85, 2.75, 0.3);
  }
  box(0.6, 6.15, 12.1, 0.55, { fill: { color: HEX.lt2 }, r: 0.08 });
  text('짐작하지 않고, 먼저 보고 만듭니다  ·  AI를 꺼도 녹화 · 실행 · 결과 기능은 그대로 동작합니다', 0.6, 6.15, 12.1, 0.55,
    { fontSize: 14.5, bold: true, color: NAVY, align: 'center', valign: 'middle' });

  // ================================================================ 5. 핵심 1: 코드베이스 분석 + 지식 그래프
  add('CONTENT', '해결', '사이트 전체를 한 장의 지도로 보여 줍니다', '핵심 기능 1  ·  코드베이스 분석 + 지식 그래프', 45,
    '첫 번째 핵심 기능입니다. GitHub 저장소만 연결하면 AI가 코드를 읽어 어떤 화면과 버튼이 있는지 찾아냅니다. '
    + '여기에 실제 사이트를 직접 돌아다니며 확인한 결과를 합쳐 지식 그래프, 쉽게 말해 사이트 지도를 만듭니다. '
    + '화면 하나가 상자 하나이고, 색이 곧 상태입니다. 초록은 점검 통과, 빨강은 막힌 곳입니다. '
    + '막힌 곳을 누르면 이유와 고칠 방법이 바로 나옵니다. 사이트를 처음 보는 사람도 어디부터 손봐야 할지 알 수 있습니다.');
  browser('hero2.jpg', 0.6, 1.75, 7.6, 0);
  const kg = [
    [lu.LuGithub, '저장소를 읽어 자동 수집', 'GitHub 코드를 분석해 화면 · 버튼 · 입력칸을 모읍니다'],
    [lu.LuNetwork, '화면 하나가 상자 하나', '화면과 화면 사이 이동을 하나의 지도로 저장합니다'],
    [lu.LuCircleAlert, '막힌 곳은 이유와 해결 방법까지', '빨간 상자를 누르면 원인과 다음 행동을 알려 줍니다'],
  ];
  for (let i = 0; i < kg.length; i++) {
    const [Ic, t, d] = kg[i];
    const y = 1.8 + i * 1.2;
    await badge(Ic, 8.6, y, 0.55, HEX.accent1, 'E8EEFB');
    text(t, 9.35, y - 0.02, 3.4, 0.4, { fontSize: 16, bold: true });
    text(d, 9.35, y + 0.4, 3.4, 0.6, { fontSize: 12.5, color: GRAY, lineSpacingMultiple: 1.25 });
  }
  [['2E9E5B', '점검 통과'], ['3B82F6', '화면만 확인'], ['9AA3B2', '아직 안 봄'], ['D64545', '막힘']].forEach(([c, t], i) => {
    const x = 8.6 + (i % 2) * 2.05, y = 5.6 + Math.floor(i / 2) * 0.45;
    slide.addShape(pres.shapes.OVAL, { x, y: y + 0.07, w: 0.18, h: 0.18, fill: { color: c }, line: { type: 'none' } });
    text(t, x + 0.28, y, 1.7, 0.32, { fontSize: 13 });
  });

  // ================================================================ 6. 핵심 2: 점검표 만들기
  add('CONTENT', '해결', '점검표는 말로 쓰거나, 직접 눌러서 만듭니다', '핵심 기능 2  ·  AI 점검표 작성 + 클릭 녹화', 40,
    '두 번째는 점검표를 만드는 방법입니다. 확인하고 싶은 내용을 "로그인하면 대시보드가 보이는지 확인"처럼 말로 쓰면, AI가 점검 코드를 대신 씁니다. '
    + '이때 AI는 앞에서 만든 지도에 실제로 있는 버튼만 쓰기 때문에 엉뚱한 이름을 짐작하지 않습니다. '
    + '말로 쓰기 어렵다면 브라우저에서 직접 눌러 보면 됩니다. 누른 순서가 그대로 점검표로 저장되고, 이 기능은 AI 없이도 동작합니다. 비밀번호 같은 값은 코드에 남기지 않습니다.');
  const two = [
    ['g-aigen.jpg', lu.LuSparkles, '말로 쓰면 AI가 작성', '확인할 내용을 문장으로 쓰면\n지도에 있는 버튼만 써서 점검 코드를 만듭니다'],
    ['g-recorder.jpg', lu.LuMousePointerClick, '직접 눌러서 녹화', '브라우저에서 누른 순서가 그대로 점검표가 됩니다\nAI가 없어도 쓸 수 있습니다'],
  ];
  for (let i = 0; i < two.length; i++) {
    const [img, Ic, t, d] = two[i];
    const x = 0.6 + i * 6.2;
    browser(img, x, 1.75, 5.9, 2.95);
    await badge(Ic, x, 5.2, 0.55, 'FFFFFF', HEX.accent1);
    text(t, x + 0.7, 5.22, 5.1, 0.45, { fontSize: 19, bold: true, color: NAVY });
    text(d, x, 5.85, 5.9, 0.8, { fontSize: 14, color: GRAY, lineSpacingMultiple: 1.3 });
  }

  // ================================================================ 7. 핵심 3: 결과 · 대시보드 · 승인
  add('CONTENT', '해결', '결과는 한눈에, AI의 수정은 사람이 승인합니다', '핵심 기능 3  ·  격리 실행 + 차수별 대시보드 + 승인', 35,
    '세 번째는 결과를 보는 방법입니다. 점검은 서로 섞이지 않는 독립된 실행 공간에서 돌아가고, 실패한 순간의 화면과 영상이 남습니다. '
    + '대시보드에서는 1차, 2차처럼 돌린 순서대로 결과를 비교해, 지난번보다 무엇이 새로 고장 났는지 한 문장으로 알려 줍니다. '
    + '그리고 AI가 점검표를 고쳤을 때는 반드시 사람이 바뀐 부분을 보고 승인해야 반영됩니다. AI가 마음대로 바꾸는 일은 없습니다.');
  browser('g-rounds.jpg', 0.6, 1.75, 7.3, 0);
  const res = [
    [lu.LuContainer, '독립된 공간에서 실행', '점검끼리 섞이지 않고, 실패한 순간의 화면 · 영상 · 기록이 남습니다'],
    [lu.LuChartColumn, '1차 · 2차 비교', '지난번보다 새로 고장 난 곳과 고쳐진 곳을 한 문장으로 알려 줍니다'],
    [lu.LuShieldCheck, '사람이 승인해야 반영', 'AI가 고친 내용은 바뀐 부분을 보고 승인해야 실제로 들어갑니다'],
  ];
  for (let i = 0; i < res.length; i++) {
    const [Ic, t, d] = res[i];
    const y = 1.8 + i * 1.45;
    await badge(Ic, 8.3, y, 0.55, i === 2 ? HEX.accent2 : HEX.accent1, i === 2 ? 'E3F4EC' : 'E8EEFB');
    text(t, 9.05, y - 0.02, 3.7, 0.4, { fontSize: 16, bold: true });
    text(d, 9.05, y + 0.4, 3.7, 0.8, { fontSize: 12.5, color: GRAY, lineSpacingMultiple: 1.25 });
  }

  // ================================================================ 8. 기술과 구조
  add('CONTENT', '기술과 성과', '검증된 오픈소스 위에, 안전하게 만들었습니다', '기술 스택과 구조', 35,
    '기술 구조를 간단히 말씀드리겠습니다. 화면은 React, 서버는 Spring Boot로 만들었고, 실제 브라우저를 움직이는 부분은 마이크로소프트가 만든 오픈소스 Playwright를 씁니다. '
    + '점검은 Docker 컨테이너라는 독립된 공간에서 돌아가고, AI는 Claude와 GPT를 함께 지원합니다. '
    + '안전을 위해 세 가지를 지켰습니다. AI 키는 서버에만 두고, 점검은 격리된 공간에서 돌리고, AI가 바꾼 내용은 사람이 승인해야 반영합니다.');
  // 구조도
  const node = async (x, y, w, h, Ic, t, d, fill, col) => {
    box(x, y, w, h, { fill: { color: fill }, line: { color: HEX.accent6, width: 0.75 }, r: 0.1, shadow: shadow() });
    await badge(Ic, x + 0.18, y + h / 2 - 0.22, 0.44, col);
    text(t, x + 0.75, y + 0.12, w - 0.85, 0.35, { fontSize: 14, bold: true, color: fill === HEX.dk2 ? WHITE : INK });
    text(d, x + 0.75, y + 0.45, w - 0.85, h - 0.5, { fontSize: 11, color: fill === HEX.dk2 ? 'D5DBE5' : GRAY });
  };
  await node(0.6, 1.95, 2.6, 0.95, lu.LuMonitor, '사용자 화면', 'React · TypeScript', 'FFFFFF', HEX.accent1);
  await node(3.7, 1.95, 3.0, 0.95, lu.LuServer, '서버', 'Spring Boot · 승인 · 실행 관리', HEX.dk2, 'FFFFFF');
  await node(3.7, 3.5, 3.0, 0.95, lu.LuDatabase, '데이터 · 사이트 지도', 'PostgreSQL', 'FFFFFF', HEX.accent1);
  await node(7.2, 1.25, 2.9, 0.95, lu.LuBot, 'AI', 'Claude · GPT (키는 서버만)', 'FFFFFF', HEX.accent4);
  await node(7.2, 2.65, 2.9, 0.95, lu.LuContainer, '격리 실행 공간', 'Docker + Playwright', 'FFFFFF', HEX.accent2);
  await node(7.2, 4.05, 2.9, 0.95, lu.LuGlobe, '점검할 웹사이트', '실제 화면을 열어 점검', 'FFFFFF', HEX.accent5);
  const ln = (x1, y1, x2, y2) => slide.addShape(pres.shapes.LINE, { x: x1, y: Math.min(y1, y2), w: x2 - x1, h: Math.abs(y2 - y1), flipV: y2 < y1, line: { color: 'A9B3C4', width: 1.5, endArrowType: 'triangle' } });
  ln(3.2, 2.42, 3.7, 2.42); ln(5.2, 2.9, 5.2, 3.5); ln(6.7, 2.25, 7.2, 1.75); ln(6.7, 2.55, 7.2, 3.1); ln(8.65, 3.6, 8.65, 4.05);
  // 기술 스택 타일
  const stack = [['FE', 'React · TypeScript', si.SiReact, '149ECA'], ['BE', 'Spring Boot · Java 21', si.SiSpringboot, '6DB33F'],
    ['DB', 'PostgreSQL', si.SiPostgresql, '4169E1'], ['Test', 'Playwright', lu.LuMonitorPlay, '2EAD33'],
    ['Infra', 'Docker · GitHub Actions', si.SiDocker, '2496ED'], ['AI', 'Claude · GPT · LangGraph', si.SiClaude, 'D97757']];
  for (let i = 0; i < stack.length; i++) {
    const [k, v, Ic, c] = stack[i];
    const x = 10.45, y = 1.25 + i * 0.62;
    box(x, y, 2.25, 0.52, { fill: { color: 'FFFFFF' }, line: { color: HEX.accent6, width: 0.75 }, r: 0.08 });
    await badge(Ic, x + 0.1, y + 0.12, 0.28, c);
    text(k, x + 0.48, y + 0.05, 1.7, 0.2, { fontSize: 9.5, bold: true, color: BLUE });
    text(v, x + 0.48, y + 0.24, 1.75, 0.25, { fontSize: 10.5, bold: true });
  }
  const safe = [['AI 키는 서버에만', '실행 공간은 키를 받지 않습니다'], ['점검은 격리된 공간에서', '서로 섞이지 않고 서버를 지킵니다'], ['AI 변경은 사람이 승인', '승인 없이 반영된 변경 0건']];
  for (let i = 0; i < safe.length; i++) {
    const x = 0.6 + i * 4.1;
    box(x, 5.45, 3.85, 1.2, { fill: { color: HEX.lt2 }, r: 0.1 });
    await badge(lu.LuLock, x + 0.25, 5.75, 0.55, HEX.accent2, 'FFFFFF');
    text(safe[i][0], x + 1.0, 5.68, 2.75, 0.4, { fontSize: 15.5, bold: true });
    text(safe[i][1], x + 1.0, 6.08, 2.75, 0.4, { fontSize: 12.5, color: GRAY });
  }

  // ================================================================ 9. 성과
  add('CONTENT', '기술과 성과', '이미 실제 서버에서 돌아가고 있습니다', '지금까지의 성과', 35,
    '지금까지의 성과입니다. AI-TestOps는 발표 자료 속 아이디어가 아니라 실제 서버에서 돌아가는 서비스입니다. '
    + '시험 대상 사이트의 화면 아홉 개를 AI가 모두 찾아냈고, 저희 서비스 자체도 배포할 때마다 508개의 자동 점검을 통과해야 올라갑니다. '
    + '사람 승인 없이 AI가 반영한 변경은 0건이고, 이 기술로 특허 발명신고도 마쳤습니다. 소스 코드는 GitHub에 공개되어 있습니다.');
  const stats = [['9 / 9', '시험 사이트 화면\nAI가 모두 찾음', HEX.accent1], ['508개', '배포마다 통과하는\n자체 자동 점검', HEX.accent1],
    ['0건', '사람 승인 없이\n반영된 AI 변경', HEX.accent2], ['1건', '특허 발명신고\n(산학 공동)', HEX.accent4]];
  stats.forEach(([big, d, c], i) => {
    const x = 0.6 + i * 3.05;
    box(x, 1.9, 2.8, 2.6, { fill: { color: HEX.lt2 }, r: 0.12 });
    text(big, x, 2.25, 2.8, 1.0, { fontSize: 46, bold: true, color: c, align: 'center' });
    text(d, x + 0.2, 3.4, 2.4, 0.9, { fontSize: 15, color: INK, align: 'center', lineSpacingMultiple: 1.3 });
  });
  box(0.6, 4.95, 12.1, 1.55, { fill: { color: 'FFFFFF' }, line: { color: HEX.accent6, width: 0.75 }, r: 0.12 });
  slide.addImage({ path: path.join(IMG, 'qr-github.png'), x: 0.85, y: 5.08, w: 1.3, h: 1.3 });
  await badge(si.SiGithub, 2.45, 5.2, 0.45, HEX.dk2);
  text('GitHub 공개 저장소에서 개발 중', 3.05, 5.2, 9, 0.45, { fontSize: 18, bold: true });
  text('github.com/digitalist-corp/AI-TestOps  ·  변경은 리뷰를 거쳐 GitHub Actions로 자동 배포', 2.45, 5.8, 10, 0.4, { fontSize: 13.5, color: GRAY });

  // ================================================================ 10. 고객과 수익 모델
  add('CONTENT', '사업', '누가 쓰고, 어떻게 수익을 내나요', '고객과 수익 모델', 35,
    '첫 고객은 점검 담당자가 따로 없는 스타트업과 작은 개발팀입니다. 다음은 업데이트가 잦은 쇼핑몰과 서비스 운영사이고, '
    + '마지막으로 보안 때문에 외부 클라우드를 쓰기 어려운 금융과 공공기관입니다. '
    + '수익은 세 가지로 냅니다. 바로 쓸 수 있는 월 구독형, 고객사 서버에 직접 설치하는 설치형, 그리고 학교와 교육기관을 위한 교육용 패키지입니다. '
    + '저희 서비스는 Docker로 통째로 설치할 수 있게 만들어져 있어서 설치형으로도 바로 제공할 수 있습니다.');
  text('누가 쓰나요', 0.6, 1.75, 6, 0.4, { fontSize: 16, bold: true, color: BLUE });
  const cust = [[lu.LuRocket, '스타트업 · 작은 개발팀', '점검 담당자가 따로 없는 팀'], [lu.LuShoppingCart, '쇼핑몰 · 서비스 운영사', '업데이트가 잦은 웹 서비스'],
    [lu.LuLandmark, '금융 · 공공기관', '외부 클라우드를 쓰기 어려운 곳']];
  for (let i = 0; i < cust.length; i++) {
    const [Ic, t, d] = cust[i];
    const y = 2.25 + i * 1.3;
    box(0.6, y, 5.6, 1.1, { fill: { color: HEX.lt2 }, r: 0.1 });
    await badge(Ic, 0.85, y + 0.25, 0.6, HEX.accent1, 'FFFFFF');
    text(t, 1.7, y + 0.2, 4.3, 0.4, { fontSize: 17, bold: true });
    text(d, 1.7, y + 0.6, 4.3, 0.35, { fontSize: 13.5, color: GRAY });
  }
  text('어떻게 수익을 내나요', 6.8, 1.75, 6, 0.4, { fontSize: 16, bold: true, color: BLUE });
  const bm = [['구독형 (SaaS)', '가입하고 바로 사용', '점검할 사이트 수와 실행 횟수에 따라 월 구독'],
    ['설치형', '고객사 서버에 직접 설치', 'Docker로 통째로 설치 · 보안이 중요한 기관용'],
    ['교육용 패키지', '학교 · 교육기관', '소프트웨어 품질 수업과 실습 환경으로 제공']];
  bm.forEach(([t, s, d], i) => {
    const y = 2.25 + i * 1.3;
    box(6.8, y, 5.9, 1.1, { fill: { color: 'FFFFFF' }, line: { color: i === 0 ? HEX.accent1 : HEX.accent6, width: i === 0 ? 1.5 : 0.75 }, r: 0.1 });
    text(t, 7.05, y + 0.18, 2.6, 0.4, { fontSize: 17, bold: true, color: i === 0 ? BLUE : INK });
    text(s, 9.6, y + 0.22, 2.95, 0.35, { fontSize: 12.5, color: GRAY, align: 'right' });
    text(d, 7.05, y + 0.62, 5.5, 0.35, { fontSize: 13.5 });
  });

  // ================================================================ 11. 함께하는 사람들
  add('CONTENT', '사업', '산학이 함께 만들고 있습니다', '협력과 팀', 30,
    '이 아이템은 혼자 만든 것이 아닙니다. 한성대학교 양옥수 교수님 지도 아래 산학공동연구 프로젝트로 진행하고 있고, '
    + '디지털IST의 현업 담당 부장님께 실무 관점의 조언을 받으며, 디지털EnS와도 협력하고 있습니다. '
    + '팀은 세 명입니다. 저 장준호가 대표로 기획과 화면, AI 기능 개발을 맡고, 김윤재 팀원이 서버와 실행 환경 개발을, '
    + '김상원 팀원이 문서 작업과 회계 관리를 맡고 있습니다.');
  text('함께하는 곳', 0.6, 1.75, 6, 0.4, { fontSize: 16, bold: true, color: BLUE });
  const partners = [[lu.LuGraduationCap, '한성대학교', '산학공동연구프로젝트 · 지도교수 양옥수'], [lu.LuBuilding2, '디지털IST', '박OO 부장 · 현업 실무 멘토링'],
    [lu.LuHandshake, '디지털EnS', '협력 기업']];
  for (let i = 0; i < partners.length; i++) {
    const [Ic, t, d] = partners[i];
    const y = 2.25 + i * 1.3;
    box(0.6, y, 5.6, 1.1, { fill: { color: HEX.lt2 }, r: 0.1 });
    await badge(Ic, 0.85, y + 0.25, 0.6, HEX.dk2, 'FFFFFF');
    text(t, 1.7, y + 0.2, 4.3, 0.4, { fontSize: 17, bold: true });
    text(d, 1.7, y + 0.6, 4.3, 0.35, { fontSize: 13.5, color: GRAY });
  }
  text('팀 aQm', 6.8, 1.75, 6, 0.4, { fontSize: 16, bold: true, color: BLUE });
  const team = [['장준호', '대표 · 개발', '기획 · 화면 · AI 기능 개발'], ['김윤재', '개발', '서버 · 실행 환경 · 배포'], ['김상원', '경영 지원', '문서 작업 · 회계 관리']];
  for (let i = 0; i < team.length; i++) {
    const [n, r, d] = team[i];
    const x = 6.8 + i * 2.0;
    box(x, 2.25, 1.85, 3.7, { fill: { color: 'FFFFFF' }, line: { color: HEX.accent6, width: 0.75 }, r: 0.12 });
    await badge(lu.LuUser, x + 0.55, 2.55, 0.75, 'FFFFFF', i === 2 ? HEX.accent5 : HEX.accent1);
    text(n, x, 3.5, 1.85, 0.45, { fontSize: 19, bold: true, align: 'center' });
    text(r, x, 3.98, 1.85, 0.35, { fontSize: 13, bold: true, color: BLUE, align: 'center' });
    text(d.split(' · ').join('\n'), x + 0.1, 4.45, 1.65, 1.3, { fontSize: 12.5, color: GRAY, align: 'center', lineSpacingMultiple: 1.35 });
  }

  // ================================================================ 12. 로드맵과 마무리
  add('DARK', '마무리', '로드맵과 마무리', '', 30,
    '앞으로의 계획입니다. 올해 안에 실패 원인을 찾아 스스로 고치고 다시 점검하는 자동 수정 기능을 완성하고, '
    + '내년 상반기에는 협력 기업과 함께 실제 서비스에서 시범 운영을 하며, 하반기에 정식 출시와 특허 출원을 목표로 합니다. '
    + '저희가 만들고 싶은 것은 하나입니다. 점검 담당자가 없어도, 사이트 주소 하나로 점검을 만들고 돌리고 고치는 서비스입니다. '
    + '지금 화면의 QR로 직접 써 보실 수 있습니다. 감사합니다.');
  text('앞으로의 계획', 0.7, 0.6, 6, 0.4, { fontSize: 16, bold: true, color: 'AFC0E6' });
  const road = [['2026. 11', '산학 성과공유 · 특허 발명신고'], ['2026. 12', 'AI 자동 수정 기능 완성'], ['2027 상반기', '협력 기업 시범 운영'], ['2027 하반기', '정식 출시 · 특허 출원']];
  slide.addShape(pres.shapes.LINE, { x: 0.9, y: 1.62, w: 11.5, h: 0, line: { color: '4A5A80', width: 2 } });
  road.forEach(([d, t], i) => {
    const x = 0.7 + i * 3.05;
    slide.addShape(pres.shapes.OVAL, { x: x + 0.1, y: 1.5, w: 0.24, h: 0.24, fill: { color: i === 0 ? HEX.accent4 : 'FFFFFF' }, line: { type: 'none' } });
    text(d, x, 1.9, 2.9, 0.4, { fontSize: 16, bold: true, color: WHITE });
    text(t, x, 2.3, 2.9, 0.4, { fontSize: 13.5, color: 'D5DBE5' });
  });
  text('점검 담당자가 없어도,\n사이트 주소 하나로 점검을 만들고 돌리고 고칩니다', 0.7, 3.55, 9, 1.4,
    { fontSize: 30, bold: true, color: WHITE, lineSpacingMultiple: 1.2 });
  text('팀 aQm  ·  장준호 · 김윤재 · 김상원', 0.7, 5.35, 8, 0.4, { fontSize: 15, color: 'D5DBE5' });
  text('감사합니다', 0.7, 6.0, 6, 0.6, { fontSize: 24, bold: true, color: 'AFC0E6' });
  box(10.55, 3.6, 1.8, 1.8, { fill: { color: 'FFFFFF' }, r: 0.08 });
  slide.addImage({ path: path.join(IMG, 'qr.png'), x: 10.6, y: 3.65, w: 1.7, h: 1.7 });
  text('직접 써 보기', 10.3, 5.5, 2.3, 0.35, { fontSize: 14, bold: true, color: WHITE, align: 'center' });

  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  fs.writeFileSync(SCRIPT_OUT, JSON.stringify(script, null, 2));
  console.log('슬라이드', script.length, '장, 총', script.reduce((s, x) => s + x.seconds, 0), '초');
})().catch((e) => { console.error(e); process.exit(1); });
