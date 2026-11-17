import type { ScenarioCaseNode, ScenarioTree } from '@/types';

/** 전체 실행에 실제로 들어갈 케이스 수. 꺼 둔 파일 · 묶음 · 케이스는 서버도 건너뛰므로 뺀다. */
export function enabledCaseCount(tree: ScenarioTree): number {
  const count = (nodes: ScenarioCaseNode[]): number => nodes.reduce((sum, node) => {
    if (!node.enabled) return sum;
    return sum + (node.type === 'TEST' ? 1 : count(node.children));
  }, 0);
  return tree.specs.reduce((sum, spec) => sum + (spec.enabled ? count(spec.cases) : 0), 0);
}

/** 실수로 전체 실행하지 않도록 한 번 묻는다. 항목 수를 못 읽으면 이름만으로 묻는다. */
export async function confirmFullRun(projectName: string, loadTree: () => Promise<ScenarioTree>): Promise<boolean> {
  const count = await loadTree().then(enabledCaseCount, () => null);
  const lines = [`'${projectName}' 프로젝트를 실행할까요?`];
  if (count != null) lines.push(`실행할 항목 ${count}건`);
  return window.confirm(lines.join('\n'));
}
