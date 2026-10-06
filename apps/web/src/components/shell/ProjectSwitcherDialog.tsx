import { useEffect, useMemo, useState } from 'react';
import { FolderKanban, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { api } from '@/api/client';
import { cn } from '@/lib/utils';
import type { Project } from '@/types';
import { PROJECT_WORKSPACE_TABS, type ProjectTabId } from '@/config/projectWorkspace';

const serverTypeLabel: Record<Project['serverType'], string> = {
  DEV: '개발',
  TEST: '테스트',
  PROD: '운영',
};

function matchesProject(project: Project, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    project.projectId,
    project.projectName,
    project.managerName ?? '',
    project.baseUrl ?? '',
  ].some((value) => value.toLowerCase().includes(q));
}

/** 상단바의 프로젝트 칩(또는 Ctrl+K)에서 여는 프로젝트 전환 창. */
export function ProjectSwitcherDialog({
  open,
  onOpenChange,
  activeProjectId,
  currentTab,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeProjectId?: string;
  currentTab: ProjectTabId;
  onSelect: (projectId: string) => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.getProjects()
      .then(setProjects)
      .catch(() => setProjects([]))
      .finally(() => setLoading(false));
  }, [open]);

  const filteredProjects = useMemo(
    () => projects.filter((project) => matchesProject(project, query)),
    [projects, query]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0">
        <DialogHeader className="border-b border-border px-5 py-4 mb-0">
          <DialogTitle>프로젝트 선택</DialogTitle>
          <DialogDescription>선택한 프로젝트의 작업 화면으로 이동합니다.</DialogDescription>
        </DialogHeader>
        <div className="p-5">
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="프로젝트명, ID, 관리자, URL 검색"
              autoFocus
            />
          </div>
          <div className="max-h-[420px] overflow-y-auto rounded-lg border border-border">
            {loading ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">프로젝트를 불러오는 중...</p>
            ) : filteredProjects.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">선택할 프로젝트가 없습니다.</p>
            ) : (
              <ul className="divide-y divide-border">
                {filteredProjects.map((project) => {
                  const active = project.projectId === activeProjectId;
                  return (
                    <li key={project.projectId}>
                      <button
                        type="button"
                        className={cn(
                          'flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent',
                          active && 'bg-accent'
                        )}
                        onClick={() => onSelect(project.projectId)}
                      >
                        <FolderKanban className="h-4 w-4 shrink-0 text-primary" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-foreground">
                            {project.projectName}
                          </span>
                          <span className="block truncate font-mono text-xs text-muted-foreground">
                            {project.projectId}
                          </span>
                        </span>
                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          {serverTypeLabel[project.serverType]}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            이동 탭: {PROJECT_WORKSPACE_TABS.find((item) => item.id === currentTab)?.label ?? '대시보드'}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
