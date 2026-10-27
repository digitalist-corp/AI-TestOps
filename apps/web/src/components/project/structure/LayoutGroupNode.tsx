import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { LayoutTemplate } from 'lucide-react';
import type { SiteMapLayout } from '@/types';

export interface LayoutGroupData extends Record<string, unknown> {
  layout: SiteMapLayout;
  width: number;
  height: number;
  hot: boolean;
  dimmed: boolean;
}

export type LayoutGroupFlowNode = Node<LayoutGroupData, 'layoutGroup'>;

/** 공용 메뉴를 공유하는 화면들을 감싸는 영역. 화면 배치가 끝난 뒤 그 좌표로 감싸 뒤에 깐다. */
function LayoutGroupNodeView({ data }: NodeProps<LayoutGroupFlowNode>) {
  const { layout } = data;
  const file = layout.sourceFile.split('/').pop();
  const pad2 = (n: number) => String(n).padStart(2, '0');
  return (
    <div className="sg-group" style={{ width: data.width, height: data.height }} data-hot={data.hot} data-dimmed={data.dimmed}>
      <Handle type="source" position={Position.Right} isConnectable={false} className="!h-2 !w-2 !min-w-0 !border-0 !bg-transparent" />
      <div
        className="sg-mono absolute left-0 top-0 flex max-w-full items-center gap-2 border-b border-r border-[var(--c-blue)]/30 bg-[var(--c-blue)]/10 px-2 py-1 text-[10px] tracking-wider text-[var(--c-blue)]"
        title={`공용 메뉴 · ${layout.sourceFile}`}
      >
        <LayoutTemplate className="h-3 w-3 shrink-0" />
        <span className="shrink-0 font-bold">LAYOUT</span>
        <span className="truncate text-[var(--c-text)]">{file}</span>
        <span className="shrink-0 text-[var(--c-muted)]">
          {pad2(layout.routeKeys.length)} NODES · {pad2(layout.links.length)} LINKS
        </span>
      </div>
    </div>
  );
}

export const LayoutGroupNode = memo(LayoutGroupNodeView);
