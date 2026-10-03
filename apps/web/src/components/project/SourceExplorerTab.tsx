import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RotateCcw, Save, Sparkles, XCircle } from 'lucide-react';
import { api } from '@/api/client';
import type { AiEditAssistVerifyResponse, Project } from '@/types';
import { FileTree } from '@/components/FileTree';
import { MonacoEditor } from '@/components/MonacoEditor';
import { Button } from '@/components/ui/Button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog';
import { buildPlaywrightMismatchMessage, extractPlaywrightVersion } from '@/lib/projectRuntime';

interface Props {
  projectId: string;
  project: Project;
  files: string[];
  onFilesChange: () => void;
  initialPath?: string | null;
}

function isRestrictedFile(path: string) {
  const fileName = path.split('/').pop() ?? path;
  return fileName === '.env' || fileName.startsWith('.env.');
}

function isSpecFile(path: string) {
  return path.endsWith('.spec.ts') || path.endsWith('.spec.js');
}

export function SourceExplorerTab({ projectId, project, files, onFilesChange, initialPath }: Props) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [original, setOriginal] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [versionWarning, setVersionWarning] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiInstruction, setAiInstruction] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiProposedContent, setAiProposedContent] = useState<string | null>(null);
  const [aiVerifySpecPath, setAiVerifySpecPath] = useState('');
  const [aiVerifying, setAiVerifying] = useState(false);
  const [aiVerifyResult, setAiVerifyResult] = useState<AiEditAssistVerifyResponse | null>(null);

  const specFiles = files.filter(isSpecFile);

  const loadFile = useCallback(async (path: string) => {
    if (isRestrictedFile(path)) return;
    setLoading(true);
    setSelectedPath(path);
    try {
      const res = await api.readProjectFile(projectId, path);
      setContent(res.content);
      setOriginal(res.content);
    } catch {
      setContent('');
      setOriginal('');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (initialPath && files.includes(initialPath) && !isRestrictedFile(initialPath)) {
      loadFile(initialPath);
    }
  }, [initialPath, files, loadFile]);

  useEffect(() => {
    const spec = files.find((f) => f.endsWith('.spec.ts') || f.endsWith('.spec.js'));
    if (spec && !selectedPath) loadFile(spec);
  }, [files, selectedPath, loadFile]);

  useEffect(() => {
    if (!files.includes('package.json')) {
      setVersionWarning(null);
      return;
    }
    let cancelled = false;
    api.readProjectFile(projectId, 'package.json')
      .then((res) => {
        if (cancelled) return;
        setVersionWarning(buildPlaywrightMismatchMessage(project, extractPlaywrightVersion(res.content)));
      })
      .catch(() => {
        if (!cancelled) setVersionWarning(null);
      });
    return () => {
      cancelled = true;
    };
  }, [files, project, projectId]);

  const handleSave = async () => {
    if (!selectedPath) return;
    setSaving(true);
    try {
      await api.saveProjectFile(projectId, selectedPath, content);
      setOriginal(content);
      onFilesChange();
    } catch (err) {
      alert(err instanceof Error ? err.message : '저장 실패');
    } finally {
      setSaving(false);
    }
  };

  const dirty = content !== original;
  const handleCancel = () => {
    setContent(original);
  };

  const resetAiDialog = () => {
    setAiOpen(false);
    setAiInstruction('');
    setAiProposedContent(null);
    setAiVerifyResult(null);
    setAiVerifySpecPath('');
  };

  const runVerify = async (proposedContent: string, specPath: string) => {
    if (!selectedPath || !specPath) return;
    setAiVerifying(true);
    setAiVerifyResult(null);
    setAiError('');
    try {
      const res = await api.aiEditAssistVerify(projectId, {
        filePath: selectedPath,
        proposedContent,
        specPath,
      });
      setAiVerifyResult(res);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : '실행 검증 실패');
    } finally {
      setAiVerifying(false);
    }
  };

  const handleAiEditAssist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPath || !aiInstruction.trim()) return;
    setAiLoading(true);
    setAiError('');
    setAiVerifyResult(null);
    try {
      const res = await api.aiEditAssist(projectId, {
        filePath: selectedPath,
        currentContent: content,
        instruction: aiInstruction.trim(),
      });
      setAiProposedContent(res.content);
      const defaultSpec = isSpecFile(selectedPath) ? selectedPath : (specFiles[0] ?? '');
      setAiVerifySpecPath(defaultSpec);
      if (defaultSpec) {
        await runVerify(res.content, defaultSpec);
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'AI 수정 요청 실패');
    } finally {
      setAiLoading(false);
    }
  };

  const handleApplyProposed = () => {
    if (aiProposedContent === null) return;
    setContent(aiProposedContent);
    resetAiDialog();
  };

  return (
    <div className="grid grid-cols-1 @5xl:grid-cols-3 gap-4 min-h-[520px]">
      <div className="border border-border rounded-lg p-3 bg-muted/50 overflow-auto max-h-[600px]">
        <p className="text-xs font-medium text-muted-foreground mb-2">파일 탐색기</p>
        <FileTree
          files={files}
          onFileClick={loadFile}
          selectedPath={selectedPath}
          isRestrictedFile={isRestrictedFile}
        />
      </div>
      <div className="min-w-0 @5xl:col-span-2 flex flex-col border border-border rounded-lg overflow-hidden min-h-[520px]">
        {versionWarning && (
          <div className="flex items-center gap-2 border-b border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 truncate">{versionWarning}</span>
          </div>
        )}
        <div className="flex items-center justify-between px-3 py-2 bg-muted border-b border-border shrink-0">
          <span className="text-xs font-mono text-muted-foreground truncate">
            {selectedPath ?? '파일을 선택하세요'}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="text-ai-accent border-ai-accent/30 hover:bg-ai-accent/10"
              disabled={!selectedPath || loading}
              onClick={() => setAiOpen(true)}
              title="AI에게 이 파일 수정을 요청하고 실행 결과로 검증한 뒤 에디터에 적용"
            >
              <Sparkles className="h-3 w-3" />
              AI 수정 도움
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!selectedPath || !dirty || saving || loading}
              onClick={handleCancel}
            >
              <RotateCcw className="h-3 w-3" />
              취소
            </Button>
            <Button size="sm" disabled={!selectedPath || !dirty || saving} onClick={handleSave}>
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              저장
            </Button>
          </div>
        </div>
        <div className="flex-1 min-h-[480px]">
          <MonacoEditor
            path={selectedPath}
            value={content}
            onChange={setContent}
            loading={loading}
          />
        </div>
      </div>

      <Dialog open={aiOpen} onOpenChange={(open) => { if (!open) resetAiDialog(); else setAiOpen(true); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-ai-accent" />
              AI 수정 도움
            </DialogTitle>
            <DialogDescription>
              현재 열려 있는 <span className="font-mono">{selectedPath}</span> 파일 내용을 바탕으로 AI가 수정을 제안하고,
              실제로 실행해서 통과하는지 보여줍니다. 에디터에는 "에디터에 적용"을 눌러야 반영되며,
              실제 파일에는 그 후 "저장"을 눌러야 반영됩니다.
            </DialogDescription>
          </DialogHeader>

          {aiProposedContent === null ? (
            <form onSubmit={handleAiEditAssist} className="space-y-4">
              <textarea
                rows={4}
                value={aiInstruction}
                onChange={(e) => setAiInstruction(e.target.value)}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ai-accent"
                placeholder="예: 로그인 성공 후 대시보드로 이동하는지 확인하는 검증을 추가해줘."
                required
                autoFocus
              />
              {aiError && <p className="text-xs text-destructive">{aiError}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={resetAiDialog}>
                  취소
                </Button>
                <Button type="submit" disabled={aiLoading} className="bg-ai-accent hover:opacity-90 text-ai-accent-foreground">
                  {aiLoading ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> 수정 생성 중...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3.5 w-3.5" /> 수정 제안 받기
                    </>
                  )}
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              {!isSpecFile(selectedPath ?? '') && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    이 수정을 검증할 spec 파일
                  </label>
                  <select
                    value={aiVerifySpecPath}
                    onChange={(e) => setAiVerifySpecPath(e.target.value)}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ai-accent"
                  >
                    <option value="">spec 파일 선택</option>
                    {specFiles.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!aiVerifySpecPath || aiVerifying}
                    onClick={() => runVerify(aiProposedContent, aiVerifySpecPath)}
                  >
                    {aiVerifying ? <Loader2 className="h-3 w-3 animate-spin" /> : '실행하며 확인'}
                  </Button>
                </div>
              )}

              {aiVerifying && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> {aiVerifySpecPath} 실행 중...
                </p>
              )}

              {aiVerifyResult && !aiVerifying && (
                <div className="space-y-2">
                  <p className={`flex items-center gap-1.5 text-sm font-medium ${aiVerifyResult.passed ? 'text-success' : 'text-destructive'}`}>
                    {aiVerifyResult.passed ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                    {aiVerifyResult.passed
                      ? `이 수정으로 ${aiVerifyResult.specPath} 테스트가 통과합니다`
                      : `${aiVerifyResult.specPath} 테스트가 여전히 실패합니다`}
                    <span className="text-xs font-normal text-muted-foreground">({aiVerifyResult.durationMs}ms)</span>
                  </p>
                  <details className="rounded-lg border border-border bg-muted/50">
                    <summary className="cursor-pointer px-3 py-1.5 text-xs text-muted-foreground">실행 로그 보기</summary>
                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all px-3 pb-3 text-[11px] text-muted-foreground">
                      {aiVerifyResult.log}
                    </pre>
                  </details>
                </div>
              )}

              {aiError && <p className="text-xs text-destructive">{aiError}</p>}

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={resetAiDialog}>
                  취소
                </Button>
                <Button type="button" disabled={aiVerifying} onClick={handleApplyProposed} className="bg-ai-accent hover:opacity-90 text-ai-accent-foreground">
                  <Sparkles className="h-3.5 w-3.5" /> 에디터에 적용
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
