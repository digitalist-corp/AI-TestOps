import { useCallback, useEffect, useState } from 'react';
import {
  Copy,
  Download,
  FileCode,
  Loader2,
  Plus,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { api } from '@/api/client';
import type { PlaywrightTemplate, PlaywrightTemplateFormData } from '@/types';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog';
import { FileTree } from '@/components/FileTree';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { cn } from '@/lib/utils';
import { AiTemplateGeneratorDialog } from '@/components/project/AiTemplateGeneratorDialog';

type TemplateDialogMode = 'create' | 'clone' | 'edit';

interface TemplateDialogState {
  mode: TemplateDialogMode;
  source?: PlaywrightTemplate;
}

const emptyForm: PlaywrightTemplateFormData = {
  id: '',
  name: '',
  description: '',
};

export function TemplatesPage() {
  const [templates, setTemplates] = useState<PlaywrightTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filePath, setFilePath] = useState('');
  const [fileContent, setFileContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [fileLoading, setFileLoading] = useState(false);
  const [savingFile, setSavingFile] = useState(false);
  const [dialog, setDialog] = useState<TemplateDialogState | null>(null);
  const [aiModalOpen, setAiModalOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.getTemplates();
      setTemplates(list);
      setSelectedId((prev) => (prev && list.some((t) => t.id === prev) ? prev : list[0]?.id ?? null));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selected = templates.find((t) => t.id === selectedId) ?? null;

  const replaceTemplate = (template: PlaywrightTemplate) => {
    setTemplates((prev) =>
      prev.map((item) => (item.id === template.id ? template : item)).sort((a, b) => a.id.localeCompare(b.id))
    );
  };

  const clearEditor = () => {
    setFilePath('');
    setFileContent('');
  };

  const selectTemplate = (templateId: string) => {
    setSelectedId(templateId);
    clearEditor();
  };

  const handleSelectFile = async (path: string) => {
    if (!selectedId) return;
    setFilePath(path);
    setFileLoading(true);
    try {
      const res = await api.getTemplateFile(selectedId, path);
      setFileContent(res.content);
    } catch (err) {
      setFileContent(err instanceof Error ? `// ${err.message}` : '// 파일을 불러오지 못했습니다.');
    } finally {
      setFileLoading(false);
    }
  };

  const handleSaveFile = async () => {
    if (!selectedId || !filePath.trim()) return;
    setSavingFile(true);
    try {
      const updated = await api.saveTemplateFile(selectedId, filePath, fileContent);
      replaceTemplate(updated);
    } catch (err) {
      alert(err instanceof Error ? err.message : '파일 저장 실패');
    } finally {
      setSavingFile(false);
    }
  };

  const handleDeleteFile = async () => {
    if (!selectedId || !filePath.trim()) return;
    const ok = confirm(`'${filePath}' 파일을 삭제하시겠습니까?`);
    if (!ok) return;
    const updated = await api.deleteTemplateFile(selectedId, filePath.trim());
    replaceTemplate(updated);
    clearEditor();
  };

  const handleDeleteTemplate = async () => {
    if (!selected || !selected.custom) return;
    if (!confirm(`'${selected.name}' 템플릿을 삭제하시겠습니까?`)) return;
    try {
      await api.deleteTemplate(selected.id);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : '템플릿 삭제 실패');
    }
  };

  const handleDownload = async () => {
    if (!selectedId) return;
    try {
      const blob = await api.downloadTemplateSource(selectedId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedId}.zip`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'ZIP 다운로드 실패');
    }
  };

  const handleDialogSubmit = async (data: PlaywrightTemplateFormData) => {
    if (!dialog) return;

    if (dialog.mode === 'create') {
      const created = await api.createTemplate(data);
      // createTemplate은 id/name/description만 받는다 — 기본 보일러플레이트 파일은
      // 생성 후 기존 saveTemplateFile 엔드포인트로 하나씩 채워 넣는다.
      const seedFiles: Record<string, string> = {
        'tests/example.spec.ts':
          "import { test, expect } from '@playwright/test';\n\ntest('basic test', async ({ page }) => {\n  await page.goto('https://example.com');\n  await expect(page).toHaveTitle(/Example/);\n});\n",
        'playwright.config.ts':
          "import { defineConfig, devices } from '@playwright/test';\n\nexport default defineConfig({\n  testDir: './tests',\n  fullyParallel: true,\n  reporter: 'html',\n  use: {\n    trace: 'on-first-retry',\n  },\n  projects: [\n    {\n      name: 'chromium',\n      use: { ...devices['Desktop Chrome'] },\n    },\n  ],\n});\n",
      };
      let seeded = created;
      for (const [path, content] of Object.entries(seedFiles)) {
        seeded = await api.saveTemplateFile(created.id, path, content);
      }
      setTemplates((prev) => [...prev, seeded].sort((a, b) => a.id.localeCompare(b.id)));
      selectTemplate(seeded.id);
    }

    if (dialog.mode === 'clone' && dialog.source) {
      const cloned = await api.cloneTemplate(dialog.source.id, data);
      setTemplates((prev) => [...prev, cloned].sort((a, b) => a.id.localeCompare(b.id)));
      selectTemplate(cloned.id);
    }

    if (dialog.mode === 'edit' && dialog.source) {
      const updated = await api.updateTemplate(dialog.source.id, {
        name: data.name,
        description: data.description,
      });
      replaceTemplate(updated);
    }

    setDialog(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-col gap-3 @5xl:flex-row @5xl:items-start @5xl:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Playwright 템플릿</h2>
          <p className="text-sm text-muted-foreground mt-1">
            프로젝트 생성에 사용할 테스트 소스 템플릿을 관리합니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => setAiModalOpen(true)}
            className="bg-ai-accent hover:opacity-90 text-ai-accent-foreground font-bold flex items-center gap-1.5"
          >
            <Sparkles className="h-4 w-4 animate-bounce" />
            ✨ AI Agent 템플릿 생성
          </Button>
          <Button type="button" size="sm" onClick={() => setDialog({ mode: 'create' })}>
            <Plus className="h-4 w-4" />
            추가
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => selected && setDialog({ mode: 'clone', source: selected })}
            disabled={!selected}
          >
            <Copy className="h-4 w-4" />
            복제
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={handleDownload} disabled={!selected}>
            <Download className="h-4 w-4" />
            소스 ZIP
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 @5xl:grid-cols-3 gap-4">
        <div className="space-y-3">
          {templates.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => selectTemplate(template.id)}
              className={cn(
                'w-full text-left rounded-lg border p-4 transition-colors cursor-pointer',
                selectedId === template.id
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border bg-card hover:border-primary/40'
              )}
            >
              <div className="flex items-center gap-2">
                <FileCode className="h-4 w-4 text-primary" />
                <span className="font-semibold text-foreground truncate">{template.name}</span>
                {template.default && (
                  <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">기본</span>
                )}
                {template.custom && (
                  <span className="text-xs bg-success/10 text-success px-2 py-0.5 rounded-full">사용자</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-2 font-mono">{template.id}</p>
              <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{template.description}</p>
              <p className="text-xs text-muted-foreground mt-2">{template.files.length}개 파일</p>
            </button>
          ))}
        </div>

        <Card className="min-w-0 @5xl:col-span-2">
          <CardHeader>
            <div className="flex flex-col gap-3 @3xl:flex-row @3xl:items-start @3xl:justify-between">
              <div>
                <CardTitle className="text-base">{selected?.name ?? '템플릿 선택'}</CardTitle>
                <CardDescription>{selected?.description ?? '관리할 템플릿을 선택하세요.'}</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => selected && setDialog({ mode: 'edit', source: selected })}
                  disabled={!selected}
                >
                  수정
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={handleDeleteTemplate}
                  disabled={!selected || !selected.deletable}
                  title={selected?.default ? '기본 템플릿은 삭제할 수 없습니다.' : undefined}
                >
                  <Trash2 className="h-4 w-4" />
                  삭제
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {selected ? (
              <div className="grid grid-cols-1 @3xl:grid-cols-[minmax(180px,240px)_1fr] gap-4 min-h-[420px]">
                <div className="border border-border rounded-lg p-3 bg-muted/50 max-h-[520px] overflow-auto">
                  <FileTree files={selected.files} onFileClick={handleSelectFile} selectedPath={filePath} />
                </div>

                <div className="border border-border rounded-lg overflow-hidden flex flex-col min-h-[420px]">
                  <div className="flex flex-col gap-2 border-b border-border bg-muted p-3">
                    <Label>파일 경로</Label>
                    <div className="flex gap-2">
                      <Input
                        value={filePath}
                        onChange={(e) => setFilePath(e.target.value)}
                        placeholder="tests/example.spec.ts"
                        className="font-mono"
                      />
                      <Button type="button" size="icon" onClick={handleSaveFile} disabled={savingFile || !filePath.trim()}>
                        {savingFile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        onClick={handleDeleteFile}
                        disabled={!filePath.trim()}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <textarea
                    value={fileLoading ? '로딩 중...' : fileContent}
                    onChange={(e) => setFileContent(e.target.value)}
                    disabled={fileLoading}
                    spellCheck={false}
                    className="flex-1 min-h-[320px] resize-none p-3 text-xs font-mono overflow-auto bg-card text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    placeholder="파일을 선택하거나 새 파일 경로를 입력하세요."
                  />
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">템플릿이 없습니다.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <TemplateFormDialog
        state={dialog}
        onOpenChange={(open) => !open && setDialog(null)}
        onSubmit={handleDialogSubmit}
      />
      <AiTemplateGeneratorDialog
        open={aiModalOpen}
        onOpenChange={setAiModalOpen}
        onSuccessSave={load}
      />
    </div>
  );
}

function TemplateFormDialog({
  state,
  onOpenChange,
  onSubmit,
}: {
  state: TemplateDialogState | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: PlaywrightTemplateFormData) => Promise<void>;
}) {
  const [form, setForm] = useState<PlaywrightTemplateFormData>(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!state) return;
    if (state.mode === 'edit' && state.source) {
      setForm({
        id: state.source.id,
        name: state.source.name,
        description: state.source.description,
      });
    } else if (state.mode === 'clone' && state.source) {
      setForm({
        id: `${state.source.id}-copy`,
        name: `${state.source.name} 복사본`,
        description: state.source.description,
      });
    } else {
      setForm(emptyForm);
    }
    setError('');
  }, [state]);

  const title =
    state?.mode === 'create' ? '템플릿 추가' : state?.mode === 'clone' ? '템플릿 복제' : '템플릿 수정';

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await onSubmit(form);
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={!!state} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            템플릿 ID는 영문, 숫자, 점, 하이픈, 언더스코어만 사용할 수 있습니다.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Template ID</Label>
            <Input
              value={form.id}
              onChange={(e) => setForm((prev) => ({ ...prev, id: e.target.value }))}
              disabled={state?.mode === 'edit'}
              required
            />
          </div>
          <div className="space-y-2">
            <Label>이름</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              required
            />
          </div>
          <div className="space-y-2">
            <Label>설명</Label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              className="flex w-full rounded-md border border-border bg-card px-3 py-2 text-sm min-h-[96px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              취소
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? '저장 중...' : '저장'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
