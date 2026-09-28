import { useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  ClipboardPaste,
  Github,
  Globe,
  Loader2,
  LogIn,
  Package,
  Play,
  Plus,
  Server,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import type { PlaywrightTemplate, Project, ProjectFormData, SiteCheckResult } from '@/types';
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
  'flex h-12 w-full rounded-sm border border-border bg-card px-3.5 text-[15px] text-foreground hover:border-border-strong';

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

/** 실행 방식 — 사람이 고르는 말로 바꾼 Docker 조합. */
type RunMode = 'SERVER' | 'EPHEMERAL' | 'PERSISTENT';

const RUN_MODES: { id: RunMode; title: string; detail: string }[] = [
  {
    id: 'SERVER',
    title: '서버에서 바로 실행',
    detail: '준비 과정 없이 테스트 서버에서 실행합니다. 가장 간단합니다.',
  },
  {
    id: 'EPHEMERAL',
    title: '일회용 컨테이너',
    detail: '매번 새 컨테이너에서 깨끗하게 실행합니다. 느리지만 실행끼리 영향을 주지 않습니다.',
  },
  {
    id: 'PERSISTENT',
    title: '상주 컨테이너',
    detail: '컨테이너를 띄워두고 재사용합니다. 반복 실행이 빠릅니다.',
  },
];

function runModeOf(form: ProjectFormData): RunMode {
  if (!form.dockerEnabled) return 'SERVER';
  return form.runnerLifecycle === 'EPHEMERAL' ? 'EPHEMERAL' : 'PERSISTENT';
}

/** 서버가 받는 ID 규칙 — 영문 소문자 · 숫자 · 하이픈, 3~100자, 양 끝은 영숫자. */
const PROJECT_ID_RULE = /^[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$/;
const PROJECT_ID_HELP = '영문 소문자 · 숫자 · 하이픈(-)만, 3~100자';

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
    .replace(/-+$/, '');
}

/** 주소에서 ID 후보를 만든다 (예: https://gyengju-go.web.app → gyengju-go-web-app) */
function slugifyHost(baseUrl: string): string {
  try {
    return slugify(new URL(baseUrl.trim()).hostname.replace(/^www\./, ''));
  } catch {
    return '';
  }
}

/**
 * 이름으로 ID를 만들고, 한글 이름처럼 영문이 모자라면 사이트 주소에서 만든다.
 * 둘 다 안 되면 빈 값을 돌려주고 사용자가 직접 적게 한다.
 */
function autoProjectId(projectName: string, baseUrl: string): string {
  const fromName = slugify(projectName);
  if (fromName.length >= 3) return fromName;
  const fromHost = slugifyHost(baseUrl);
  return fromHost.length >= 3 ? fromHost : '';
}

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
    <section className="rounded-md border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-[15px] font-bold text-foreground">{title}</h3>
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
        'flex w-full items-center justify-between gap-4 rounded-sm border px-3 py-2.5 text-left text-[15px] transition-colors',
        checked ? 'border-primary bg-primary-subtle' : 'border-border bg-card hover:bg-accent'
      )}
    >
      <span className="min-w-0">
        <span className="block font-bold text-foreground">{title}</span>
        {detail && <span className="mt-0.5 block text-[13px] text-muted-foreground">{detail}</span>}
      </span>
      <span
        className={cn(
          'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-xs border-2',
          checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border-strong bg-card'
        )}
      >
        {checked && <Check className="h-3 w-3" />}
      </span>
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
    return '설치 명령어를 입력하세요. (고급 설정 > 실행 환경)';
  }
  if (!form.testCommand.trim()) {
    return '테스트 명령어를 입력하세요. (고급 설정 > 실행 환경)';
  }
  if (!form.workingDirectory.trim()) {
    return '작업 디렉터리를 입력하세요. (고급 설정 > 실행 환경)';
  }
  if (form.timeout < 1 || form.timeout > 86400) {
    return '제한 시간은 1~86400초 사이로 입력하세요.';
  }
  if (form.parallelLimit < 1 || form.parallelLimit > 100) {
    return '동시 실행 수는 1~100 사이로 입력하세요.';
  }
  if (form.baseUrl.trim()) {
    try {
      const url = new URL(form.baseUrl);
      if (!['http:', 'https:'].includes(url.protocol)) {
        return '사이트 주소는 http 또는 https로 시작해야 합니다.';
      }
    } catch {
      return '사이트 주소 형식이 올바르지 않습니다.';
    }
  }
  if (form.repositoryUrl.trim() && !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?\/?$/.test(form.repositoryUrl.trim())) {
    return 'GitHub 주소는 https://github.com/{owner}/{repo} 형식이어야 합니다.';
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
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [projectIdTouched, setProjectIdTouched] = useState(false);
  const [siteCheck, setSiteCheck] = useState<SiteCheckResult | null>(null);
  const [checkingSite, setCheckingSite] = useState(false);

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
    setSiteCheck(null);
    setCheckingSite(false);
    setAdvancedOpen(false);
    setProjectIdTouched(Boolean(initial));
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
      // 새 프로젝트에서는 이름 · 주소를 적으면 ID를 자동으로 만들어 준다.
      if (!initial && !projectIdTouched && (key === 'projectName' || key === 'baseUrl')) {
        const generated = autoProjectId(next.projectName, next.baseUrl);
        if (generated) next.projectId = generated;
      }
      return next;
    });
    if (key === 'baseUrl') setSiteCheck(null);
  };

  const selectRunMode = (mode: RunMode) => {
    setForm((prev) => ({
      ...prev,
      dockerEnabled: mode !== 'SERVER',
      runnerLifecycle: mode === 'EPHEMERAL' ? 'EPHEMERAL' : 'PERSISTENT',
    }));
  };

  const handleSiteCheck = async () => {
    const url = form.baseUrl.trim();
    if (!url || checkingSite) return;
    setCheckingSite(true);
    setSiteCheck(null);
    try {
      setSiteCheck(await api.checkSite(url));
    } catch (err) {
      // 서버가 응답하지 않는 경우(점검 중 등) — 사이트 문제와 구분해서 알려준다.
      setSiteCheck({
        reachable: false,
        message: `확인하지 못했습니다 — ${err instanceof Error ? err.message : '서버 응답 없음'}`,
      });
    } finally {
      setCheckingSite(false);
    }
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

    if (!initial && !form.baseUrl.trim() && !form.repositoryUrl.trim()) {
      setError('테스트할 사이트 주소를 입력하세요. 기존 테스트 코드가 있다면 GitHub 주소만 넣어도 됩니다.');
      setLoading(false);
      return;
    }
    if (!PROJECT_ID_RULE.test(form.projectId.trim())) {
      setError(
        form.projectId.trim()
          ? `주소로 쓸 프로젝트 ID "${form.projectId.trim()}" 는 사용할 수 없습니다. ${PROJECT_ID_HELP}로 지어주세요.`
          : `주소로 쓸 프로젝트 ID를 입력하세요. ${PROJECT_ID_HELP}.`
      );
      setAdvancedOpen(true);
      setLoading(false);
      return;
    }
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
  const creating = !initial;
  const runMode = runModeOf(form);
  // 이름이 한글뿐이면 주소를 자동으로 만들 수 없으므로 ID 칸을 앞에 내놓는다.
  const needsManualId = creating && Boolean(form.projectName.trim()) && !PROJECT_ID_RULE.test(form.projectId.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden">
        <DialogHeader className="border-b border-border px-6 py-5">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {creating
              ? '테스트할 사이트만 알려주면 나머지는 기본값으로 시작합니다. 등록 후 설정에서 언제든 바꿀 수 있습니다.'
              : '프로젝트 정보와 실행 방식을 수정합니다.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex max-h-[calc(90vh-96px)] flex-col">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-background px-6 py-5">
            {/* 1. 무엇을 테스트할 것인가 */}
            <section className="space-y-4 rounded-md border border-border bg-card p-5">
              <div className="space-y-2">
                <Label htmlFor="baseUrl">테스트할 사이트 {creating && <span className="text-destructive">*</span>}</Label>
                <div className="flex gap-2">
                  <Input
                    id="baseUrl"
                    value={form.baseUrl}
                    onChange={(e) => update('baseUrl', e.target.value)}
                    placeholder="https://shop.example.com"
                    autoFocus={creating}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleSiteCheck}
                    disabled={!form.baseUrl.trim() || checkingSite}
                    className="shrink-0"
                  >
                    {checkingSite ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
                    확인
                  </Button>
                </div>
                {siteCheck && (
                  <p
                    className={cn(
                      'flex items-start gap-1.5 text-[13px]',
                      siteCheck.reachable ? 'text-success' : 'text-destructive'
                    )}
                  >
                    {siteCheck.reachable ? (
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    )}
                    <span>
                      {siteCheck.reachable
                        ? `열렸습니다${siteCheck.title ? ` · ${siteCheck.title}` : ''}`
                        : siteCheck.message ?? `응답 코드 ${siteCheck.statusCode ?? '-'}`}
                    </span>
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>환경</Label>
                <div className="grid grid-cols-3 gap-2">
                  {([['DEV', '개발'], ['TEST', '테스트'], ['PROD', '운영']] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => update('serverType', value)}
                      className={cn(
                        'h-10 rounded-sm border text-[15px] font-bold transition-colors',
                        form.serverType === value
                          ? 'border-primary bg-primary-subtle text-primary'
                          : 'border-border bg-card text-muted-foreground hover:bg-accent'
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-[13px] text-muted-foreground">
                  목록에서 이 기준으로 모아 볼 수 있습니다. 나중에 설정에서 바꿔도 됩니다.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="projectName">프로젝트 이름 <span className="text-destructive">*</span></Label>
                <Input
                  id="projectName"
                  value={form.projectName}
                  onChange={(e) => update('projectName', e.target.value)}
                  placeholder="쇼핑몰 결제 테스트"
                  required
                />
                {creating && (
                  needsManualId ? (
                    <div className="space-y-1.5 rounded-sm border border-border bg-muted p-3">
                      <Label htmlFor="projectIdInline" className="text-[13px]">
                        주소로 쓸 이름을 영문으로 지어주세요 ({PROJECT_ID_HELP})
                      </Label>
                      <Input
                        id="projectIdInline"
                        className="h-10 font-mono text-[13px]"
                        value={form.projectId}
                        onChange={(e) => {
                          setProjectIdTouched(true);
                          update('projectId', e.target.value);
                        }}
                        placeholder="shop-checkout"
                      />
                    </div>
                  ) : (
                    <p className="text-[13px] text-muted-foreground">
                      주소: <span className="font-mono">/projects/{form.projectId || '...'}</span>
                      <span className="ml-1">— 고급 설정에서 바꿀 수 있습니다.</span>
                    </p>
                  )
                )}
              </div>
            </section>

            {/* 2. 이미 짜둔 테스트 코드가 있나 */}
            <section className="space-y-3 rounded-md border border-border bg-card p-5">
              <div className="flex items-center gap-2">
                <Github className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-[15px] font-bold text-foreground">
                  GitHub 저장소 <span className="font-normal text-muted-foreground">(선택)</span>
                </h3>
              </div>
              <p className="text-[13px] text-muted-foreground">
                이미 짜둔 Playwright 테스트가 있다면 주소를 넣어주세요. 비워두면 기본 템플릿으로 새로 만들어 드립니다.
              </p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
                <div className="md:col-span-4">
                  <Input
                    value={form.repositoryUrl}
                    onChange={(e) => update('repositoryUrl', e.target.value)}
                    placeholder="https://github.com/owner/repo"
                  />
                </div>
                <div className="md:col-span-2">
                  <Input
                    value={form.repositoryBranch}
                    onChange={(e) => update('repositoryBranch', e.target.value)}
                    placeholder="브랜치 (기본값)"
                    disabled={!form.repositoryUrl.trim()}
                  />
                </div>
              </div>
              {form.repositoryUrl.trim() && (
                <div className="space-y-2">
                  <Label htmlFor="repoToken" className="text-[13px]">
                    Personal Access Token
                    {initial?.repositoryConnected && (
                      <span className="ml-1 font-normal text-muted-foreground">
                        (변경할 때만 입력, 비워두면 기존 토큰 유지)
                      </span>
                    )}
                  </Label>
                  <Input
                    id="repoToken"
                    type="password"
                    value={form.repositoryToken}
                    onChange={(e) => update('repositoryToken', e.target.value)}
                    placeholder={
                      initial?.repositoryConnected ? '변경하려면 새 토큰 입력' : 'ghp_... (Public 저장소는 비워두세요)'
                    }
                    autoComplete="off"
                  />
                  <p className="flex items-start gap-1.5 text-[13px] text-muted-foreground">
                    <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    격리된 샌드박스 컨테이너에서 clone하며, 토큰은 서버에 암호화되어 저장되고 화면에 다시 표시되지 않습니다.
                    Private 저장소일 때만 필요합니다.
                  </p>
                  {creating && (
                    <p className="text-[13px] text-warning">
                      저장소를 연동하면 템플릿 생성은 건너뛰고 clone한 소스를 사용합니다.
                    </p>
                  )}
                </div>
              )}
            </section>

            {/* 3. 어떻게 실행할 것인가 */}
            <section className="space-y-3 rounded-md border border-border bg-card p-5">
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-[15px] font-bold text-foreground">테스트 실행 방식</h3>
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                {RUN_MODES.map((mode) => {
                  const active = runMode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => selectRunMode(mode.id)}
                      className={cn(
                        'rounded-sm border p-3 text-left transition-colors',
                        active
                          ? 'border-primary bg-primary-subtle ring-1 ring-primary'
                          : 'border-border bg-card hover:bg-accent'
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
                            active ? 'border-primary' : 'border-border-strong'
                          )}
                        >
                          {active && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
                        </span>
                        <span className="text-[15px] font-bold text-foreground">{mode.title}</span>
                      </span>
                      <span className="mt-1.5 block text-[13px] leading-relaxed text-muted-foreground">
                        {mode.detail}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* 4. 첫 테스트를 AI가 만들까 */}
            {creating && !form.repositoryUrl.trim() && (
              <section className="space-y-3 rounded-md border border-ai-accent/40 bg-ai-accent/5 p-5">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-ai-accent" />
                  <h3 className="text-[15px] font-bold text-foreground">첫 테스트</h3>
                </div>
                <ToggleRow
                  checked={aiBootstrapEnabled}
                  onChange={setAiBootstrapEnabled}
                  title="등록 직후 AI가 첫 테스트를 만들고 실행해 봅니다"
                  detail="AI가 이 사이트를 열어보고 맞는 테스트 케이스를 만든 뒤, 실제로 실행해 통과하는지까지 보여줍니다."
                />
                {aiBootstrapEnabled && (
                  <textarea
                    rows={3}
                    value={aiBootstrapInstruction}
                    onChange={(e) => setAiBootstrapInstruction(e.target.value)}
                    className="w-full rounded-sm border border-border bg-card px-3.5 py-2.5 text-[15px] text-foreground"
                    placeholder="예: 메인 페이지가 정상적으로 열리고 제목이 보이는지 확인해줘."
                  />
                )}
              </section>
            )}

            {/* 5. 고급 설정 — 기본값이 이미 들어 있는 것들 */}
            <div className="rounded-md border border-border bg-card">
              <button
                type="button"
                onClick={() => setAdvancedOpen((prev) => !prev)}
                className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-accent"
                aria-expanded={advancedOpen}
              >
                <span className="min-w-0">
                  <span className="block text-[15px] font-bold text-foreground">고급 설정</span>
                  <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
                    Node {form.nodeVersion} · Playwright {form.playwrightVersion} · {form.packageManager.toLowerCase()} ·
                    제한 {form.timeout}초 · 환경변수 {envEntries.filter((row) => row.key.trim()).length}개
                  </span>
                </span>
                <ChevronDown
                  className={cn('h-5 w-5 shrink-0 text-muted-foreground transition-transform', advancedOpen && 'rotate-180')}
                />
              </button>

              {advancedOpen && (
                <div className="space-y-4 border-t border-border bg-background p-5">
                  <FormSection icon={Settings2} title="프로젝트 정보">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-6">
                      <div className="space-y-2 md:col-span-2">
                        <Label>프로젝트 ID</Label>
                        <Input
                          value={form.projectId}
                          onChange={(e) => {
                            setProjectIdTouched(true);
                            update('projectId', e.target.value);
                          }}
                          disabled={!creating}
                          className="font-mono text-[13px]"
                        />
                        <p className="text-[13px] text-muted-foreground">
                          {creating ? PROJECT_ID_HELP : '등록 후에는 바꿀 수 없습니다.'}
                        </p>
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <Label>목록 순서</Label>
                        <Input
                          type="number"
                          value={form.displayOrder}
                          onChange={(e) => update('displayOrder', Number(e.target.value))}
                        />
                      </div>
                      <div className="space-y-2 md:col-span-3">
                        <Label>담당자</Label>
                        <Input
                          value={form.managerName}
                          onChange={(e) => update('managerName', e.target.value)}
                          placeholder="이름"
                        />
                      </div>
                      <div className="space-y-2 md:col-span-3">
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
                          className="min-h-[72px] w-full rounded-sm border border-border bg-card px-3.5 py-2.5 text-[15px] text-foreground"
                          value={form.description}
                          onChange={(e) => update('description', e.target.value)}
                        />
                      </div>
                      <div className="space-y-2 md:col-span-3">
                        <Label>테스트 목적</Label>
                        <textarea
                          className="min-h-[72px] w-full rounded-sm border border-border bg-card px-3.5 py-2.5 text-[15px] text-foreground"
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
                        >
                          {PLAYWRIGHT_VERSION_OPTIONS.map((version) => (
                            <option key={version} value={version}>
                              {version}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <Label>패키지 매니저</Label>
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
                        <Label>설치 명령어</Label>
                        <Input
                          value={form.installCommand}
                          onChange={(e) => update('installCommand', e.target.value)}
                          className="font-mono text-[13px]"
                          list="install-commands"
                        />
                        <datalist id="install-commands">
                          {INSTALL_COMMANDS[form.packageManager].map((cmd) => (
                            <option key={cmd} value={cmd} />
                          ))}
                        </datalist>
                      </div>
                      <div className="space-y-2 md:col-span-3">
                        <Label>테스트 명령어</Label>
                        <Input
                          value={form.testCommand}
                          onChange={(e) => update('testCommand', e.target.value)}
                          className="font-mono text-[13px]"
                          list="test-commands"
                        />
                        <datalist id="test-commands">
                          {TEST_COMMAND_OPTIONS.map((cmd) => (
                            <option key={cmd} value={cmd} />
                          ))}
                        </datalist>
                        <p className="text-[13px] text-muted-foreground">
                          AI-TestOps 일반 실행은 <span className="font-mono">playwright test</span> 명령에
                          <span className="font-mono"> --project=chromium --retries=0</span>을 기본 적용합니다.
                        </p>
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <Label>작업 디렉터리</Label>
                        <Input
                          value={form.workingDirectory}
                          onChange={(e) => update('workingDirectory', e.target.value)}
                          className="font-mono text-[13px]"
                        />
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <Label>제한 시간(초)</Label>
                        <Input
                          type="number"
                          min={1}
                          value={form.timeout}
                          onChange={(e) => update('timeout', Number(e.target.value))}
                        />
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <Label>동시 실행 수</Label>
                        <Input
                          type="number"
                          min={1}
                          value={form.parallelLimit}
                          onChange={(e) => update('parallelLimit', Number(e.target.value))}
                        />
                      </div>
                    </div>
                  </FormSection>

                  <FormSection icon={ClipboardPaste} title="환경변수">
                    <div className="space-y-3">
                      <p className="text-[13px] text-muted-foreground">
                        테스트 실행 시 Runner에 전달됩니다. <span className="font-mono">BASE_URL</span>은 위 사이트 주소가
                        우선합니다. 로그인이 필요한 사이트라면 첫 실행에서 AI가 어떤 값이 필요한지 알려줍니다.
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {SUGGESTED_ENV_KEYS.filter((key) => key !== 'BASE_URL').map((key) => (
                          <button
                            key={key}
                            type="button"
                            className="rounded-xs border border-border bg-card px-2 py-1 font-mono text-[13px] hover:bg-accent"
                            onClick={() => addSuggestedEnv(key)}
                          >
                            + {key}
                          </button>
                        ))}
                      </div>
                      <div className="space-y-2 rounded-sm border border-border bg-card p-3">
                        <div className="flex items-center justify-between gap-2">
                          <Label>.env / JSON 붙여넣기</Label>
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            onClick={applyBulkEnvText}
                            disabled={!bulkEnvText.trim()}
                          >
                            <ClipboardPaste className="h-3 w-3" />
                            적용
                          </Button>
                        </div>
                        <textarea
                          className="flex min-h-[80px] w-full rounded-sm border border-border bg-background px-3 py-2 font-mono text-[13px] text-foreground"
                          value={bulkEnvText}
                          onChange={(e) => setBulkEnvText(e.target.value)}
                          placeholder={'KEY=value\n# comment\n또는 {"KEY":"value"}'}
                          spellCheck={false}
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label>변수</Label>
                          <Button type="button" size="xs" variant="outline" onClick={() => addEnvRow()}>
                            <Plus className="h-3 w-3" />
                            행 추가
                          </Button>
                        </div>
                        <div className="max-h-[220px] space-y-2 overflow-y-auto rounded-sm border border-border bg-card p-3">
                          {envEntries.map((row, index) => (
                            <div key={index} className="flex items-start gap-2">
                              <Input
                                className="h-10 flex-1 font-mono text-[13px]"
                                placeholder="KEY"
                                value={row.key}
                                onChange={(e) => updateEnvEntry(index, { key: e.target.value })}
                              />
                              <Input
                                className="h-10 flex-[1.5] font-mono text-[13px]"
                                placeholder="value"
                                type={isSecretEnvKey(row.key) ? 'password' : 'text'}
                                value={row.value}
                                onChange={(e) => updateEnvEntry(index, { value: e.target.value })}
                                autoComplete="off"
                              />
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="shrink-0"
                                onClick={() => removeEnvRow(index)}
                                aria-label="환경변수 행 삭제"
                              >
                                <Trash2 className="h-4 w-4 text-muted-foreground" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                      {envError && <p className="text-[15px] text-destructive">{envError}</p>}
                    </div>
                  </FormSection>

                  <FormSection icon={LogIn} title="로그인 선행 시나리오">
                    <div className="space-y-3">
                      <p className="text-[13px] text-muted-foreground">
                        로그인 화면을 매 실행마다 거치지 않도록, 지정한 spec을 먼저 실행해 세션(storageState)을 만들고
                        이후 테스트들이 재사용하게 합니다. 비워두면 사용하지 않습니다.
                      </p>
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-6">
                        <div className="space-y-2 md:col-span-4">
                          <Label>로그인 선행 spec 경로</Label>
                          <Input
                            value={form.loginSetupSpecPath}
                            onChange={(e) => update('loginSetupSpecPath', e.target.value)}
                            placeholder="tests/login.setup.ts"
                            className="font-mono text-[13px]"
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
                      <ToggleRow
                        checked={form.loginEnvRequired}
                        onChange={(checked) => update('loginEnvRequired', checked)}
                        title="테스트 계정 환경변수 필요"
                        detail="목록과 설정 화면에서 환경변수 확인 상태를 표시합니다."
                      />
                      {form.loginSetupSpecPath.trim() && (
                        <p className="text-[13px] text-warning">
                          지정한 spec은 로그인 완료 후 반드시{' '}
                          <span className="font-mono">
                            await context.storageState({'{'} path: process.env.PLAYOPS_STORAGE_STATE_OUTPUT {'}'})
                          </span>
                          을 호출해 세션을 저장해야 합니다.
                        </p>
                      )}
                    </div>
                  </FormSection>

                  {creating && !form.repositoryUrl.trim() && (
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
                          <p className="text-[13px] text-muted-foreground">
                            {selectedTemplate?.description ?? 'package.json, playwright.config, 샘플 spec을 생성합니다.'}
                          </p>
                        </div>
                        <div className="pt-7">
                          <ToggleRow
                            checked={form.scaffoldOnCreate}
                            onChange={(checked) => update('scaffoldOnCreate', checked)}
                            title="기본 테스트 생성"
                          />
                        </div>
                      </div>
                    </FormSection>
                  )}
                </div>
              )}
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-sm border border-destructive bg-destructive/10 px-4 py-3 text-[15px] text-destructive"
              >
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
              {creating ? '등록' : '저장'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
