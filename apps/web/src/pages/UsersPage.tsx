import { useCallback, useEffect, useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { LogOut, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { api, getStoredAuth } from '@/api/client';
import type { AiProviderSettingsResponse, SlackSettingsResponse, User, UserAuditLog, UserRole } from '@/types';
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
import { cn } from '@/lib/utils';

ModuleRegistry.registerModules([AllCommunityModule]);

const auditActionLabel: Record<UserAuditLog['action'], string> = {
  CREATED: '계정 생성',
  DELETED: '계정 삭제',
  ROLE_CHANGED: '역할 변경',
  PASSWORD_RESET: '비밀번호 재설정',
  SESSIONS_REVOKED: '강제 로그아웃',
};

export function UsersPage() {
  const auth = getStoredAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', role: 'USER' as UserRole });
  const [error, setError] = useState('');

  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState({ role: 'USER' as UserRole, password: '' });
  const [editError, setEditError] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const [aiSettings, setAiSettings] = useState<AiProviderSettingsResponse | null>(null);
  const [claudeKeyInput, setClaudeKeyInput] = useState('');
  const [openaiKeyInput, setOpenaiKeyInput] = useState('');
  const [claudeWorkspaceIdInput, setClaudeWorkspaceIdInput] = useState('');
  const [aiSettingsSaving, setAiSettingsSaving] = useState(false);
  const [aiSettingsError, setAiSettingsError] = useState('');
  const [aiSettingsMessage, setAiSettingsMessage] = useState('');

  const [slackSettings, setSlackSettings] = useState<SlackSettingsResponse | null>(null);
  const [slackWebhookInput, setSlackWebhookInput] = useState('');
  const [slackSaving, setSlackSaving] = useState(false);
  const [slackTesting, setSlackTesting] = useState(false);
  const [slackError, setSlackError] = useState('');
  const [slackMessage, setSlackMessage] = useState('');

  const [auditLog, setAuditLog] = useState<UserAuditLog[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [revoking, setRevoking] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      setUsers(await api.getUsers());
    } catch {
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAiSettings = useCallback(async () => {
    try {
      setAiSettings(await api.admin.getAiProviderSettings());
    } catch {
      setAiSettings(null);
    }
  }, []);

  const loadSlackSettings = useCallback(async () => {
    try {
      setSlackSettings(await api.admin.getSlackSettings());
    } catch {
      setSlackSettings(null);
    }
  }, []);

  const loadAuditLog = useCallback(async () => {
    setAuditLoading(true);
    try {
      setAuditLog(await api.getUserAuditLog());
    } catch {
      setAuditLog([]);
    } finally {
      setAuditLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
    loadAiSettings();
    loadSlackSettings();
    loadAuditLog();
  }, [loadUsers, loadAiSettings, loadSlackSettings, loadAuditLog]);

  const handleSaveAiSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setAiSettingsError('');
    setAiSettingsMessage('');
    if (!claudeKeyInput.trim() && !openaiKeyInput.trim() && !claudeWorkspaceIdInput.trim()) {
      setAiSettingsError('변경할 키를 하나 이상 입력하세요.');
      return;
    }
    setAiSettingsSaving(true);
    try {
      const updated = await api.admin.updateAiProviderSettings({
        claudeApiKey: claudeKeyInput.trim() || undefined,
        openaiApiKey: openaiKeyInput.trim() || undefined,
        claudeWorkspaceId: claudeWorkspaceIdInput.trim() || undefined,
      });
      setAiSettings(updated);
      setClaudeKeyInput('');
      setOpenaiKeyInput('');
      setClaudeWorkspaceIdInput('');
      setAiSettingsMessage('저장되었습니다.');
    } catch (err) {
      setAiSettingsError(err instanceof Error ? err.message : '저장 실패');
    } finally {
      setAiSettingsSaving(false);
    }
  };

  const handleSaveSlackSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSlackError('');
    setSlackMessage('');
    if (!slackWebhookInput.trim()) {
      setSlackError('Webhook URL을 입력하세요.');
      return;
    }
    setSlackSaving(true);
    try {
      const updated = await api.admin.updateSlackSettings({ webhookUrl: slackWebhookInput.trim() });
      setSlackSettings(updated);
      setSlackWebhookInput('');
      setSlackMessage('저장되었습니다.');
    } catch (err) {
      setSlackError(err instanceof Error ? err.message : '저장 실패');
    } finally {
      setSlackSaving(false);
    }
  };

  const handleTestSlack = async () => {
    setSlackError('');
    setSlackMessage('');
    setSlackTesting(true);
    try {
      await api.admin.testSlackNotification();
      setSlackMessage('테스트 메시지를 전송했습니다. Slack 채널을 확인하세요.');
    } catch (err) {
      setSlackError(err instanceof Error ? err.message : '테스트 전송 실패');
    } finally {
      setSlackTesting(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api.createUser(form);
      setDialogOpen(false);
      setForm({ username: '', password: '', role: 'USER' });
      loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : '등록 실패');
    }
  };

  const handleDelete = async (id: number, username: string) => {
    if (!confirm(`사용자 "${username}"를 삭제하시겠습니까?`)) return;
    try {
      await api.deleteUser(id);
      loadUsers();
    } catch (err) {
      alert(err instanceof Error ? err.message : '삭제 실패');
    }
  };

  const openEditDialog = (user: User) => {
    setEditingUser(user);
    setEditForm({ role: user.role, password: '' });
    setEditError('');
  };

  const handleRevokeSessions = async () => {
    if (!editingUser) return;
    if (!confirm(`"${editingUser.username}" 계정의 모든 로그인 세션을 강제 로그아웃하시겠습니까?`)) return;
    setRevoking(true);
    setEditError('');
    try {
      await api.revokeUserSessions(editingUser.id);
      loadAuditLog();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : '강제 로그아웃 실패');
    } finally {
      setRevoking(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setEditError('');
    setEditSaving(true);
    try {
      const payload: { role?: UserRole; password?: string } = {};
      if (editForm.role !== editingUser.role) payload.role = editForm.role;
      if (editForm.password.trim()) payload.password = editForm.password.trim();
      await api.updateUser(editingUser.id, payload);
      setEditingUser(null);
      loadUsers();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : '수정 실패');
    } finally {
      setEditSaving(false);
    }
  };

  const columnDefs = useMemo<ColDef<User>[]>(() => [
    { field: 'id', headerName: 'ID', width: 80 },
    { field: 'username', headerName: '사용자명', flex: 1 },
    {
      field: 'role',
      headerName: '역할',
      width: 120,
      cellRenderer: (p: ICellRendererParams<User>) => (
        <span
          className={cn(
            'inline-flex px-2 py-0.5 rounded-full text-xs font-medium',
            p.value === 'ADMIN' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
          )}
        >
          {p.value}
        </span>
      ),
    },
    {
      field: 'createdAt',
      headerName: '등록일',
      flex: 1,
      valueFormatter: (p) => (p.value ? new Date(p.value).toLocaleString('ko-KR') : '-'),
    },
    {
      field: 'lastLoginAt',
      headerName: '마지막 로그인',
      flex: 1,
      valueFormatter: (p) => (p.value ? new Date(p.value).toLocaleString('ko-KR') : '로그인 기록 없음'),
    },
    {
      headerName: '',
      width: 90,
      sortable: false,
      filter: false,
      cellRenderer: (p: ICellRendererParams<User>) =>
        p.data ? (
          <div className="flex items-center gap-1 h-full">
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground p-1 cursor-pointer"
              onClick={() => openEditDialog(p.data!)}
            >
              <Pencil className="h-4 w-4" />
            </button>
            {p.data.username !== 'admin' && p.data.username !== auth?.username ? (
              <button
                type="button"
                className="text-destructive hover:text-destructive/80 p-1 cursor-pointer"
                onClick={() => handleDelete(p.data!.id, p.data!.username)}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        ) : null,
    },
  ], [auth?.username]);

  if (auth?.role !== 'ADMIN') {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">관리자 권한이 필요합니다.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">사용자 관리</h2>
          <p className="text-sm text-muted-foreground mt-1">Admin 계정 및 사용자 등록 관리</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={loadUsers} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            새로고침
          </Button>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            사용자 등록
          </Button>
        </div>
      </div>

      <div className="ag-theme-playops rounded-xl border border-border overflow-hidden" style={{ height: 480 }}>
        <AgGridReact
          rowData={users}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, filter: true, resizable: true }}
          animateRows
          theme="legacy"
          overlayNoRowsTemplate="등록된 사용자가 없습니다"
        />
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div>
          <h3 className="text-lg font-bold text-foreground">AI 설정</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Claude/GPT API 키는 관리자만 등록할 수 있고, 등록 후에는 이 화면에서도 평문으로 다시 표시되지 않습니다.
            등록된 키는 모든 프로젝트의 AI 기능에서 공용으로 사용됩니다.
          </p>
        </div>
        <form onSubmit={handleSaveAiSettings} className="space-y-4">
          <div className="grid grid-cols-1 @3xl:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="flex items-center justify-between">
                <span>Claude API Key</span>
                <span className={cn(
                  'text-xs font-medium px-2 py-0.5 rounded-full',
                  aiSettings?.claudeConfigured ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
                )}>
                  {aiSettings?.claudeConfigured ? `설정됨 (${aiSettings.claudeMasked})` : '미설정'}
                </span>
              </Label>
              <Input
                type="password"
                placeholder="sk-ant-..."
                value={claudeKeyInput}
                onChange={(e) => setClaudeKeyInput(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center justify-between">
                <span>Claude Workspace ID</span>
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                  {aiSettings?.claudeWorkspaceId ? `설정됨 (${aiSettings.claudeWorkspaceId})` : '선택'}
                </span>
              </Label>
              <Input
                type="text"
                placeholder="wrkspc_... (워크스페이스 연결형 키에만 필요)"
                value={claudeWorkspaceIdInput}
                onChange={(e) => setClaudeWorkspaceIdInput(e.target.value)}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                console.anthropic.com에서 발급한 키가 "identity-linked" 타입이면 필요합니다. 일반 API 키는 비워두세요.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center justify-between">
                <span>GPT API Key</span>
                <span className={cn(
                  'text-xs font-medium px-2 py-0.5 rounded-full',
                  aiSettings?.openaiConfigured ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
                )}>
                  {aiSettings?.openaiConfigured ? `설정됨 (${aiSettings.openaiMasked})` : '미설정'}
                </span>
              </Label>
              <Input
                type="password"
                placeholder="sk-proj-..."
                value={openaiKeyInput}
                onChange={(e) => setOpenaiKeyInput(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
          </div>
          {aiSettingsError && <p className="text-sm text-destructive">{aiSettingsError}</p>}
          {aiSettingsMessage && <p className="text-sm text-success">{aiSettingsMessage}</p>}
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={aiSettingsSaving}>
              {aiSettingsSaving ? '저장 중...' : '키 저장'}
            </Button>
          </div>
        </form>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div>
          <h3 className="text-lg font-bold text-foreground">Slack 알림 설정</h3>
          <p className="text-sm text-muted-foreground mt-1">
            테스트 실행 실패, AI 수정 검토 필요, AI 적용 후 회귀 감지(자동 되돌림) 시 등록된 Incoming Webhook으로 알립니다.
            등록 후에는 이 화면에서도 평문으로 다시 표시되지 않습니다.
          </p>
        </div>
        <form onSubmit={handleSaveSlackSettings} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="flex items-center justify-between">
              <span>Slack Webhook URL</span>
              <span className={cn(
                'text-xs font-medium px-2 py-0.5 rounded-full',
                slackSettings?.configured ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
              )}>
                {slackSettings?.configured ? `설정됨 (${slackSettings.webhookUrlMasked})` : '미설정'}
              </span>
            </Label>
            <Input
              type="password"
              placeholder="https://hooks.slack.com/services/..."
              value={slackWebhookInput}
              onChange={(e) => setSlackWebhookInput(e.target.value)}
              className="font-mono text-xs"
            />
          </div>
          {slackError && <p className="text-sm text-destructive">{slackError}</p>}
          {slackMessage && <p className="text-sm text-success">{slackMessage}</p>}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleTestSlack}
              disabled={slackTesting || !slackSettings?.configured}
            >
              {slackTesting ? '전송 중...' : '테스트 알림 보내기'}
            </Button>
            <Button type="submit" size="sm" disabled={slackSaving}>
              {slackSaving ? '저장 중...' : 'Webhook 저장'}
            </Button>
          </div>
        </form>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-foreground">감사 로그</h3>
            <p className="text-sm text-muted-foreground mt-1">
              사용자 계정 생성/삭제/역할변경/비밀번호 재설정/강제 로그아웃 이력 (최근 200건)
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={loadAuditLog} disabled={auditLoading}>
            <RefreshCw className={cn('h-4 w-4', auditLoading && 'animate-spin')} />
            새로고침
          </Button>
        </div>
        <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
          {auditLog.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground text-center">기록이 없습니다.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-muted text-muted-foreground sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">시각</th>
                  <th className="px-3 py-2 text-left font-medium">수행자</th>
                  <th className="px-3 py-2 text-left font-medium">작업</th>
                  <th className="px-3 py-2 text-left font-medium">대상</th>
                  <th className="px-3 py-2 text-left font-medium">상세</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {auditLog.map((entry) => (
                  <tr key={entry.id}>
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                      {new Date(entry.createdAt).toLocaleString('ko-KR')}
                    </td>
                    <td className="px-3 py-2">{entry.actorUsername ?? '-'}</td>
                    <td className="px-3 py-2">{auditActionLabel[entry.action]}</td>
                    <td className="px-3 py-2">{entry.targetUsername ?? '-'}</td>
                    <td className="px-3 py-2 text-muted-foreground">{entry.detail ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>사용자 등록</DialogTitle>
            <DialogDescription>새 사용자 계정을 생성합니다</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label>사용자명</Label>
              <Input
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>비밀번호</Label>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>역할</Label>
              <select
                className="flex h-9 w-full rounded-md border border-border bg-card px-3 text-sm"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}
              >
                <option value="USER">USER</option>
                <option value="ADMIN">ADMIN</option>
              </select>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                취소
              </Button>
              <Button type="submit">등록</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>사용자 수정</DialogTitle>
            <DialogDescription>
              {editingUser?.username} 계정의 역할을 변경하거나 비밀번호를 재설정합니다
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpdate} className="space-y-4">
            <div className="space-y-2">
              <Label>역할</Label>
              <select
                className="flex h-9 w-full rounded-md border border-border bg-card px-3 text-sm disabled:bg-muted disabled:text-muted-foreground"
                value={editForm.role}
                disabled={editingUser?.username === 'admin'}
                onChange={(e) => setEditForm((prev) => ({ ...prev, role: e.target.value as UserRole }))}
              >
                <option value="USER">USER</option>
                <option value="ADMIN">ADMIN</option>
              </select>
              {editingUser?.username === 'admin' && (
                <p className="text-xs text-muted-foreground">admin 계정의 역할은 변경할 수 없습니다.</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>새 비밀번호 (변경 시에만 입력)</Label>
              <Input
                type="password"
                value={editForm.password}
                onChange={(e) => setEditForm((prev) => ({ ...prev, password: e.target.value }))}
                placeholder="비워두면 기존 비밀번호 유지"
              />
            </div>
            {editError && <p className="text-sm text-destructive">{editError}</p>}
            <div className="flex items-center justify-between gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-warning border-warning/30 hover:bg-warning/10"
                onClick={handleRevokeSessions}
                disabled={revoking}
                title="이 계정으로 로그인된 모든 기기에서 즉시 로그아웃시킵니다"
              >
                <LogOut className="h-3.5 w-3.5" />
                {revoking ? '처리 중...' : '모든 세션 강제 로그아웃'}
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setEditingUser(null)}>
                  취소
                </Button>
                <Button type="submit" disabled={editSaving}>
                  {editSaving ? '저장 중...' : '저장'}
                </Button>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
