import { useEffect, useRef } from 'react';
import type { ECharts, EChartsOption } from 'echarts';
import { useTheme } from '@/lib/theme';

/** 차트 하나. echarts 는 처음 그릴 때 불러온다. onClick 은 막대·노드를 누를 때 그 항목의 data 를 준다. */
export function ChartBox({
  option,
  height = 260,
  onClick,
  label,
}: {
  option: EChartsOption;
  height?: number;
  onClick?: (data: unknown) => void;
  /** 화면 읽기 프로그램용 설명 */
  label: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const clickRef = useRef(onClick);
  useEffect(() => {
    clickRef.current = onClick;
  });

  useEffect(() => {
    if (!ref.current) return;
    let chart: ECharts | null = null;
    let disposed = false;

    import('echarts').then((echarts) => {
      if (!ref.current || disposed) return;
      chart = echarts.init(ref.current);
      chart.setOption(option);
      chart.on('click', (params) => clickRef.current?.(params.data));
    });

    const resize = () => chart?.resize();
    window.addEventListener('resize', resize);
    return () => {
      disposed = true;
      window.removeEventListener('resize', resize);
      chart?.dispose();
    };
  }, [option]);

  return <div ref={ref} role="img" aria-label={label} style={{ height }} className="w-full" />;
}

/** 라이트 · 콘솔(dark) 테마에 맞춘 차트 글자색 */
export function useChartTheme() {
  const { theme } = useTheme();
  const dark = theme === 'dark';
  return {
    dark,
    text: dark ? '#8395a9' : '#475569',
    strong: dark ? '#d6e2ee' : '#0f172a',
    grid: dark ? '#1c2734' : '#e2e8f0',
    tooltip: dark ? { backgroundColor: '#10171f', borderColor: '#2a3a4c', textStyle: { color: '#d6e2ee' } } : {},
  };
}
