// AI-TestOps 사업 발표 (IR 형식, 14장, 7분) — pptxgenjs 구조형 덱
// node biz.js <이미지 폴더> <출력.pptx> <apply_theme.js> <대본 json 출력>
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

const THEME = {
  name: 'AI-TestOps IR',
  headFontFace: 'Malgun Gothic',
  bodyFontFace: 'Malgun Gothic',
  colors: {
    dk1: '161B26', lt1: 'FFFFFF', dk2: '0F1B33', lt2: 'F2F4F8',
    accent1: '2F5BD3', accent2: '1E9E6A', accent3: 'D64545', accent4: 'F08A24',
    accent5: '667085', accent6: 'D7DCE4', hlink: '2F5BD3', folHlink: '667085',
  },
};
const HEX = THEME.colors;
const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.title = 'AI-TestOps 사업계획 발표';
pres.author = '팀 aQm';
const C = pres.SchemeColor;
const INK = C.text1, NAVY = C.text2, WHITE = C.background1, BLUE = C.accent1, GREEN = C.accent2, RED = C.accent3, GRAY = C.accent5;

pres.defineSlideMaster({
  title: 'CONTENT',
  background: { color: 'FFFFFF' },
  objects: [
    { placeholder: { options: { name: 'kicker', type: 'body', x: 0.6, y: 0.36, w: 9, h: 0.3, fontSize: 12, bold: true, color: BLUE, margin: 0, valign: 'top', align: 'left' }, text: '' } },
    { placeholder: { options: { name: 'title', type: 'title', x: 0.6, y: 0.64, w: 12.1, h: 0.66, fontSize: 26, bold: true, color: NAVY, margin: 0, valign: 'top', align: 'left' }, text: '' } },
    { text: { text: 'AI-TestOps  |  팀 aQm  |  사업계획 발표', options: { x: 0.6, y: 7.06, w: 5, h: 0.24, fontSize: 9, color: GRAY, margin: 0 } } },
  ],
  slideNumber: { x: 12.3, y: 7.02, w: 0.45, h: 0.28, fontSize: 9, color: GRAY, align: 'right' },
});
pres.defineSlideMaster({ title: 'DARK', background: { color: HEX.dk2 }, objects: [] });

let slide;
const script = [];
let lastSection = null;
function add(master, section, title, kicker, seconds, notes) {
  if (section !== lastSection) { pres.addSection({ title: section }); lastSection = section; }
  slide = pres.addSlide({ masterName: master, sectionTitle: section });
  if (master === 'CONTENT') {
    slide.addText(kicker, { placeholder: 'kicker', align: 'left' });
    slide.addText(title, { placeholder: 'title', align: 'left' });
  }
  slide.addNotes(notes);
  script.push({ n: script.length + 1, title, seconds, notes });
}
const text = (str, x, y, w, h, o = {}) => slide.addText(str, { x, y, w, h, margin: 0, isTextBox: true, valign: 'top', fontSize: 13, color: INK, ...o });
const box = (x, y, w, h, o = {}) => slide.addShape(o.r ? pres.shapes.ROUNDED_RECTANGLE : pres.shapes.RECTANGLE, { x, y, w, h, line: { type: 'none' }, ...o, rectRadius: o.r });
const shadow = () => ({ type: 'outer', color: '0F1B33', opacity: 0.12, blur: 10, offset: 2, angle: 90 });
const source = (s) => text('출처: ' + s, 0.6, 6.72, 12.1, 0.28, { fontSize: 8.5, color: GRAY });
async function icon(Comp, hex) {
  const svg = renderToStaticMarkup(React.createElement(Comp, { color: '#' + hex, size: 384 }));
  return 'image/png;base64,' + (await sharp(Buffer.from(svg)).png().toBuffer()).toString('base64');
}
async function badge(Ic, x, y, s, color, bg) {
  if (bg) slide.addShape(pres.shapes.OVAL, { x, y, w: s, h: s, fill: { color: bg }, line: { type: 'none' } });
  const p = bg ? s * 0.24 : 0;
  slide.addImage({ data: await icon(Ic, color), x: x + p, y: y + p, w: s - 2 * p, h: s - 2 * p });
}
function browser(file, x, y, w, h) {
  const p = path.join(IMG, file);
  const { width, height } = imageSize(p);
  const bar = 0.2;
  const ih = h || (w * height) / width;
  box(x, y, w, ih + bar, { fill: { color: 'FFFFFF' }, line: { color: HEX.accent6, width: 0.75 }, r: 0.07, shadow: shadow() });
  box(x + 0.01, y + 0.01, w - 0.02, bar - 0.01, { fill: { color: 'EEF1F6' }, r: 0.06 });
  ['F26D6D', 'F2C14E', '5CC27A'].forEach((c, i) => slide.addShape(pres.shapes.OVAL, { x: x + 0.09 + i * 0.13, y: y + 0.065, w: 0.075, h: 0.075, fill: { color: c }, line: { type: 'none' } }));
  slide.addImage({ path: p, x: x + 0.01, y: y + bar, w: w - 0.02, h: ih, sizing: h ? { type: 'cover', w: w - 0.02, h: ih } : undefined });
  return ih + bar;
}
const chevron = (x, y, s = 0.2, color = HEX.accent6) => slide.addShape(pres.shapes.CHEVRON, { x, y, w: s * 0.6, h: s, fill: { color }, line: { type: 'none' } });
const pill = (t, x, y, w, fill, color) => { box(x, y, w, 0.3, { fill: { color: fill }, r: 0.15 }); text(t, x, y, w, 0.3, { fontSize: 10.5, bold: true, color, align: 'center', valign: 'middle' }); };

(async () => {
  // ================================================================ 1. 표지
  add('DARK', '개요', 'AI-TestOps', '', 20,
    '안녕하세요, 팀 aQm 대표 장준호입니다. 저희는 웹사이트 품질 점검을 AI로 자동화하는 AI-TestOps를 사업화하려 합니다. 한성대학교 산학공동연구로 실제 서비스를 만들어 운영하고 있습니다.');
  text('BUSINESS PLAN 2026', 0.7, 0.8, 6, 0.3, { fontSize: 13, bold: true, color: '8FA6DB', charSpacing: 2 });
  text('AI-TestOps', 0.7, 1.2, 6.5, 1.0, { fontSize: 56, bold: true, color: WHITE });
  text('웹사이트 주소 하나로 점검을 만들고, 돌리고, 고치는\nAI 웹 품질 자동화 플랫폼', 0.7, 2.35, 6.3, 1.0, { fontSize: 19, bold: true, color: WHITE, lineSpacingMultiple: 1.25 });
  const tags = ['B2B · B2C', '설치형 + 클라우드', '산학공동연구'];
  tags.forEach((t, i) => pill(t, 0.7 + i * 1.75, 3.6, 1.6, '1F2F55', 'C7D3F2'));
  text([
    { text: '팀 aQm  ', options: { bold: true, color: WHITE } },
    { text: '장준호 · 김윤재 · 김상원', options: { color: 'D7DCE4', breakLine: true } },
    { text: '한성대학교 산학공동연구프로젝트  ·  지도교수 양옥수', options: { color: '8FA6DB' } },
  ], 0.7, 5.6, 6.5, 0.8, { fontSize: 13, lineSpacingMultiple: 1.4 });
  browser('hero2.jpg', 6.85, 1.35, 5.9, 0);

  // ================================================================ 2. 문제
  add('CONTENT', '문제와 고객', '웹 서비스는 매일 바뀌지만, 품질 점검은 아직 사람 손에 있습니다', '01  문제', 30,
    '웹 서비스는 하루에도 여러 번 바뀌지만 기업 넷 중 세 곳 이상은 여전히 사람이 직접 눌러 보며 점검합니다. 자동화를 하려면 코드를 짤 전문 인력이 필요하고, 화면이 바뀌면 그 코드도 깨집니다. 결국 작은 회사일수록 점검을 포기하고 고객 불만으로 문제를 알게 됩니다.');
  const stat = [['75%+', '수동 테스트에 의존하는 기업', 'CNCF'], ['매 배포', '반복되는 회귀 점검', '변경마다 전 화면 재확인'], ['0명', '작은 팀의 QA 전담 인력', '개발자가 점검까지 겸임']];
  stat.forEach(([b, t, d], i) => {
    const x = 0.6 + i * 4.1;
    box(x, 1.65, 3.85, 1.75, { fill: { color: HEX.lt2 }, r: 0.1 });
    text(b, x + 0.3, 1.85, 3.3, 0.7, { fontSize: 34, bold: true, color: i === 0 ? RED : NAVY });
    text(t, x + 0.3, 2.6, 3.3, 0.35, { fontSize: 14, bold: true });
    text(d, x + 0.3, 2.95, 3.3, 0.3, { fontSize: 11, color: GRAY });
  });
  const pains = [
    [lu.LuClock, '시간', '고칠 때마다 같은 화면을 사람이 반복해서 확인'],
    [lu.LuCode, '전문 인력', '자동화하려면 테스트 코드를 짤 개발자가 필요'],
    [lu.LuRefreshCw, '유지 비용', '디자인이 바뀌면 자동화 코드도 함께 깨짐'],
    [lu.LuLock, '보안', '금융·공공은 외부 클라우드 도구를 쓰기 어려움'],
  ];
  for (let i = 0; i < pains.length; i++) {
    const [Ic, t, d] = pains[i];
    const x = 0.6 + (i % 2) * 6.15, y = 3.75 + Math.floor(i / 2) * 1.2;
    box(x, y, 5.95, 1.0, { fill: { color: 'FFFFFF' }, line: { color: HEX.accent6, width: 0.75 }, r: 0.1 });
    await badge(Ic, x + 0.25, y + 0.22, 0.56, HEX.accent1, 'E9EEFB');
    text(t, x + 1.05, y + 0.17, 4.7, 0.32, { fontSize: 15, bold: true });
    text(d, x + 1.05, y + 0.52, 4.7, 0.3, { fontSize: 12, color: GRAY });
  }
  source('CNCF 통계(자체 「Autify vs Playops 기술 비교분석 보고서」, 2026.07 인용)');

  // ================================================================ 3. 고객 페르소나
  add('CONTENT', '문제와 고객', '이 문제를 가장 아프게 겪는 세 고객', '02  고객 페르소나', 35,
    '저희 고객은 세 부류입니다. 첫째, 외주로 쇼핑몰을 만드는 1인 개발자는 납품 뒤 오류 연락이 가장 두렵습니다. 둘째, 개발자 다섯 명의 스타트업 CTO는 점검 담당자 없이 매주 배포합니다. 셋째, 금융 SI의 QA 팀장은 보안 때문에 외부 클라우드 도구를 쓸 수 없습니다. 개인은 구독으로, 팀과 기업은 계약으로 만납니다.');
  const personas = [
    ['B2C', '김민수 (29)', '1인 개발자 · 프리랜서', lu.LuUser, ['쇼핑몰·랜딩 페이지 외주 개발', '납품 후 "버튼이 안 눌려요" 연락이 가장 두려움', '테스트 코드를 짤 시간이 없음'], '월 구독 · 바로 사용'],
    ['B2B', '이지은 (34)', '스타트업 CTO · 개발자 5명', lu.LuRocket, ['QA 담당자 없이 주 2~3회 배포', '배포 전 점검을 개발자가 손으로 반복', '자동화를 시작했다가 유지 못 하고 방치'], '팀 구독 · 클라우드'],
    ['B2B', '박성호 (45)', '금융 SI QA 팀장', lu.LuLandmark, ['폐쇄망 · 망분리 환경', '외부 SaaS는 보안 심사를 통과 못 함', '사람이 점검표로 수작업 검증'], '설치형 라이선스'],
  ];
  for (let i = 0; i < personas.length; i++) {
    const [seg, name, role, Ic, items, deal] = personas[i];
    const x = 0.6 + i * 4.1;
    box(x, 1.6, 3.85, 4.95, { fill: { color: 'FFFFFF' }, line: { color: HEX.accent6, width: 0.75 }, r: 0.12, shadow: shadow() });
    pill(seg, x + 0.3, 1.85, 0.8, seg === 'B2C' ? 'E3F4EC' : 'E9EEFB', seg === 'B2C' ? '1E9E6A' : '2F5BD3');
    await badge(Ic, x + 2.95, 1.8, 0.62, 'FFFFFF', i === 2 ? HEX.dk2 : HEX.accent1);
    text(name, x + 0.3, 2.45, 3.3, 0.45, { fontSize: 20, bold: true, color: NAVY });
    text(role, x + 0.3, 2.9, 3.3, 0.3, { fontSize: 12.5, bold: true, color: GRAY });
    text('겪는 문제', x + 0.3, 3.45, 3.3, 0.25, { fontSize: 10.5, bold: true, color: RED });
    text(items.map((s, j) => ({ text: s, options: { bullet: { indent: 12 }, breakLine: j < items.length - 1 } })), x + 0.3, 3.75, 3.3, 1.8, { fontSize: 12.5, lineSpacingMultiple: 1.35 });
    slide.addShape(pres.shapes.LINE, { x: x + 0.3, y: 5.7, w: 3.25, h: 0, line: { color: HEX.accent6, width: 0.75 } });
    text([{ text: '만나는 방식  ', options: { color: GRAY } }, { text: deal, options: { bold: true, color: BLUE } }], x + 0.3, 5.85, 3.3, 0.3, { fontSize: 12 });
  }
  source('가상 페르소나: 목표 고객군을 대표하도록 구성한 인물이며 실존 인물이 아님');

  // ================================================================ 4. 솔루션
  add('CONTENT', '솔루션', '주소만 넣으면, AI가 사이트를 살펴보고 점검까지 끝냅니다', '03  솔루션', 30,
    'AI-TestOps는 세 단계로 동작합니다. 사이트 주소나 GitHub 저장소를 등록하면, AI가 화면과 코드를 살펴 사이트 지도를 만들고, 그 지도에 실제로 있는 버튼으로만 점검표를 만들어 자동으로 실행합니다. 짐작하지 않고 먼저 보고 만들기 때문에 실행해도 깨지지 않습니다.');
  const sol = [[lu.LuLink, '등록', '사이트 주소 또는\nGitHub 저장소 연결', 'f-projects.jpg'], [lu.LuScanEye, '분석', 'AI가 화면·코드를 살펴\n사이트 지도 생성', 'g-graph.jpg'], [lu.LuBadgeCheck, '자동 점검', '지도의 실제 버튼으로\n점검하고 결과·영상 기록', 'g-results.jpg']];
  for (let i = 0; i < sol.length; i++) {
    const [Ic, t, d, img] = sol[i];
    const x = 0.6 + i * 4.1;
    browser(img, x, 1.6, 3.8, 2.15);
    await badge(Ic, x, 4.2, 0.58, 'FFFFFF', HEX.accent1);
    text(`STEP ${i + 1}`, x + 0.72, 4.18, 2, 0.25, { fontSize: 10.5, bold: true, color: BLUE });
    text(t, x + 0.72, 4.42, 3, 0.4, { fontSize: 19, bold: true, color: NAVY });
    text(d, x, 5.0, 3.8, 0.7, { fontSize: 13, color: GRAY, lineSpacingMultiple: 1.3 });
    if (i < 2) chevron(x + 3.88, 2.55, 0.3);
  }
  box(0.6, 5.95, 12.1, 0.6, { fill: { color: HEX.lt2 }, r: 0.08 });
  text('핵심 원리  짐작하지 않고 먼저 본다  ·  AI를 꺼도 녹화 · 실행 · 결과 기능은 그대로 동작', 0.6, 5.95, 12.1, 0.6, { fontSize: 14, bold: true, color: NAVY, align: 'center', valign: 'middle' });

  // ================================================================ 5. 핵심 기술 1: 코드베이스 분석 + 지식 그래프
  add('CONTENT', '솔루션', '사이트 전체를 한 장의 지도로, 막힌 곳은 이유와 해결책까지', '04  핵심 기술 ①  코드베이스 분석 + 지식 그래프', 35,
    '첫 번째 핵심 기술입니다. GitHub 저장소를 연결하면 AI가 코드를 읽어 화면과 버튼을 찾고, 실제 사이트 탐색 결과와 합쳐 지식 그래프, 즉 사이트 지도를 만듭니다. 화면 하나가 상자 하나, 색이 곧 상태라서 비전공자도 어디가 막혔는지 바로 봅니다. 이 지도가 경쟁 제품에 없는 저희만의 자산입니다.');
  browser('hero2.jpg', 0.6, 1.6, 7.5, 0);
  const kg = [[lu.LuGithub, '코드베이스 자동 분석', 'GitHub 코드에서 화면 · 버튼 · 입력칸을 수집'], [lu.LuNetwork, '지식 그래프 사이트 지도', '화면과 이동 경로를 하나의 그래프로 저장'], [lu.LuShieldCheck, 'AI 환각 차단', 'AI가 뽑은 이름이 실제 코드에 없으면 폐기'], [lu.LuCircleAlert, '막힌 곳 진단', '원인과 다음 행동(고치기 · 다시 녹화)을 제시']];
  for (let i = 0; i < kg.length; i++) {
    const [Ic, t, d] = kg[i];
    const y = 1.62 + i * 1.02;
    await badge(Ic, 8.5, y, 0.52, HEX.accent1, 'E9EEFB');
    text(t, 9.2, y - 0.02, 3.55, 0.35, { fontSize: 14.5, bold: true });
    text(d, 9.2, y + 0.36, 3.55, 0.5, { fontSize: 11.5, color: GRAY });
  }
  box(8.5, 5.75, 4.2, 0.8, { fill: { color: HEX.lt2 }, r: 0.08 });
  text([{ text: '경쟁 제품에 없는 것', options: { color: GRAY, breakLine: true } }, { text: '코드와 실제 화면을 합친 사이트 지도', options: { bold: true, color: NAVY } }], 8.7, 5.75, 3.9, 0.8, { fontSize: 12.5, valign: 'middle', lineSpacingMultiple: 1.25 });

  // ================================================================ 6. 핵심 기술 2: 만들기 · 결과
  add('CONTENT', '솔루션', '점검표는 말로 쓰거나 직접 눌러 만들고, 결과는 차수별로 비교합니다', '05  핵심 기술 ②  AI 작성 · 클릭 녹화 · 대시보드', 35,
    '두 번째는 사용성입니다. 확인할 내용을 말로 쓰면 AI가 지도에 있는 버튼만 써서 점검 코드를 만들고, 말로 쓰기 어려우면 브라우저에서 직접 눌러 녹화하면 됩니다. 결과는 1차, 2차처럼 차수별로 비교해 무엇이 새로 고장 났는지 한 문장으로 알려 주고, AI가 고친 내용은 사람이 승인해야 반영됩니다.');
  const three = [['g-aigen.jpg', lu.LuSparkles, 'AI 점검표 작성', '문장으로 쓰면 지도에 있는\n버튼만으로 코드 생성'], ['g-recorder.jpg', lu.LuMousePointerClick, '클릭 녹화', '누른 순서가 그대로 점검표\nAI 없이도 사용 가능'], ['g-rounds.jpg', lu.LuChartColumn, '차수별 대시보드', '1차 · 2차 비교로 새로 고장 난\n곳을 한 문장으로 안내']];
  for (let i = 0; i < three.length; i++) {
    const [img, Ic, t, d] = three[i];
    const x = 0.6 + i * 4.1;
    browser(img, x, 1.6, 3.8, 2.3);
    await badge(Ic, x, 4.35, 0.52, HEX.accent1, 'E9EEFB');
    text(t, x + 0.68, 4.4, 3.1, 0.4, { fontSize: 17, bold: true, color: NAVY });
    text(d, x, 5.0, 3.8, 0.7, { fontSize: 12.5, color: GRAY, lineSpacingMultiple: 1.3 });
  }
  box(0.6, 5.95, 12.1, 0.6, { fill: { color: 'E3F4EC' }, r: 0.08 });
  text('AI가 고친 코드는 사람이 바뀐 부분을 확인하고 승인해야 반영됩니다  ·  승인 없이 반영된 변경 0건', 0.6, 5.95, 12.1, 0.6, { fontSize: 14, bold: true, color: GREEN, align: 'center', valign: 'middle' });

  // ================================================================ 7. 기술 스택 · 구조
  add('CONTENT', '솔루션', '검증된 오픈소스 위에, 고객 서버에도 그대로 설치되는 구조', '06  기술 스택과 아키텍처', 30,
    '기술 구조입니다. 화면은 React, 서버는 Spring Boot, 브라우저 자동화는 마이크로소프트의 오픈소스 Playwright, AI 흐름 제어는 LangGraph를 씁니다. 모든 구성 요소가 Docker로 묶여 있어 고객사 서버에 통째로 설치할 수 있고, 이것이 금융·공공 시장에 들어갈 수 있는 기술적 근거입니다.');
  const node = async (x, y, w, h, Ic, t, d, dark, col) => {
    box(x, y, w, h, { fill: { color: dark ? HEX.dk2 : 'FFFFFF' }, line: { color: HEX.accent6, width: 0.75 }, r: 0.1, shadow: shadow() });
    await badge(Ic, x + 0.18, y + h / 2 - 0.21, 0.42, col);
    text(t, x + 0.72, y + 0.12, w - 0.8, 0.32, { fontSize: 13, bold: true, color: dark ? WHITE : INK });
    text(d, x + 0.72, y + 0.44, w - 0.8, h - 0.5, { fontSize: 10.5, color: dark ? 'D7DCE4' : GRAY });
  };
  box(0.6, 1.55, 7.6, 4.0, { fill: { color: HEX.lt2 }, r: 0.12 });
  text('고객 서버 또는 클라우드 (Docker Compose 한 번에 설치)', 0.85, 1.7, 7, 0.3, { fontSize: 11, bold: true, color: GRAY });
  await node(0.85, 2.3, 2.3, 0.95, lu.LuMonitor, '웹 화면', 'React · TypeScript', false, HEX.accent1);
  await node(3.55, 2.3, 2.3, 0.95, lu.LuServer, 'API 서버', 'Spring Boot', true, 'FFFFFF');
  await node(3.55, 4.15, 2.3, 0.95, lu.LuDatabase, '데이터 · 지도', 'PostgreSQL', false, HEX.accent1);
  await node(6.2, 2.0, 1.85, 0.95, lu.LuContainer, '격리 실행', 'Docker + Playwright', false, HEX.accent2);
  await node(6.2, 3.45, 1.85, 0.95, lu.LuBot, 'AI 흐름', 'LangGraph', false, HEX.accent4);
  const ln = (x1, y1, x2, y2) => slide.addShape(pres.shapes.LINE, { x: x1, y: Math.min(y1, y2), w: x2 - x1, h: Math.abs(y2 - y1), flipV: y2 < y1, line: { color: 'A3ADBD', width: 1.25, endArrowType: 'triangle' } });
  ln(3.15, 2.77, 3.55, 2.77); ln(4.7, 3.25, 4.7, 4.15); ln(5.85, 2.6, 6.2, 2.45); ln(5.85, 2.95, 6.2, 3.85);
  await node(8.6, 1.55, 4.1, 0.95, lu.LuSparkles, '외부 AI (선택)', 'Claude · GPT, API 키는 서버에만 보관', false, HEX.accent4);
  ln(8.05, 3.9, 8.6, 2.1);
  const stack = [['FE', 'React · TypeScript', si.SiReact, '149ECA'], ['BE', 'Spring Boot · Java 21', si.SiSpringboot, '6DB33F'], ['DB', 'PostgreSQL', si.SiPostgresql, '4169E1'], ['Test', 'Playwright', lu.LuMonitorPlay, '2EAD33'], ['AI', 'LangGraph · LLM', si.SiClaude, 'D97757'], ['Infra', 'Docker · Actions', si.SiDocker, '2496ED']];
  for (let i = 0; i < stack.length; i++) {
    const [k, v, Ic, c] = stack[i];
    const x = 8.6 + (i % 2) * 2.08, y = 2.75 + Math.floor(i / 2) * 0.62;
    box(x, y, 2.0, 0.52, { fill: { color: 'FFFFFF' }, line: { color: HEX.accent6, width: 0.75 }, r: 0.07 });
    await badge(Ic, x + 0.1, y + 0.12, 0.28, c);
    text(k, x + 0.47, y + 0.05, 1.5, 0.2, { fontSize: 8.5, bold: true, color: BLUE });
    text(v, x + 0.47, y + 0.23, 1.5, 0.25, { fontSize: 9.5, bold: true });
  }
  const safe = [['설치형 지원', '고객사 서버 안에서만 동작'], ['키 비노출', 'AI 키는 서버만 보관'], ['격리 실행', '점검마다 독립 컨테이너'], ['사람 승인', 'AI 변경은 승인 후 반영']];
  safe.forEach(([t, d], i) => {
    const x = 0.6 + i * 3.05;
    box(x, 5.8, 2.85, 0.75, { fill: { color: 'FFFFFF' }, line: { color: HEX.accent6, width: 0.75 }, r: 0.08 });
    text(t, x + 0.2, 5.86, 2.5, 0.3, { fontSize: 13, bold: true, color: GREEN });
    text(d, x + 0.2, 6.17, 2.5, 0.3, { fontSize: 11, color: GRAY });
  });

  // ================================================================ 8. 시장 규모
  add('CONTENT', '시장과 경쟁', '연 11.5%씩 커지는 테스트 시장, 우리는 국내 공백부터 공략합니다', '07  시장 규모', 30,
    '시장입니다. 전 세계 소프트웨어 테스트와 QA 서비스 시장은 올해 약 507억 달러이고, 2033년까지 연 11.5%씩 성장해 두 배가 넘을 전망입니다. 저희는 그중 설치형이 필요한 국내 금융·공공·중소 웹 서비스 조직, 약 300억 원 규모를 먼저 공략하고, 3년 차에 연 7.8억 원 매출을 목표로 합니다.');
  const circ = [[4.1, 'TAM', '506.7억 달러', '글로벌 SW 테스트·QA 서비스 (2026)', 'E9EEFB', BLUE], [2.75, 'SAM', '약 300억 원', '국내 설치형 수요 조직 (금융·공공·중소)', 'C9D6F5', BLUE], [1.45, 'SOM', '7.8억 원', '3년 차 목표 매출', HEX.accent1, WHITE]];
  const cx0 = 3.0, cy0 = 4.05;
  circ.forEach(([d, , , , fill]) => slide.addShape(pres.shapes.OVAL, { x: cx0 - d / 2, y: cy0 + 2.05 - d, w: d, h: d, fill: { color: fill }, line: { color: 'FFFFFF', width: 1.5 } }));
  text('TAM', cx0 - 0.5, 2.25, 1, 0.3, { fontSize: 12, bold: true, color: BLUE, align: 'center' });
  text('SAM', cx0 - 0.5, 3.45, 1, 0.3, { fontSize: 12, bold: true, color: BLUE, align: 'center' });
  text('SOM', cx0 - 0.5, 4.9, 1, 0.3, { fontSize: 12, bold: true, color: WHITE, align: 'center' });
  circ.forEach(([, k, v, d], i) => {
    const y = 1.75 + i * 1.45;
    text(k, 5.6, y, 1, 0.35, { fontSize: 13, bold: true, color: BLUE });
    text(v, 6.4, y - 0.08, 3.2, 0.55, { fontSize: 26, bold: true, color: NAVY });
    text(d, 6.4, y + 0.5, 3.4, 0.35, { fontSize: 12, color: GRAY });
  });
  box(9.95, 1.65, 2.75, 4.55, { fill: { color: HEX.lt2 }, r: 0.1 });
  text('성장 근거', 10.15, 1.85, 2.4, 0.3, { fontSize: 12, bold: true, color: BLUE });
  text([
    { text: 'CAGR 11.5%', options: { bold: true, fontSize: 22, color: NAVY, breakLine: true } },
    { text: '2026 → 2033 두 배 이상', options: { color: GRAY, breakLine: true } },
    { text: ' ', options: { breakLine: true } },
    { text: '자동화 전문 인력 부족', options: { bold: true, breakLine: true } },
    { text: '자동 생성 · 자가 치유 수요의 근거', options: { color: GRAY, breakLine: true } },
    { text: ' ', options: { breakLine: true } },
    { text: '폐쇄망 요건', options: { bold: true, breakLine: true } },
    { text: '글로벌 SaaS가 채우지 못하는 국내 공백', options: { color: GRAY } },
  ], 10.15, 2.25, 2.4, 3.8, { fontSize: 11.5, lineSpacingMultiple: 1.25 });
  source('TAM: Business Research Insights 「Software Testing and QA Services Market」(2026). SAM·SOM은 자체 가정 기반 추정치');

  // ================================================================ 9. 경쟁 비교
  add('CONTENT', '시장과 경쟁', '노코드의 편리함과 설치형의 보안을 함께 갖춘 유일한 선택지', '08  경쟁 분석과 차별성', 40,
    '경쟁 구도입니다. LG CNS가 총판인 Autify와 mabl은 코드 없이 쓰지만 클라우드 전용이라 금융·공공이 쓰기 어렵습니다. 직접 구축하면 코드 전문가가 필요하고, 토스 같은 대형 IT사는 전담 조직을 둡니다. AI-TestOps는 코드 없이 쓰면서 고객 서버에 설치되고, 사이트 지도로 점검을 만드는 유일한 제품입니다.');
  // 포지셔닝 맵
  const mx = 0.6, my = 1.6, mw = 5.0, mh = 4.7;
  box(mx, my, mw, mh, { fill: { color: HEX.lt2 }, r: 0.1 });
  slide.addShape(pres.shapes.LINE, { x: mx + 0.3, y: my + mh / 2, w: mw - 0.6, h: 0, line: { color: 'B8C0CC', width: 1 } });
  slide.addShape(pres.shapes.LINE, { x: mx + mw / 2, y: my + 0.3, w: 0, h: mh - 0.6, line: { color: 'B8C0CC', width: 1 } });
  text('설치형 가능', mx + mw / 2 + 0.08, my + 0.15, 2, 0.25, { fontSize: 10, bold: true, color: GRAY });
  text('클라우드 전용', mx + mw / 2 + 0.08, my + mh - 0.4, 2, 0.25, { fontSize: 10, bold: true, color: GRAY });
  text('코드 필요', mx + 0.15, my + mh / 2 + 0.05, 1.5, 0.25, { fontSize: 10, bold: true, color: GRAY });
  text('코드 불필요', mx + mw - 1.2, my + mh / 2 + 0.05, 1.1, 0.25, { fontSize: 10, bold: true, color: GRAY, align: 'right' });
  const dot = (x, y, label, main) => {
    slide.addShape(pres.shapes.OVAL, { x: x - (main ? 0.2 : 0.12), y: y - (main ? 0.2 : 0.12), w: main ? 0.4 : 0.24, h: main ? 0.4 : 0.24, fill: { color: main ? HEX.accent1 : '8A94A6' }, line: { color: 'FFFFFF', width: 1.5 } });
    text(label, x - 1.2, y + (main ? 0.25 : 0.17), 2.4, main ? 0.32 : 0.45, { fontSize: main ? 13 : 10, bold: true, color: main ? BLUE : INK, align: 'center' });
  };
  dot(mx + 3.95, my + 0.95, 'AI-TestOps', true);
  dot(mx + 3.7, my + 3.5, 'Autify (LG CNS 총판)', false);
  dot(mx + 4.25, my + 4.05, 'mabl', false);
  dot(mx + 1.2, my + 0.75, 'Playwright 직접 구축', false);
  dot(mx + 1.45, my + 1.65, '자체 QA 조직\n(토스 등 대형 IT사)', false);
  // 비교표
  const cols = ['Autify\n(LG CNS)', 'mabl', '직접 구축', 'AI-TestOps'];
  const rows = [['코드 없이 사용', [1, 1, 0, 1]], ['고객 서버 설치 (폐쇄망)', [0, 0, 1, 1]], ['코드 + 화면 분석 사이트 지도', [0, 0, 0, 1]], ['AI 변경 사람 승인', [2, 2, 0, 1]], ['중소기업 부담 가능한 비용', [0, 0, 2, 1]]];
  const tx = 5.95, lw = 2.55, cw = 1.05, ty = 1.6, rh = 0.72;
  box(tx + lw + 3 * cw, ty - 0.05, cw, rh * (rows.length + 1) + 0.1, { fill: { color: 'E9EEFB' }, r: 0.1 });
  cols.forEach((c, i) => text(c, tx + lw + i * cw, ty, cw, rh, { fontSize: 10.5, bold: true, align: 'center', valign: 'middle', color: i === 3 ? BLUE : INK }));
  for (let r = 0; r < rows.length; r++) {
    const [label, marks] = rows[r];
    const y = ty + (r + 1) * rh;
    slide.addShape(pres.shapes.LINE, { x: tx, y, w: lw + 4 * cw, h: 0, line: { color: HEX.accent6, width: 0.75 } });
    text(label, tx + 0.05, y, lw - 0.05, rh, { fontSize: 11.5, bold: true, valign: 'middle' });
    for (let i = 0; i < 4; i++) {
      const m = marks[i];
      const Ic = m === 1 ? lu.LuCircleCheck : m === 2 ? lu.LuCircleDashed : lu.LuCircleMinus;
      const col = m === 1 ? (i === 3 ? HEX.accent1 : HEX.accent2) : m === 2 ? 'E3A220' : 'BAC2CE';
      await badge(Ic, tx + lw + i * cw + cw / 2 - 0.17, y + rh / 2 - 0.17, 0.34, col);
    }
  }
  text('● 제공   ◌ 일부·조건부   — 미제공', tx, ty + (rows.length + 1) * rh + 0.12, 6.5, 0.25, { fontSize: 9.5, color: GRAY });
  source('자체 「AI 기반 UI 테스트 자동화 플랫폼 기술 비교분석 보고서 — Autify vs Playops」(2026.07), 각 사 공개 자료');

  // ================================================================ 10. 비즈니스 모델
  add('CONTENT', '사업 모델', '개인은 구독으로, 팀과 기업은 계약으로. B2C와 B2B를 함께', '09  비즈니스 모델', 40,
    '수익 모델입니다. 개인은 무료로 시작해 월 1만 9천 원 Pro로, 스타트업은 월 49만 원 Team으로, 금융·공공은 연 2천만 원부터의 설치형 Enterprise로 만납니다. 개인 사용자가 회사에 도입을 제안하는 흐름이 그대로 B2B 영업이 됩니다.');
  const tiers = [
    ['B2C', 'Free', '0원', '개인 · 학생', ['프로젝트 1개', '클릭 녹화 · 실행', 'AI 점검 월 10회'], false],
    ['B2C', 'Pro', '월 1.9만원', '1인 개발자 · 프리랜서', ['프로젝트 5개', 'AI 점검표 · 사이트 지도', '예약 실행 · 알림'], false],
    ['B2B', 'Team', '월 49만원', '스타트업 · 중소 개발팀', ['팀원 무제한 · 병렬 실행', '차수별 대시보드', '승인 흐름 · CI 연동'], true],
    ['B2B', 'Enterprise', '연 2,000만원~', '금융 · 공공 · 대기업', ['고객 서버 설치(폐쇄망)', 'SSO · 감사 로그', '구축 · 기술 지원 SLA'], false],
  ];
  tiers.forEach(([seg, name, price, who, feats, hot], i) => {
    const x = 0.6 + i * 3.05;
    box(x, 1.6, 2.85, 4.1, { fill: { color: hot ? HEX.dk2 : 'FFFFFF' }, line: { color: hot ? HEX.dk2 : HEX.accent6, width: 0.75 }, r: 0.12, shadow: shadow() });
    pill(seg, x + 0.25, 1.8, 0.7, seg === 'B2C' ? 'E3F4EC' : 'E9EEFB', seg === 'B2C' ? '1E9E6A' : '2F5BD3');
    if (hot) pill('주력', x + 1.95, 1.8, 0.65, HEX.accent4, 'FFFFFF');
    text(name, x + 0.25, 2.25, 2.4, 0.45, { fontSize: 21, bold: true, color: hot ? WHITE : NAVY });
    text(price, x + 0.25, 2.75, 2.5, 0.45, { fontSize: 19, bold: true, color: hot ? '9DB4F0' : BLUE });
    text(who, x + 0.25, 3.25, 2.4, 0.3, { fontSize: 11.5, color: hot ? 'C7D3F2' : GRAY });
    slide.addShape(pres.shapes.LINE, { x: x + 0.25, y: 3.7, w: 2.35, h: 0, line: { color: hot ? '33456E' : HEX.accent6, width: 0.75 } });
    text(feats.map((s, j) => ({ text: s, options: { bullet: { indent: 12 }, breakLine: j < feats.length - 1 } })), x + 0.25, 3.85, 2.45, 1.6,
      { fontSize: 11.5, color: hot ? 'E6EBF5' : INK, lineSpacingMultiple: 1.4 });
  });
  box(0.6, 5.9, 12.1, 0.68, { fill: { color: HEX.lt2 }, r: 0.08 });
  const flow = ['개인이 무료로 사용', 'Pro로 전환', '회사에 도입 제안 → Team', '보안 요건 → Enterprise'];
  flow.forEach((t, i) => {
    text(t, 0.8 + i * 3.0, 5.9, 2.7, 0.68, { fontSize: 12.5, bold: true, color: NAVY, align: 'center', valign: 'middle' });
    if (i < 3) chevron(0.8 + i * 3.0 + 2.82, 6.12, 0.24, '9AA3B2');
  });
  source('요금은 안(案)이며 PoC 결과에 따라 조정. Team · Enterprise 단가는 팀 사업계획서(2026.08) 가정 기준');

  // ================================================================ 11. 고객 확보 전략 + 매출 목표
  add('CONTENT', '사업 모델', '무료로 퍼뜨리고, 산학 협력사 실증으로 기업 고객을 엽니다', '10  고객 확보 전략과 매출 목표', 35,
    '고객 확보는 GitHub 공개와 무료 요금제로 개발자를 먼저 모으고, 산학 협력사인 디지털IST, 디지털EnS와의 실증을 첫 기업 레퍼런스로 삼습니다. 3년 차에 Enterprise 10곳, Team 60곳, 개인 Pro 1천 명으로 연 매출 7.8억 원이 목표입니다.');
  const gtm = [[lu.LuGithub, '오픈 · 무료', 'GitHub 공개, 무료 요금제로 개발자 유입'], [lu.LuGraduationCap, '교육 · 커뮤니티', '대학 수업 · 개발자 커뮤니티 사례 공유'], [lu.LuHandshake, '산학 실증', '디지털IST · 디지털EnS 현장 실증 → 레퍼런스'], [lu.LuBuilding2, '기업 영업', '레퍼런스 기반 금융 · 공공 설치형 제안']];
  for (let i = 0; i < gtm.length; i++) {
    const [Ic, t, d] = gtm[i];
    const y = 1.6 + i * 1.18;
    box(0.6, y, 5.3, 1.0, { fill: { color: i === 2 ? 'E9EEFB' : HEX.lt2 }, r: 0.1 });
    await badge(Ic, 0.85, y + 0.22, 0.56, HEX.accent1, 'FFFFFF');
    text(t, 1.65, y + 0.17, 4.1, 0.32, { fontSize: 14.5, bold: true });
    text(d, 1.65, y + 0.52, 4.1, 0.32, { fontSize: 11.5, color: GRAY });
  }
  const years = ['1년 차', '2년 차', '3년 차'];
  slide.addChart(pres.charts.BAR, [
    { name: 'Enterprise', labels: years, values: [2000, 8000, 20000] },
    { name: 'Team', labels: years, values: [2940, 14700, 35280] },
    { name: '개인 Pro', labels: years, values: [2280, 9120, 22800] },
  ], {
    x: 6.3, y: 1.55, w: 6.4, h: 4.3, barDir: 'col', barGrouping: 'stacked', chartColors: [HEX.dk2, HEX.accent1, HEX.accent2],
    showLegend: true, legendPos: 'b', legendFontSize: 10, legendFontFace: '+mn-lt', legendColor: HEX.accent5,
    showTitle: true, title: '매출 목표 (단위: 만원)', titleFontSize: 12, titleFontFace: '+mn-lt', titleColor: HEX.dk1,
    catAxisLabelColor: HEX.accent5, valAxisLabelColor: HEX.accent5, catAxisLabelFontSize: 11, valAxisLabelFontSize: 9,
    catAxisLabelFontFace: '+mn-lt', valAxisLabelFontFace: '+mn-lt', valGridLine: { color: 'E5E8EE', size: 0.5 }, catGridLine: { style: 'none' },
    showValue: true, dataLabelPosition: 'ctr', dataLabelFontSize: 9, dataLabelColor: 'FFFFFF', dataLabelFontFace: '+mn-lt', valAxisLabelFormatCode: '#,##0',
  });
  text([{ text: '합계  ', options: { color: GRAY } }, { text: '7,220만원  →  3.2억원  →  7.8억원', options: { bold: true, color: NAVY } }], 6.3, 5.95, 6.4, 0.35, { fontSize: 13.5, align: 'center' });
  source('자체 가정: 1년 차 Enterprise 1 · Team 5 · Pro 100 / 2년 차 4 · 25 · 400 / 3년 차 10 · 60 · 1,000 (요금은 안 기준)');

  // ================================================================ 12. 성과 (Traction)
  add('CONTENT', '성과와 팀', '아이디어가 아니라, 이미 실서버에서 돌아가는 제품입니다', '11  지금까지의 성과', 30,
    '지금까지의 성과입니다. AI-TestOps는 실제 서버에 배포되어 돌아가고 있습니다. 시험 사이트의 화면을 AI가 모두 찾아냈고, 저희 서비스 자체도 배포마다 508개의 자동 점검을 통과해야 올라갑니다. 승인 없이 반영된 AI 변경은 0건이며, 이 기술로 특허 발명신고를 마쳤습니다.');
  const tr = [['9 / 9', '시험 사이트 화면\nAI 자동 발견', HEX.accent1], ['508개', '배포마다 통과하는\n자체 자동 점검', HEX.accent1], ['0건', '사람 승인 없이\n반영된 AI 변경', HEX.accent2], ['특허', '발명신고 완료\n(산학 공동)', HEX.accent4]];
  tr.forEach(([b, d, c], i) => {
    const x = 0.6 + i * 3.05;
    box(x, 1.65, 2.85, 2.45, { fill: { color: HEX.lt2 }, r: 0.12 });
    text(b, x, 1.95, 2.85, 0.9, { fontSize: 40, bold: true, color: c, align: 'center' });
    text(d, x + 0.2, 2.95, 2.45, 0.9, { fontSize: 13.5, align: 'center', lineSpacingMultiple: 1.3 });
  });
  const ms = [['2026.08', '착수 · 요구사항 정의'], ['2026.10', '코드 · 사이트 분석, 사이트 지도'], ['2026.11', '실서버 운영 · 특허 발명신고'], ['2026.12', '산학 성과공유회 · 최종 시연']];
  slide.addShape(pres.shapes.LINE, { x: 0.8, y: 4.75, w: 11.7, h: 0, line: { color: HEX.accent6, width: 2 } });
  ms.forEach(([d, t], i) => {
    const x = 0.6 + i * 3.05;
    slide.addShape(pres.shapes.OVAL, { x: x + 0.12, y: 4.64, w: 0.22, h: 0.22, fill: { color: i < 3 ? HEX.accent1 : 'FFFFFF' }, line: { color: HEX.accent1, width: 1.5 } });
    text(d, x, 5.0, 2.9, 0.3, { fontSize: 13, bold: true, color: NAVY });
    text(t, x, 5.32, 2.9, 0.3, { fontSize: 11.5, color: GRAY });
  });
  slide.addImage({ path: path.join(IMG, 'qr-github.png'), x: 11.75, y: 5.8, w: 0.95, h: 0.95 });
  text('GitHub 공개 저장소', 9.6, 6.05, 2.05, 0.25, { fontSize: 10.5, bold: true, align: 'right' });
  text('github.com/digitalist-corp/AI-TestOps', 8.6, 6.32, 3.05, 0.25, { fontSize: 9, color: GRAY, align: 'right' });

  // ================================================================ 13. 팀과 파트너
  add('CONTENT', '성과와 팀', '개발 실행력과 산학 네트워크를 함께 갖춘 팀', '12  팀과 협력 네트워크', 30,
    '팀입니다. 대표인 저는 기획과 화면, AI 기능 개발을, 김윤재는 서버와 실행 환경 개발을, 김상원은 문서와 회계, 사업 관리를 맡습니다. 한성대학교 양옥수 교수님 지도 아래 산학공동연구로 진행하며, 디지털IST 부장님의 현업 멘토링과 디지털EnS와의 협력으로 실제 현장 요구를 제품에 반영하고 있습니다.');
  const team = [['장준호', 'CEO · 개발', ['서비스 기획 · PM', '화면 · AI 기능 개발', '사이트 지도 · 대시보드']], ['김윤재', 'CTO · 개발', ['서버 · 실행 환경 개발', '격리 실행 · 배포 자동화', '보안 · 인프라']], ['김상원', 'CFO · 경영지원', ['사업 문서 작성', '회계 · 자금 관리', '대외 협력 지원']]];
  for (let i = 0; i < team.length; i++) {
    const [n, r, items] = team[i];
    const x = 0.6 + i * 2.6;
    box(x, 1.6, 2.4, 3.85, { fill: { color: 'FFFFFF' }, line: { color: HEX.accent6, width: 0.75 }, r: 0.12, shadow: shadow() });
    await badge(lu.LuUser, x + 0.8, 1.9, 0.8, 'FFFFFF', i === 2 ? HEX.accent5 : HEX.accent1);
    text(n, x, 2.85, 2.4, 0.42, { fontSize: 19, bold: true, align: 'center' });
    text(r, x, 3.3, 2.4, 0.3, { fontSize: 12, bold: true, color: BLUE, align: 'center' });
    slide.addShape(pres.shapes.LINE, { x: x + 0.3, y: 3.8, w: 1.8, h: 0, line: { color: HEX.accent6, width: 0.75 } });
    text(items.join('\n'), x + 0.15, 3.95, 2.1, 1.5, { fontSize: 12, color: GRAY, align: 'center', lineSpacingMultiple: 1.5 });
  }
  box(0.6, 5.7, 7.6, 0.85, { fill: { color: HEX.lt2 }, r: 0.08 });
  text([{ text: '개발 2인 + 경영지원 1인  ', options: { bold: true, color: NAVY } }, { text: '외주 없이 기획부터 개발 · 배포까지 직접 수행', options: { color: GRAY } }], 0.8, 5.7, 7.3, 0.85, { fontSize: 13.5, valign: 'middle' });
  text('협력 네트워크', 8.6, 1.6, 4, 0.3, { fontSize: 13, bold: true, color: BLUE });
  const partners = [[lu.LuGraduationCap, '한성대학교', '산학공동연구프로젝트\n지도교수 양옥수'], [lu.LuBuilding2, '디지털IST', '박OO 부장\n현업 실무 멘토링'], [lu.LuHandshake, '디지털EnS', '협력 기업\n현장 실증 협력']];
  for (let i = 0; i < partners.length; i++) {
    const [Ic, t, d] = partners[i];
    const y = 2.0 + i * 1.5;
    box(8.6, y, 4.1, 1.3, { fill: { color: HEX.lt2 }, r: 0.1 });
    await badge(Ic, 8.85, y + 0.33, 0.62, HEX.dk2, 'FFFFFF');
    text(t, 9.7, y + 0.2, 2.9, 0.35, { fontSize: 15, bold: true });
    text(d, 9.7, y + 0.58, 2.9, 0.6, { fontSize: 11.5, color: GRAY, lineSpacingMultiple: 1.25 });
  }

  // ================================================================ 14. 로드맵 · 마무리
  add('DARK', '마무리', '로드맵과 제안', '', 30,
    '마지막으로 계획입니다. 올해 AI 자동 수정 기능을 완성하고, 내년 상반기 협력사 실증과 법인 설립, 하반기 정식 출시와 특허 출원을 진행합니다. 저희에게 필요한 것은 실증에 함께할 첫 고객과 초기 자금입니다. 점검 담당자가 없어도, 사이트 주소 하나로. AI-TestOps였습니다. 감사합니다.');
  text('ROADMAP', 0.7, 0.6, 4, 0.3, { fontSize: 12, bold: true, color: '8FA6DB', charSpacing: 2 });
  const road = [['2026 Q4', 'AI 자동 수정 루프 완성', '산학 성과공유 · 최종 시연'], ['2027 상반기', '협력사 실증 (PoC)', '법인 설립 · 예비창업패키지'], ['2027 하반기', '정식 출시 · 특허 출원', 'Team · Enterprise 판매 개시'], ['2028', '설치형 확대', '금융 · 공공 레퍼런스 확보']];
  slide.addShape(pres.shapes.LINE, { x: 0.9, y: 1.32, w: 11.5, h: 0, line: { color: '33456E', width: 2 } });
  road.forEach(([d, t, s], i) => {
    const x = 0.7 + i * 3.05;
    slide.addShape(pres.shapes.OVAL, { x: x + 0.1, y: 1.2, w: 0.24, h: 0.24, fill: { color: i === 0 ? HEX.accent4 : 'FFFFFF' }, line: { type: 'none' } });
    text(d, x, 1.6, 2.9, 0.35, { fontSize: 15, bold: true, color: WHITE });
    text(t, x, 1.98, 2.9, 0.3, { fontSize: 12.5, bold: true, color: 'C7D3F2' });
    text(s, x, 2.3, 2.9, 0.3, { fontSize: 11, color: '8FA6DB' });
  });
  box(0.7, 3.3, 7.6, 1.6, { fill: { color: '1A2A4D' }, r: 0.12 });
  text('함께 해 주세요', 1.0, 3.48, 7, 0.3, { fontSize: 12, bold: true, color: '8FA6DB' });
  text([{ text: '실증 고객  ', options: { bold: true, color: WHITE } }, { text: '웹 서비스를 운영하는 기업 · 기관의 PoC 참여', options: { color: 'D7DCE4', breakLine: true } },
    { text: '초기 자금  ', options: { bold: true, color: WHITE } }, { text: '예비창업패키지 등 정부 지원과 시드 투자', options: { color: 'D7DCE4' } }], 1.0, 3.85, 7.1, 0.9, { fontSize: 13.5, lineSpacingMultiple: 1.5 });
  text('점검 담당자가 없어도, 사이트 주소 하나로.', 0.7, 5.35, 9, 0.6, { fontSize: 26, bold: true, color: WHITE });
  text('팀 aQm  ·  장준호 · 김윤재 · 김상원  ·  감사합니다', 0.7, 6.05, 9, 0.35, { fontSize: 13, color: 'AFC0E6' });
  box(10.45, 3.3, 1.95, 1.95, { fill: { color: 'FFFFFF' }, r: 0.08 });
  slide.addImage({ path: path.join(IMG, 'qr.png'), x: 10.52, y: 3.37, w: 1.81, h: 1.81 });
  text('직접 써 보기', 10.2, 5.38, 2.45, 0.32, { fontSize: 13, bold: true, color: WHITE, align: 'center' });

  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  fs.writeFileSync(SCRIPT_OUT, JSON.stringify(script, null, 2));
  const chars = script.reduce((s, x) => s + x.notes.length, 0);
  console.log('슬라이드', script.length, '장, 목표', script.reduce((s, x) => s + x.seconds, 0), '초, 대사', chars, '자 ≈', (chars / 330).toFixed(1), '분');
})().catch((e) => { console.error(e); process.exit(1); });
