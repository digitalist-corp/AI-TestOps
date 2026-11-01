import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCoverageMock } from '@/lib/coverageMock';
import { issueItems, resolveCoverage } from '@/lib/coverage';
import { CoverageSummaryCard } from './CoverageSummaryCard';
import { FlowPanel } from './FlowPanel';
import { IssueList } from './IssueList';

afterEach(cleanup);

/** 개발용 가짜 확인 지도(화면 6 · 흐름 3 · 막힘 2)로 패널들을 그려 본다. */
async function mockData() {
  const source = createCoverageMock();
  const siteMap = await source.getSiteMap('p1');
  const coverage = resolveCoverage(siteMap, await source.getCoverage('p1'));
  const nodeByRoute = new Map(siteMap.nodes.map((n) => [n.routeKey, n]));
  return { siteMap, coverage, nodeByRoute, issues: issueItems(coverage, nodeByRoute) };
}

describe('확인 지도 패널', () => {
  it('요약 카드: 쉬운 문장 · 실행 중 띠 · 막힌 곳 보기', async () => {
    const { coverage } = await mockData();
    const onShowBlocked = vi.fn();
    render(<CoverageSummaryCard summary={coverage.summary} live="테스트 실행 중… 결과가 지도에 바로 반영됩니다" onShowBlocked={onShowBlocked} />);
    expect(screen.getByText(/화면 6개 중 2개를 테스트로 확인했어요/)).toBeTruthy();
    expect(screen.getByText('2곳에서 막혔어요.')).toBeTruthy();
    expect(screen.getByTestId('structure-live-band').textContent).toContain('결과가 지도에 바로 반영됩니다');
    expect(screen.queryByText(/미확인/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /막힌 곳 보기/ }));
    expect(onShowBlocked).toHaveBeenCalled();
  });

  it('막힌 곳: 로그인 막힘이 먼저, AI 가 꺼지면 AI 로 고치기 대신 다시 녹화하기', async () => {
    const { issues } = await mockData();
    const onAction = vi.fn();
    const { rerender } = render(<IssueList items={issues} aiActive onAction={onAction} busyKey={null} />);
    const cards = screen.getAllByTestId('structure-issue-card');
    expect(cards.map((c) => c.getAttribute('data-route'))).toEqual(['/account', '/checkout']);
    expect(screen.getByRole('button', { name: /AI로 고치기/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /로그인 정보 넣기/ }));
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ routeKey: '/account' }), 'SET_LOGIN');

    rerender(<IssueList items={issues} aiActive={false} onAction={onAction} busyKey={null} />);
    expect(screen.queryByRole('button', { name: /AI로 고치기/ })).toBeNull();
    expect(screen.getByRole('button', { name: /다시 녹화하기/ })).toBeTruthy();
  });

  it('테스트 흐름: 단계 칩 줄을 보여 주고 누르면 재생한다', async () => {
    const { coverage, nodeByRoute, issues } = await mockData();
    const onPlay = vi.fn();
    render(
      <FlowPanel
        open
        onOpen={() => {}}
        tab="flows"
        onTab={() => {}}
        flows={coverage.flows}
        issues={issues}
        nodeByRoute={nodeByRoute}
        playingSpec={null}
        onPlay={onPlay}
        aiActive
        onAction={() => {}}
        busyKey={null}
        onSelectScreen={() => {}}
      />
    );
    const cards = screen.getAllByTestId('structure-flow-card');
    expect(cards).toHaveLength(3);
    // 로그인 ✓ → 상품 목록 ✓ → 장바구니 ✓ → 결제 ✗ → 주문 완료 ○
    expect(cards[1].textContent).toMatch(/로그인✓.*상품 목록✓.*장바구니✓.*결제✗.*주문 완료○/);
    fireEvent.click(cards[1]);
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ specPath: 'tests/checkout.spec.ts' }));
  });
});
