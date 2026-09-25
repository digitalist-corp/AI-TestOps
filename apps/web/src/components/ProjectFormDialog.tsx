import { useEffect, useState } from 'react';
import { Check, ClipboardPaste, Github, Loader2, LogIn, Package, Play, Plus, Server, Settings2, ShieldCheck, Trash2 } from 'lucide-react';
import type { PlaywrightTemplate, Project, ProjectFormData } from '@/types';
import { DEFAULT_PROJECT_FORM } from '@/types';
import { api } from '@/api/client';
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
import {
  EnvEntry,
  isSecretEnvKey,
  parseEnvVariablesJson,
  parseEnvVariablesText,
  serializeEnvVariables,
  SUGGESTED_ENV_KEYS,
} from '@/lib/envVariables';

interface ProjectFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** aiBootstrapInstruction이 있으면 저장 후 AI가 초기 케이스를 만들고 실행까지 이어간다. */
  onSubmit: (data: ProjectFormData, aiBootstrapInstruction?: string) => Promise<void>;
  title: string;
  initial?: Project;
}

type FormValue = string | number | boolean;

const selectClass =
  'flex h-9 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

const ALLOWED_NODE_VERSION = '22';
const ALLOWED_PLAYWRIGHT_VERSION = '1.53.0';
const NODE_VERSION_OPTIONS = [ALLOWED_NODE_VERSION];
const PLAYWRIGHT_VERSION_OPTIONS = [ALLOWED_PLAYWRIGHT_VERSION];
const INSTALL_COMMANDS = {
  NPM: ['npm install', 'npm ci'],
  YARN: ['yarn install', 'yarn install --frozen-lockfile'],
  PNPM: ['pnpm install', 'pnpm install --frozen-lockfile'],
} as const;
const TEST_COMMAND_OPTIONS = [
  'npx playwright test --project=chromium',
  'npx playwright test',
  'npm test',
  'pnpm test',
  'yarn test',
];

function FormSection({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function ToggleRow({
  checked,
  onChange,
  title,
  detail,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  detail?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        'flex w-full items-center justify-between gap-4 rounded-md border px-3 py-2 text-left text-sm transition-colors',
        checked ? 'border-primary/30 bg-primary/10' : 'border-border bg-card hover:bg-accent'
      )}
    >
      <span className="min-w-0">
        <span className="block font-medium text-foreground">{title}</span>
        {detail && <span className="mt-0.5 block text-xs text-muted-foreground">{detail}</span>}
      </span>
      <span
        className={cn(
          'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border',
          checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card'
        )}
      >
        {checked && <Check className="h-3 w-3" />}
      </span>
    </button>
  );
}

function SegmentedButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-8 rounded-md px-3 text-xs font-medium transition-colors',
        active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
      )}
    >
      {children}
    </button>
  );
}

function emptyEnvRow(): EnvEntry {
  return { key: '', value: '' };
}

function isNodeVersion(value: string) {
  return value.trim() === ALLOWED_NODE_VERSION;
}

function isSemver(value: string) {
  return value.trim() === ALLOWED_PLAYWRIGHT_VERSION;
}

function validateExecutionEnvironment(form: ProjectFormData): string | null {
  if (!isNodeVersion(form.nodeVersion)) {
    return `Node 버전은 ${ALLOWED_NODE_VERSION}만 사용할 수 있습니다.`;
  }
  if (!isSemver(form.playwrightVersion)) {
    return `Playwright 버전은 ${ALLOWED_PLAYWRIGHT_VERSION}만 사용할 수 있습니다.`;
  }
  if (!form.installCommand.trim()) {
    return 'Install Command를 입력하세요.';
  }
  if (!form.testCommand.trim()) {
    return 'Test Command를 입력하세요.';
  }
  if (!form.workingDirectory.trim()) {
    return 'Working Directory를 입력하세요.';
  }
  if (form.timeout < 1 || form.timeout > 86400) {
    return 'Timeout은 1~86400초 사이로 입력하세요.';
  }
  if (form.parallelLimit < 1 || form.parallelLimit > 100) {
    return 'Parallel Limit은 1~100 사이로 입력하세요.';
  }
  if (form.baseUrl.trim()) {
    try {
      const url = new URL(form.baseUrl);
      if (!['http:', 'https:'].includes(url.protocol)) {
        return 'Base URL은 http 또는 https URL이어야 합니다.';
      }
    } catch {
      return 'Base URL 형식이 올바르지 않습니다.';
    }
  }
  if (form.repositoryUrl.trim() && !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?\/?$/.test(form.repositoryUrl.trim())) {
    return 'Repository URL은 https://github.com/{owner}/{repo} 형식이어야 합니다.';
  }
  if (form.loginSetupSpecPath.trim() && form.storageStateMaxAgeMinutes < 1) {
    return '세션 유효 시간은 1분 이상이어야 합니다.';
  }
  return null;
}

export function ProjectFormDialog({
  open,
  onOpenChange,
  onSubmit,
  title,
  initial,
}: ProjectFormDialogProps) {
  const [form, setForm] = useState<ProjectFormData>(DEFAULT_PROJECT_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [templates, setTemplates] = useState<PlaywrightTemplate[]>([]);
  const [envEntries, setEnvEntries] = useState<EnvEntry[]>([emptyEnvRow()]);
  const [bulkEnvText, setBulkEnvText] = useState('');
  const [envError, setEnvError] = useState('');
  const [aiBootstrapEnabled, setAiBootstrapEnabled] = useState(false);
  const [aiBootstrapInstruction, setAiBootstrapInstruction] = useState('');

  useEffect(() => {
    if (open && !initial) {
      api.getTemplates().then(setTemplates).catch(() => setTemplates([]));
    }
  }, [open, initial]);

  useEffect(() => {
    const envJson = initial?.envVariables ?? DEFAULT_PROJECT_FORM.envVariables;
    if (initial) {
      setForm({
        projectId: initial.projectId,
        projectName: initial.projectName,
        displayOrder: initial.displayOrder ?? 0,
        serverType: initial.serverType ?? 'DEV',
        description: initial.description ?? '',
        testPurpose: initial.testPurpose ?? '',
        managerName: initial.managerName ?? '',
        managerContact: initial.managerContact ?? '',
        nodeVersion: ALLOWED_NODE_VERSION,
        playwrightVersion: ALLOWED_PLAYWRIGHT_VERSION,
        packageManager: initial.packageManager,
        installCommand: initial.installCommand,
        testCommand: initial.testCommand,
        workingDirectory: initial.workingDirectory,
        envVariables: envJson,
        loginEnvRequired: initial.loginEnvRequired ?? false,
        loginSetupSpecPath: initial.loginSetupSpecPath ?? '',
        storageStateMaxAgeMinutes: initial.storageStateMaxAgeMinutes ?? 720,
        timeout: initial.timeout,
        parallelLimit: initial.parallelLimit,
        baseUrl: initial.baseUrl ?? '',
        repositoryUrl: initial.repositoryUrl ?? '',
        repositoryBranch: initial.repositoryBranch ?? '',
        repositoryToken: '',
        runnerLifecycle: initial.runnerLifecycle ?? 'PERSISTENT',
        dockerEnabled: initial.dockerEnabled,
        templateId: 'default',
        scaffoldOnCreate: false,
      });
    } else {
      setForm(DEFAULT_PROJECT_FORM);
    }
    const parsedEnv = parseEnvVariablesJson(envJson);
    setEnvEntries(parsedEnv.length > 0 ? parsedEnv : [emptyEnvRow()]);
    setBulkEnvText('');
    setError('');
    setEnvError('');
  }, [initial, open]);

  const update = (key: keyof ProjectFormData, value: FormValue) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'packageManager') {
        const cmds = { NPM: 'npm install', YARN: 'yarn install', PNPM: 'pnpm install' };
        next.installCommand = cmds[value as keyof typeof cmds];
      }
      if (key === 'dockerEnabled' && value === false) {
        next.runnerLifecycle = 'PERSISTENT';
      }
      return next;
    });
  };

  const setEnvRows = (rows: EnvEntry[]) => {
    const normalized = rows.length > 0 ? rows : [emptyEnvRow()];
    setEnvEntries(normalized);
    setForm((prev) => ({ ...prev, envVariables: serializeEnvVariables(normalized) }));
  };

  const updateEnvEntry = (index: number, patch: Partial<EnvEntry>) => {
    setEnvRows(envEntries.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const addEnvRow = (key = '') => {
    setEnvRows([...envEntries, { key, value: '' }]);
  };

  const addSuggestedEnv = (key: string) => {
    if (envEntries.some((entry) => entry.key === key)) return;
    addEnvRow(key);
  };

  const removeEnvRow = (index: number) => {
    setEnvRows(envEntries.length <= 1 ? [emptyEnvRow()] : envEntries.filter((_, i) => i !== index));
  };

  const applyBulkEnvText = () => {
    const parsed = parseEnvVariablesText(bulkEnvText);
    if (parsed.length === 0) {
      setEnvError('붙여넣은 내용에서 환경변수를 찾지 못했습니다. JSON 객체 또는 KEY=VALUE 형식으로 입력하세요.');
      return;
    }
    setEnvRows(parsed);
    setBulkEnvText('');
    setEnvError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setEnvError('');
    const executionEnvError = validateExecutionEnvironment(form);
    if (executionEnvError) {
      setError(executionEnvError);
      setLoading(false);
      return;
    }
    try {
      JSON.parse(form.envVariables || '{}');
    } catch {
      setEnvError('환경변수 형식이 올바르지 않습니다.');
      setLoading(false);
      return;
    }
    const bootstrapInstruction =
      !initial && aiBootstrapEnabled && aiBootstrapInstruction.trim()
        ? aiBootstrapInstruction.trim()
        : undefined;
    try {
      await onSubmit(form, bootstrapInstruction);
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const selectedTemplate = templates.find((template) => template.id === form.templateId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl p-0 overflow-hidden">
        <DialogHeader className="border-b border-border px-6 py-5">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>프로젝트 실행 환경과 Runner 정책을 설정합니다.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex max-h-[calc(90vh-96px)] flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-background px-6 py-5">
            <FormSection icon={Settings2} title="기본 정보">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-6">
                <div className="space-y-2 md:col-span-1">
                  <Label>순서</Label>
                  <Input
                    type="number"
                    value={form.displayOrder}
                    onChange={(e) => update('displayOrder', Number(e.target.value))}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Project ID *</Label>
                  <Input
                    value={form.projectId}
                    onChange={(e) => update('projectId', e.target.value)}
                    placeholder="my-project"
                    disabled={!!initial}
                    required
                  />
                </div>
                <div className="space-y-2 md:col-span-3">
                  <Label>프로젝트명 *</Label>
                  <Input
                    value={form.projectName}
                    onChange={(e) => update('projectName', e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>서버 구분</Label>
                  <select
                    className={selectClass}
                    value={form.serverType}
                    onChange={(e) => update('serverType', e.target.value)}
                  >
                    <option value="DEV">개발</option>
                    <option value="TEST">테스트</option>
                    <option value="PROD">운영</option>
                  </select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>관리자</Label>
                  <Input value={form.managerName} onChange={(e) => update('managerName', e.target.value)} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>연락처</Label>
                  <Input
                    value={form.managerContact}
                    onChange={(e) => update('managerContact', e.target.value)}
                    placeholder="email 또는 메신저"
                  />
                </div>
                <div className="space-y-2 md:col-span-3">
                  <Label>설명</Label>
                  <textarea
                    className="flex min-h-[72px] w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    value={form.description}
                    onChange={(e) => update('description', e.target.value)}
                  />
                </div>
                <div className="space-y-2 md:col-span-3">
                  <Label>테스트 목적</Label>
                  <textarea
                    className="flex min-h-[72px] w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    value={form.testPurpose}
                    onChange={(e) => update('testPurpose', e.target.value)}
                  />
                </div>
              </div>
            </FormSection>

            <FormSection icon={Package} title="실행 환경">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-6">
                <div className="space-y-2 md:col-span-2">
                  <Label>Node</Label>
                  <select
                    className={selectClass}
                    value={form.nodeVersion}
                    onChange={(e) => update('nodeVersion', e.target.value)}
                    required
                  >
                    {NODE_VERSION_OPTIONS.map((version) => (
                      <option key={version} value={version}>
                        {version}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Playwright</Label>
                  <select
                    className={selectClass}
                    value={form.playwrightVersion}
                    onChange={(e) => update('playwrightVersion', e.target.value)}
                    required
                  >
                    {PLAYWRIGHT_VERSION_OPTIONS.map((version) => (
                      <option key={version} value={version}>
                        {version}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Package Manager</Label>
                  <select
                    className={selectClass}
                    value={form.packageManager}
                    onChange={(e) => update('packageManager', e.target.value)}
                  >
                    <option value="NPM">npm</option>
                    <option value="YARN">yarn</option>
                    <option value="PNPM">pnpm</option>
                  </select>
                </div>
                <div className="space-y-2 md:col-span-3">
                  <Label>Install Command</Label>
                  <Input
                    list="install-command-options"
                    value={form.installCommand}
                    onChange={(e) => update('installCommand', e.target.value)}
                    required
                  />
                  <datalist id="install-command-options">
                    {INSTALL_COMMANDS[form.packageManager].map((command) => (
                      <option key={command} value={command} />
                    ))}
                  </datalist>
                </div>
                <div className="space-y-2 md:col-span-3">
                  <Label>Test Command</Label>
                  <Input
                    list="test-command-options"
                    value={form.testCommand}
                    onChange={(e) => update('testCommand', e.target.value)}
                    required
                  />
                  <datalist id="test-command-options">
                    {TEST_COMMAND_OPTIONS.map((command) => (
                      <option key={command} value={command} />
                    ))}
                  </datalist>
                  <p className="text-xs text-muted-foreground">
                    AI-TestOps 일반 실행은 <span className="font-mono">playwright test</span> 명령에
                    <span className="font-mono"> --project=chromium --retries=0</span>을 기본 적용합니다.
                  </p>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Working Directory</Label>
                  <Input
                    value={form.workingDirectory}
                    onChange={(e) => update('workingDirectory', e.target.value)}
                    placeholder="."
                    required
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Timeout (초)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={86400}
                    value={form.timeout}
                    onChange={(e) => update('timeout', Number(e.target.value))}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Parallel Limit</Label>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={form.parallelLimit}
                    onChange={(e) => update('parallelLimit', Number(e.target.value))}
                  />
                </div>
                <div className="space-y-2 md:col-span-6">
                  <Label>Base URL</Label>
                  <Input
                    value={form.baseUrl}
                    onChange={(e) => update('baseUrl', e.target.value)}
                    placeholder="https://example.com"
                    type="url"
                  />
                </div>
              </div>
            </FormSection>

            <FormSection icon={ClipboardPaste} title="환경변수">
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  테스트 실행 시 Runner에 전달됩니다. <span className="font-mono">BASE_URL</span>은 위 Base URL 값이 우선입니다.
                </p>
                <div className="flex flex-wrap gap-1">
                  {SUGGESTED_ENV_KEYS.filter((key) => key !== 'BASE_URL').map((key) => (
                    <button
                      key={key}
                      type="button"
                      className="rounded border border-border bg-card px-2 py-0.5 font-mono text-xs hover:bg-accent"
                      onClick={() => addSuggestedEnv(key)}
                    >
                      + {key}
                    </button>
                  ))}
                </div>
                <div className="rounded-lg border border-border bg-card p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label>.env / JSON 붙여넣기</Label>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={applyBulkEnvText}
                      disabled={!bulkEnvText.trim()}
                    >
                      <ClipboardPaste className="h-3 w-3 mr-1" />
                      적용
                    </Button>
                  </div>
                  <textarea
                    className="flex min-h-[80px] w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    value={bulkEnvText}
                    onChange={(e) => setBulkEnvText(e.target.value)}
                    placeholder={'KEY=value\n# comment\n또는 {"KEY":"value"}'}
                    spellCheck={false}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>변수</Label>
                    <Button type="button" size="sm" variant="outline" onClick={() => addEnvRow()}>
                      <Plus className="h-3 w-3 mr-1" />
                      행 추가
                    </Button>
                  </div>
                  <div className="max-h-[220px] overflow-y-auto space-y-2 rounded-lg border border-border bg-card p-3">
                    {envEntries.map((row, index) => (
                      <div key={index} className="flex items-start gap-2">
                        <Input
                          className="font-mono text-xs flex-1"
                          placeholder="KEY"
                          value={row.key}
                          onChange={(e) => updateEnvEntry(index, { key: e.target.value })}
                        />
                        <Input
                          className="font-mono text-xs flex-[1.5]"
                          placeholder="value"
                          type={isSecretEnvKey(row.key) ? 'password' : 'text'}
                          value={row.value}
                          onChange={(e) => updateEnvEntry(index, { value: e.target.value })}
                          autoComplete="off"
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="shrink-0 px-2"
                          onClick={() => removeEnvRow(index)}
                          aria-label="환경변수 행 삭제"
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
                {envError && <p className="text-sm text-destructive">{envError}</p>}
              </div>
            </FormSection>

            <FormSection icon={Server} title="Runner">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="space-y-3">
                  <ToggleRow
                    checked={form.dockerEnabled}
                    onChange={(checked) => update('dockerEnabled', checked)}
                    title="Docker Runner 사용"
                    detail="프로젝트별 Node/Playwright 컨테이너에서 테스트를 실행합니다."
                  />
                  <ToggleRow
                    checked={form.loginEnvRequired}
                    onChange={(checked) => update('loginEnvRequired', checked)}
                    title="테스트 계정 환경변수 필요"
                    detail="목록과 설정 화면에서 환경변수 확인 상태를 표시합니다."
                  />
                </div>
                <div className="space-y-2">
                  <Label>Lifecycle</Label>
                  <div
                    className={cn(
                      'grid grid-cols-2 rounded-lg bg-muted p-1',
                      !form.dockerEnabled && 'opacity-50'
                    )}
                  >
                    <SegmentedButton
                      active={form.runnerLifecycle === 'PERSISTENT'}
                      onClick={() => update('runnerLifecycle', 'PERSISTENT')}
                    >
                      상주
                    </SegmentedButton>
                    <SegmentedButton
                      active={form.runnerLifecycle === 'EPHEMERAL'}
                      onClick={() => form.dockerEnabled && update('runnerLifecycle', 'EPHEMERAL')}
                    >
                      일회용
                    </SegmentedButton>
                  </div>
                </div>
              </div>
            </FormSection>

            <FormSection icon={LogIn} title="로그인 선행 시나리오">
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  로그인 화면을 매 실행마다 거치지 않도록, 지정한 spec을 먼저 실행해 세션(storageState)을 만들고
                  이후 테스트들이 재사용하게 합니다. 비워두면 이 기능을 사용하지 않고 기존과 동일하게 동작합니다.
                </p>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-6">
                  <div className="space-y-2 md:col-span-4">
                    <Label>로그인 선행 spec 경로</Label>
                    <Input
                      value={form.loginSetupSpecPath}
                      onChange={(e) => update('loginSetupSpecPath', e.target.value)}
                      placeholder="tests/login.setup.ts"
                      className="font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>세션 유효 시간(분)</Label>
                    <Input
                      type="number"
                      min={1}
                      value={form.storageStateMaxAgeMinutes}
                      onChange={(e) => update('storageStateMaxAgeMinutes', Number(e.target.value))}
                      disabled={!form.loginSetupSpecPath.trim()}
                    />
                  </div>
                </div>
                {form.loginSetupSpecPath.trim() && (
                  <p className="text-xs text-warning">
                    지정한 spec은 로그인 완료 후 반드시{' '}
                    <span className="font-mono">
                      await context.storageState({'{'} path: process.env.PLAYOPS_STORAGE_STATE_OUTPUT {'}'})
                    </span>
                    을 호출해 세션을 저장해야 합니다.
                  </p>
                )}
              </div>
            </FormSection>

            <FormSection icon={Github} title="GitHub 저장소 연동">
              <div className="space-y-3">
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  연동하면 격리된 샌드박스 컨테이너(github.com 계열 호스트로만 네트워크 접근 허용)에서
                  저장소를 clone합니다. 토큰은 서버에 암호화되어 저장되며 화면에 다시 표시되지 않습니다.
                </p>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-6">
                  <div className="space-y-2 md:col-span-4">
                    <Label>Repository URL</Label>
                    <Input
                      value={form.repositoryUrl}
                      onChange={(e) => update('repositoryUrl', e.target.value)}
                      placeholder="https://github.com/owner/repo"
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>브랜치</Label>
                    <Input
                      value={form.repositoryBranch}
                      onChange={(e) => update('repositoryBranch', e.target.value)}
                      placeholder="기본 브랜치"
                      disabled={!form.repositoryUrl.trim()}
                    />
                  </div>
                  <div className="space-y-2 md:col-span-6">
                    <Label>
                      Personal Access Token
                      {initial?.repositoryConnected && (
                        <span className="ml-1 font-normal text-muted-foreground">
                          (변경할 때만 입력, 비워두면 기존 토큰 유지)
                        </span>
                      )}
                    </Label>
                    <Input
                      type="password"
                      value={form.repositoryToken}
                      onChange={(e) => update('repositoryToken', e.target.value)}
                      placeholder={
                        initial?.repositoryConnected
                          ? '변경하려면 새 토큰 입력'
                          : 'ghp_... (Public 저장소는 비워둘 수 있음)'
                      }
                      autoComplete="off"
                      disabled={!form.repositoryUrl.trim()}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      참고: Public 저장소는 토큰 없이 주소만으로 clone됩니다. Private 저장소일 때만 git 인증용으로
                      필요합니다 — GitHub API 키가 아니라, git clone 시 자격 증명으로만 쓰입니다.
                    </p>
                  </div>
                </div>
                {!initial && form.repositoryUrl.trim() && (
                  <p className="text-xs text-warning">
                    저장소를 연동하면 아래 초기 소스 템플릿 스캐폴딩은 건너뛰고 clone한 소스를 사용합니다.
                  </p>
                )}
              </div>
            </FormSection>

            {!initial && !form.repositoryUrl.trim() && (
              <FormSection icon={Play} title="초기 소스">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_240px]">
                  <div className="space-y-2">
                    <Label>Playwright 템플릿</Label>
                    <select
                      className={selectClass}
                      value={form.templateId}
                      onChange={(e) => update('templateId', e.target.value)}
                    >
                      {templates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                      {templates.length === 0 && <option value="default">기본 템플릿</option>}
                    </select>
                    <p className="text-xs text-muted-foreground">
                      {selectedTemplate?.description ?? 'package.json, playwright.config, 샘플 spec을 생성합니다.'}
                    </p>
                  </div>
                  <div className="pt-6">
                    <ToggleRow
                      checked={form.scaffoldOnCreate}
                      onChange={(checked) => update('scaffoldOnCreate', checked)}
                      title="기본 테스트 생성"
                    />
                  </div>
                </div>

                <div className="space-y-3 rounded-lg border border-ai-accent/30 bg-ai-accent/5 p-3">
                  <ToggleRow
                    checked={aiBootstrapEnabled}
                    onChange={setAiBootstrapEnabled}
                    title="AI로 초기 테스트 케이스 생성"
                  />
                  <p className="text-xs text-muted-foreground">
                    등록 직후 AI가 이 사이트에 맞는 첫 테스트 케이스를 만들고, 곧바로 실제로 실행해서
                    통과하는지까지 보여줍니다.
                  </p>
                  {aiBootstrapEnabled && (
                    <textarea
                      rows={3}
                      value={aiBootstrapInstruction}
                      onChange={(e) => setAiBootstrapInstruction(e.target.value)}
                      className="w-full rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ai-accent"
                      placeholder="예: 메인 페이지가 정상적으로 열리고 제목이 보이는지 확인해줘."
                    />
                  )}
                </div>
              </FormSection>
            )}

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border bg-card px-6 py-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              취소
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              저장
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
