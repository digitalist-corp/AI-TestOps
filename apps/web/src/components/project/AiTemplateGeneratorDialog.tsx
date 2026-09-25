import { useState, useEffect } from 'react';
import { Sparkles, Loader2, Globe, FileCode2, Check, ArrowRight } from 'lucide-react';
import { api } from '@/api/client';
import type { AiModelProvider, AiTemplateResponse } from '@/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog';

interface AiTemplateGeneratorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccessSave: () => void;
}

export function AiTemplateGeneratorDialog({
  open,
  onOpenChange,
  onSuccessSave,
}: AiTemplateGeneratorDialogProps) {
  const [templateName, setTemplateName] = useState('');
  const [targetUrl, setTargetUrl] = useState('https://example.com');
  const [userPrompt, setUserPrompt] = useState('');
  const [provider, setProvider] = useState<AiModelProvider>('CLAUDE');

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [aiResult, setAiResult] = useState<AiTemplateResponse | null>(null);
  const [selectedFileIdx, setSelectedFileIdx] = useState(0);

  useEffect(() => {
    if (open) {
      setError('');
      setAiResult(null);
    }
  }, [open]);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userPrompt.trim()) {
      setError('AI에게 요청할 시나리오 및 요구사항을 입력하세요.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await api.ai.generateTemplate({
        templateName: templateName.trim() || 'AI 생성 E2E 템플릿',
        targetUrl: targetUrl.trim() || 'https://example.com',
        userPrompt: userPrompt.trim(),
        provider,
      });
      setAiResult(res);
      setSelectedFileIdx(0);
    } catch (err: any) {
      setError(err.message || 'AI 템플릿 생성 실패');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAsTemplate = async () => {
    if (!aiResult) return;
    setSaving(true);
    setError('');
    try {
      const templateId = `ai-${Date.now().toString(36)}`;

      // createTemplate은 id/name/description만 받는다 — AI가 만든 실제 파일 내용은
      // 생성 후 saveTemplateFile로 하나씩 채워 넣어야 실제로 저장된다.
      await api.createTemplate({
        id: templateId,
        name: aiResult.templateName || templateName || 'AI E2E 템플릿',
        description: aiResult.description || 'AI Agent가 자동 생성한 Playwright 템플릿',
      });
      for (const f of aiResult.files) {
        await api.saveTemplateFile(templateId, f.filename, f.content);
      }

      onSuccessSave();
      onOpenChange(false);
    } catch (err: any) {
      setError(err.message || '템플릿 저장 실패');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl p-0 overflow-hidden">
        <DialogHeader className="border-b border-sidebar-active bg-gradient-to-r from-sidebar via-ai-accent/25 to-sidebar px-6 py-5 text-white">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ai-accent/20 text-ai-accent ring-1 ring-ai-accent/30">
              <Sparkles className="h-4 w-4 text-ai-accent animate-pulse" />
            </span>
            <div>
              <DialogTitle className="text-lg font-bold text-white">
                AI Agent Playwright 템플릿 생성기
              </DialogTitle>
              <DialogDescription className="text-xs text-sidebar-foreground">
                자연어로 요구사항을 입력하면 GPT API가 Playwright v1.53.0 스펙 코드를 자동 생성합니다.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="p-6 bg-background max-h-[80vh] overflow-y-auto space-y-6">
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs font-semibold text-destructive">
              {error}
            </div>
          )}

          {!aiResult ? (
            <form onSubmit={handleGenerate} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-foreground">템플릿 이름</Label>
                  <Input
                    placeholder="예: 쇼핑몰 장바구니 E2E"
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-foreground flex items-center gap-1">
                    <Globe className="h-3.5 w-3.5 text-muted-foreground" /> Target Web URL
                  </Label>
                  <Input
                    placeholder="https://example.com"
                    value={targetUrl}
                    onChange={(e) => setTargetUrl(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">
                  AI 요구사항 & 시나리오 (자연어) *
                </Label>
                <textarea
                  required
                  rows={4}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ai-accent"
                  placeholder="예: 메인 페이지 접속 후 검색창에 '스마트폰' 입력 후 결과 페이지로 이동하여 첫 번째 상품 클릭 및 장바구니 담기 유효성 검증 시나리오 작성해줘."
                  value={userPrompt}
                  onChange={(e) => setUserPrompt(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">AI 모델</Label>
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as AiModelProvider)}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ai-accent"
                >
                  <option value="CLAUDE">Claude</option>
                  <option value="GPT">GPT</option>
                </select>
                <p className="text-[11px] text-muted-foreground">
                  관리자가 등록한 API 키로 생성됩니다. 개인 키를 입력할 필요가 없습니다.
                </p>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  취소
                </Button>
                <Button
                  type="submit"
                  disabled={loading}
                  className="bg-ai-accent hover:opacity-90 text-ai-accent-foreground font-semibold flex items-center gap-2"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> AI 스펙 생성 중...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" /> ✨ AI 템플릿 생성 실행
                    </>
                  )}
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-success/30 bg-success/10 px-4 py-3">
                <div className="flex items-center gap-2">
                  <Check className="h-5 w-5 text-success" />
                  <div>
                    <h4 className="text-sm font-bold text-success">{aiResult.templateName}</h4>
                    <p className="text-xs text-success/80">{aiResult.description}</p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAiResult(null)}
                  className="text-xs border-success/40 text-success hover:bg-success/10"
                >
                  다시 생성하기
                </Button>
              </div>

              {/* File Preview */}
              <div className="rounded-lg border border-border bg-card overflow-hidden">
                <div className="flex items-center border-b border-border bg-muted px-3 py-2 gap-2 overflow-x-auto">
                  {aiResult.files.map((file, idx) => (
                    <button
                      key={file.filename}
                      type="button"
                      onClick={() => setSelectedFileIdx(idx)}
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                        selectedFileIdx === idx
                          ? 'bg-card text-ai-accent shadow-sm border border-border'
                          : 'text-muted-foreground hover:bg-accent'
                      }`}
                    >
                      <FileCode2 className="h-3.5 w-3.5" />
                      {file.filename}
                    </button>
                  ))}
                </div>
                <div className="p-4 bg-sidebar font-mono text-xs text-sidebar-foreground max-h-72 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                  {aiResult.files[selectedFileIdx]?.content}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  닫기
                </Button>
                <Button
                  type="button"
                  onClick={handleSaveAsTemplate}
                  disabled={saving}
                  className="bg-success hover:opacity-90 text-success-foreground font-semibold flex items-center gap-2"
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> 저장 중...
                    </>
                  ) : (
                    <>
                      <ArrowRight className="h-4 w-4" /> AI-TestOps 템플릿으로 1-Click 저장
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
