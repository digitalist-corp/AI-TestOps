import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { LayoutTemplate } from 'lucide-react';
import type { SiteMapLayout } from '@/types';
import { cn } from '@/lib/utils';

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
  return (
    <div
      className={cn(
        'relative rounded-lg border border-dashed transition-[border-color,background-color,opacity]',
        data.hot ? 'border-info/70 bg-info/10' : 'border-info/40 bg-info/5',
        data.dimmed && 'opacity-30'
      )}
      style={{ width: data.width, height: data.height }}
      data-hot={data.hot}
      data-dimmed={data.dimmed}
    >
      <Handle type="source" position={Position.Right} isConnectable={false} className="!h-2 !w-2 !min-w-0 !border-0 !bg-transparent" />
      <div
        className="absolute left-0 top-0 flex max-w-full items-center gap-2 rounded-br-lg rounded-tl-lg border-b border-r border-info/30 bg-info/10 px-2.5 py-1 text-xs"
        title={`공용 메뉴 · ${layout.sourceFile}`}
      >
        <LayoutTemplate className="h-3.5 w-3.5 shrink-0 text-info" />
        <span className="shrink-0 font-semibold text-info">공용 메뉴</span>
        <span className="truncate font-mono text-foreground">{file}</span>
        <span className="shrink-0 text-muted-foreground">
          화면 {layout.routeKeys.length}개 · 링크 {layout.links.length}개
        </span>
      </div>
    </div>
  );
}

export const LayoutGroupNode = memo(LayoutGroupNodeView);
