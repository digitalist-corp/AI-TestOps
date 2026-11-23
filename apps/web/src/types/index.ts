export type PackageManager = 'NPM' | 'YARN' | 'PNPM';
export type DockerStatus = 'STOPPED' | 'RUNNING' | 'ERROR' | 'NOT_CONFIGURED';
export type RunnerActivity = 'IDLE' | 'TESTING' | 'UNAVAILABLE';
export type RunnerLifecycle = 'PERSISTENT' | 'EPHEMERAL';
export type UserRole = 'ADMIN' | 'USER';
/** 프로젝트 상태 (#117): 계획 · 실행 · 종료 */
export type ProjectStatus = 'PLANNED' | 'RUNNING' | 'CLOSED';

export interface Project {
  projectId: string;
  projectName: string;
  displayOrder: number;
  status: ProjectStatus;
  /** YYYY-MM-DD */
  startDate: string | null;
  endDate: string | null;
  description: string | null;
  testPurpose: string | null;
  managerName: string | null;
  managerContact: string | null;
  nodeVersion: string;
  playwrightVersion: string;
  packageManager: PackageManager;
  installCommand: string;
  testCommand: string;
  workingDirectory: string;
  envVariables: string;
  loginEnvRequired: boolean;
  loginSetupSpecPath: string | null;
  storageStateMaxAgeMinutes: number | null;
  timeout: number;
  parallelLimit: number;
  baseUrl: string | null;
  repositoryUrl: string | null;
  repositoryBranch: string | null;
  repositoryConnected: boolean;
  runnerLifecycle: RunnerLifecycle;
  dockerEnabled: boolean;
  dockerStatus: DockerStatus;
  runnerActivity: RunnerActivity;
  dockerContainerId: string | null;
  latestExecutionId: number | null;
  latestExecutionStatus: ExecutionStatus | null;
  latestExecutionAt: string | null;
  latestExecutionDurationMs: number | null;
  createdAt: string;
  updatedAt: string;
  /** 최근 수정한 사람 (#118). 기존 데이터면 null */
  updatedBy: number | null;
  updatedByName: string | null;
}

export interface RunnerContainer {
  name: string;
  containerId: string;
  image: string;
  dockerStatus: DockerStatus;
  containerType: 'DB' | 'PLAYOPS' | 'RUNNER' | 'OTHER' | string;
  projectId: string;
  knownProject: boolean;
  dockerEnabled: boolean;
  /** 프로젝트 상태 (러너가 프로젝트 것일 때) */
  projectStatus: ProjectStatus | null;
  activeExecution: boolean;
  reconnectable: boolean;
  removable: boolean;
  cpuPercent: string;
  memoryUsage: string;
  memoryPercent: string;
  netIo: string;
  blockIo: string;
  createdAt: string;
  startedAt: string;
  uptime: string;
}

export interface RunnerCleanupResult {
  removed: string[];
  skipped: string[];
}

export interface RunnerOperationLog {
  projectId: string;
  output: string;
  lineCount: number;
}

export interface RunnerCapacity {
  autoScaleEnabled: boolean;
  baseConcurrency: number;
  maxConcurrency: number;
  effectiveMaxConcurrency: number;
  queueCapacity: number;
  scaleDownIdleSeconds: number;
  poolSize: number;
  activeCount: number;
  queuedCount: number;
  remainingQueueCapacity: number;
  completedTaskCount: number;
  taskCount: number;
  largestPoolSize: number;
  scaleDownRule: string;
}

export interface RunnerCapacityFormData {
  autoScaleEnabled: boolean;
  baseConcurrency: number;
  maxConcurrency: number;
  queueCapacity: number;
  scaleDownIdleSeconds: number;
}

export interface DockerDiskUsageItem {
  type: string;
  totalCount: string;
  activeCount: string;
  size: string;
  reclaimable: string;
}

export interface DockerHostResource {
  hostName: string;
  osName: string;
  osVersion: string;
  osArch: string;
  hostAvailableProcessors: number | null;
  hostCpuLoadPercent: number | null;
  hostTotalMemoryBytes: number | null;
  hostFreeMemoryBytes: number | null;
  hostUsedMemoryBytes: number | null;
  storagePath: string;
  storageTotalBytes: number | null;
  storageUsableBytes: number | null;
  storageUsedBytes: number | null;
  dockerAvailable: boolean;
  dockerServerVersion: string;
  dockerOSType: string;
  dockerOperatingSystem: string;
  dockerCpuCount: number | null;
  dockerMemoryBytes: number | null;
  dockerRootDir: string;
  dockerDiskUsage: DockerDiskUsageItem[];
  message: string;
}

/** 우상단 알림 창의 알림 한 건. 사용자가 확인하고 지우면 사라진다. */
export interface AppNotification {
  id: number;
  kind: 'EXECUTION_FINISHED' | 'SCHEDULE_FINISHED' | 'SCHEDULE_FAILED' | string;
  level: 'SUCCESS' | 'ERROR' | 'INFO' | string;
  title: string;
  message: string | null;
  /** 누르면 이동할 웹 경로 */
  link: string | null;
  projectId: string | null;
  createdAt: string;
}

/** 공지사항 (#116). 게시 기간은 비우면 제한 없음 */
export interface Notice {
  id: number;
  title: string;
  content: string;
  pinned: boolean;
  visibleFrom: string | null;
  visibleUntil: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type NoticeRequest = Pick<Notice, 'title' | 'content' | 'pinned' | 'visibleFrom' | 'visibleUntil'>;

export type ServiceStatus = 'ONLINE' | 'OFFLINE' | 'DEGRADED';

export interface ServiceHealthItem {
  id: string;
  name: string;
  status: ServiceStatus;
  target: string;
  latencyMs: number | null;
  message: string | null;
}

export interface ServiceHealth {
  status: ServiceStatus;
  checkedAt: string;
  services: ServiceHealthItem[];
}

export interface ProjectFormData {
  /** 등록할 때만: 이 프로젝트의 PM. 비우면 등록한 관리자가 PM */
  pmUserId?: number;
  projectId: string;
  projectName: string;
  displayOrder: number;
  status: ProjectStatus;
  /** YYYY-MM-DD, 비우면 서버에서도 비운다 */
  startDate: string;
  endDate: string;
  description: string;
  testPurpose: string;
  managerName: string;
  managerContact: string;
  nodeVersion: string;
  playwrightVersion: string;
  packageManager: PackageManager;
  installCommand: string;
  testCommand: string;
  workingDirectory: string;
  envVariables: string;
  loginEnvRequired: boolean;
  loginSetupSpecPath: string;
  storageStateMaxAgeMinutes: number;
  timeout: number;
  parallelLimit: number;
  baseUrl: string;
  repositoryUrl: string;
  repositoryBranch: string;
  // write-only: 비워두면 기존 토큰 유지, 값을 입력하면 교체. repositoryUrl을 지우면 연동 자체가 해제됨.
  repositoryToken: string;
  // 구조 분석이 읽을 앱 소스 저장소. 등록할 때만 보낸다 (이후 변경은 구조 탭에서).
  sourceRepositoryUrl: string;
  sourceRepositoryBranch: string;
  sourceRepositoryToken: string;
  runnerLifecycle: RunnerLifecycle;
  dockerEnabled: boolean;
  templateId: string;
  scaffoldOnCreate: boolean;
}

export interface AuthStateStatus {
  configured: boolean;
  loginSetupSpecPath: string | null;
  maxAgeMinutes: number | null;
  exists: boolean;
  updatedAt: string | null;
  expiresAt: string | null;
}

export interface PlaywrightTemplate {
  id: string;
  name: string;
  description: string;
  default: boolean;
  files: string[];
  custom: boolean;
  editable: boolean;
  deletable: boolean;
}

export interface PlaywrightTemplateFormData {
  id: string;
  name: string;
  description: string;
}

export interface ScaffoldResult {
  projectId: string;
  templateId: string;
  filesCreated: string[];
  skipped: boolean;
}

export type ExecutionStatus = 'SCHEDULED' | 'PENDING' | 'RUNNING' | 'CANCEL_REQUESTED' | 'CANCELLED' | 'PASSED' | 'FAILED' | 'ERROR';

export interface ScenarioCaseNode {
  type: 'DESCRIBE' | 'TEST' | string;
  title: string;
  sourceName?: string | null;
  line: number;
  grep: string;
  enabled: boolean;
  children: ScenarioCaseNode[];
}

export interface ScenarioSpecFile {
  path: string;
  caseCount: number;
  enabled: boolean;
  cases: ScenarioCaseNode[];
}

export interface ScenarioTree {
  projectId: string;
  totalSpecs: number;
  totalCases: number;
  specs: ScenarioSpecFile[];
}

export interface TestSuite {
  id: number;
  projectId: string;
  name: string;
  specPaths: string[];
  grep: string | null;
  caseCount: number;
  sequential: boolean;
  createdAt: string;
}

export interface TestSuiteRequest {
  name: string;
  specPaths: string[];
  grep: string | null;
  caseCount: number;
  sequential: boolean;
}

export interface Execution {
  id: number;
  projectId: string;
  status: ExecutionStatus;
  grepFilter: string | null;
  specPath: string | null;
  caseTitle: string | null;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  durationMs: number | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  /** 결함 다시 실행이면 실패했던 원래 실행 (#82) */
  rerunOf?: number | null;
}

/** N차 테스트. 사용자가 돌린 실행을 순서대로 센 것 (실행 이력에서 계산). */
export interface TestRound {
  round: number;
  executionId: number;
  status: ExecutionStatus;
  title: string;
  source: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
}

/** 케이스가 그 케이스를 마지막으로 돌린 앞 차수와 비교해 어떻게 바뀌었나 */
export type RoundChange = 'NEW_FAIL' | 'STILL_FAIL' | 'FIXED' | 'STILL_PASS' | 'FIRST_RUN' | 'SKIPPED';

export interface TestRoundCase {
  specPath: string | null;
  caseTitle: string | null;
  status: 'PASSED' | 'FAILED' | 'SKIPPED';
  errorMessage: string | null;
  change: RoundChange;
  previousRound: number | null;
}

export interface TestRoundDetail {
  round: TestRound;
  previousRound: number | null;
  changes: Record<RoundChange, number>;
  cases: TestRoundCase[];
}

export interface ArtifactFile {
  path: string;
  name: string;
  type: string;
  size: number;
}

export interface ExecutionCaseResult {
  specPath: string | null;
  caseTitle: string | null;
  status: 'PASSED' | 'FAILED' | 'SKIPPED';
  durationMs: number | null;
  errorMessage: string | null;
}

export interface ExecutionDetail {
  execution: Execution;
  logOutput: string | null;
  artifacts: ArtifactFile[];
  htmlReportUrl: string | null;
  caseResults: ExecutionCaseResult[];
}

export interface ExecutionLogChunk {
  content: string;
  offset: number;
  finished: boolean;
  status: string;
}

export interface RunTestOptions {
  grep?: string;
  specPath?: string;
  specPaths?: string[];
  caseTitle?: string;
  sequential?: boolean;
  /** 테스트 탭에서 고른 케이스 · 묶음. 서버가 정확 일치 패턴을 만든다 */
  cases?: { specPath: string; grep: string; nodeType: 'TEST' | 'DESCRIBE' }[];
}

export interface ScenarioUsageRequest {
  nodeType: 'SPEC' | 'DESCRIBE' | 'TEST';
  specPath: string;
  grep?: string | null;
  enabled: boolean;
}

export interface User {
  id: number;
  username: string;
  displayName?: string | null;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

export interface UserAuditLog {
  id: number;
  actorUsername: string | null;
  action: 'CREATED' | 'DELETED' | 'ROLE_CHANGED' | 'PASSWORD_RESET' | 'SESSIONS_REVOKED';
  targetUsername: string | null;
  detail: string | null;
  createdAt: string;
}

/** 프로젝트 멤버. role: PM · MEMBER(팀원) */
export interface ProjectMember {
  userId: number;
  username: string;
  displayName: string | null;
  role: 'PM' | 'MEMBER';
}

export interface UserCandidate {
  id: number;
  username: string;
  displayName: string | null;
}

export interface AuthUser {
  token: string;
  username: string;
  role: UserRole;
}

export type UserLevel = 'NON_DEVELOPER' | 'JUNIOR' | 'SENIOR';

export interface AiAnalysisRequest {
  executionId?: number;
  userLevel: UserLevel;
  additionalContext?: string;
}

export interface AiAnalysisResponse {
  summary: string;
  detailedExplanation: string;
  recommendedCodeFix: string;
  preventionTips: string;
  userLevel: UserLevel;
  rawAiResponse: string;
}

export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** 클라이언트에서 생성한 오류 안내 메시지. 서버 히스토리로는 보내지 않는다. */
  error?: boolean;
  /** 이 답변을 만드는 동안 AI가 실제로 수행하거나 제안한 작업. */
  actions?: AiChatAction[];
}

/**
 * AI가 대화 중에 수행한 작업 한 건.
 *
 * FIX_TEST · GENERATE_SCENARIO 는 AI 작업이 만들어진 것으로, 사람이 승인해야 반영된다.
 * RUN_PROPOSAL 은 아직 아무것도 하지 않은 상태의 실행 제안이다.
 */
export interface AiChatAction {
  type: 'FIX_TEST' | 'GENERATE_SCENARIO' | 'RUN_PROPOSAL';
  status: 'CREATED' | 'PROPOSED' | 'FAILED';
  label: string;
  detail?: string | null;
  jobId?: number | null;
  projectId?: string | null;
  specPath?: string | null;
  grep?: string | null;
}

export interface AiChatResponse {
  answer: string;
  actions?: AiChatAction[];
}

export interface AiChatRequest {
  executionId?: number;
  /** 지금 열어 둔 프로젝트. 서버가 이 프로젝트의 최근 실행 로그를 스스로 찾아 붙인다. */
  projectId?: string;
  question: string;
  userLevel: UserLevel;
  provider?: AiModelProvider;
  /** 이전 대화 턴(오래된 순). 서버는 최근 20개만 사용한다. */
  history?: AiChatMessage[];
}

export const DEFAULT_PROJECT_FORM: ProjectFormData = {
  projectId: '',
  projectName: '',
  displayOrder: 0,
  status: 'PLANNED',
  startDate: '',
  endDate: '',
  description: '',
  testPurpose: '',
  managerName: '',
  managerContact: '',
  nodeVersion: '22',
  playwrightVersion: '1.53.0',
  packageManager: 'NPM',
  installCommand: 'npm install',
  testCommand: 'npx playwright test --project=chromium',
  workingDirectory: '.',
  envVariables: '{}',
  loginEnvRequired: false,
  loginSetupSpecPath: '',
  storageStateMaxAgeMinutes: 720,
  timeout: 300,
  parallelLimit: 1,
  baseUrl: '',
  repositoryUrl: '',
  repositoryBranch: '',
  repositoryToken: '',
  sourceRepositoryUrl: '',
  sourceRepositoryBranch: '',
  sourceRepositoryToken: '',
  runnerLifecycle: 'PERSISTENT',
  dockerEnabled: false,
  templateId: 'default',
  scaffoldOnCreate: true,
};

export interface AiAvailability {
  claude: boolean;
  gpt: boolean;
  anyConfigured: boolean;
  defaultProvider: 'CLAUDE' | 'GPT';
}

export interface SiteCheckResult {
  reachable: boolean;
  statusCode?: number | null;
  title?: string | null;
  finalUrl?: string | null;
  message?: string | null;
}

export type AiModelProvider = 'CLAUDE' | 'GPT';

export interface AiTemplateRequest {
  userPrompt: string;
  targetUrl?: string;
  templateName?: string;
  provider?: AiModelProvider;
}

export interface AiTemplateResponse {
  templateName: string;
  description: string;
  files: {
    filename: string;
    content: string;
  }[];
}

export type AiBootstrapPhase =
  | 'ANALYZING_SITE'
  | 'NEEDS_CREDENTIALS'
  | 'LOGGING_IN'
  | 'GENERATING'
  | 'RUNNING'
  | 'HEALING'
  | 'PASSED'
  | 'FAILED'
  | 'ERROR';

export interface AiBootstrapLoginField {
  name: string | null;
  label: string | null;
  type: string | null;
}

export interface AiBootstrapProgressEvent {
  ts?: string | null;
  type: 'visit' | 'screen' | 'login_form' | 'login_failed' | 'warning' | 'done' | string;
  url?: string | null;
  depth?: number | null;
  title?: string | null;
  elements?: number | null;
  screenshot?: string | null;
  message?: string | null;
  fields?: AiBootstrapLoginField[] | null;
}

export interface AiBootstrapCredentialRequest {
  url: string;
  fields: AiBootstrapLoginField[];
}

/** 첫 테스트 생성(사이트 탐색 → 코드 생성 → 실행 → 자율 교정)의 현재 상태. 시작 요청과 상태 조회가 같은 모양이다. */
export interface AiBootstrapResponse {
  bootstrapId: string;
  phase: AiBootstrapPhase;
  /** 지금(또는 마지막으로) 몇 번째 자율 교정인지. 0 이면 교정 없이 첫 실행 */
  healAttempt: number;
  maxHealAttempts: number;
  executionId: number | null;
  generatedFiles: string[];
  specPath: string | null;
  /** 1회 실행 예상 시간 (최근 실행 이력 평균) */
  estimatedDurationMs: number;
  /** 이번 생성에 쓴 사이트 탐색 결과. 이미 화면 정보가 있어 건너뛰었으면 null */
  siteAnalysis: { mode: 'DOM' | 'VISUAL_REQUIRED' | 'ERROR'; pages: number; verifiedSelectors: number } | null;
  warnings: string[];
  error: string | null;
  failureLog: string | null;
  startedAt: string;
  finishedAt: string | null;
  events?: AiBootstrapProgressEvent[];
  currentUrl?: string | null;
  visitedCount?: number;
  credentialRequest?: AiBootstrapCredentialRequest | null;
  /** 첫 실행 브리핑 상태. null 이면 아직 시작하지 않았거나 브리핑 자료 없이 ERROR 로 끝난 상태다. */
  briefingStatus?: 'PENDING' | 'READY' | 'FAILED' | null;
  /** READY 일 때 A2UI v1.0 메시지 배열 (docs/design/onboarding-briefing-contract.md). 그 밖에는 [] */
  briefing?: unknown[];
}

export interface AiEditAssistVerifyResponse {
  passed: boolean;
  log: string;
  durationMs: number;
  specPath: string;
}

export interface AiProviderSettingsResponse {
  claudeConfigured: boolean;
  claudeMasked: string;
  openaiConfigured: boolean;
  openaiMasked: string;
  claudeWorkspaceId?: string;
  updatedAt?: string;
  defaultProvider?: 'CLAUDE' | 'GPT';
  claudeInputPrice?: number | null;
  claudeOutputPrice?: number | null;
  openaiInputPrice?: number | null;
  openaiOutputPrice?: number | null;
}

export interface AiUsageProvider {
  provider: 'CLAUDE' | 'GPT';
  calls: number;
  failedCalls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  priceConfigured: boolean;
}

export interface AiUsageFeature {
  feature: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

export interface AiUsageSummary {
  days: number;
  from: string;
  totalCalls: number;
  estimatedCostUsd: number;
  priceConfigured: boolean;
  providers: AiUsageProvider[];
  features: AiUsageFeature[];
}

export interface AiProviderSettingsRequest {
  defaultProvider?: 'CLAUDE' | 'GPT';
  claudeInputPrice?: number;
  claudeOutputPrice?: number;
  openaiInputPrice?: number;
  openaiOutputPrice?: number;
  claudeApiKey?: string;
  openaiApiKey?: string;
  claudeWorkspaceId?: string;
}

export interface SlackSettingsResponse {
  configured: boolean;
  webhookUrlMasked: string;
  updatedAt?: string;
}

export interface SlackSettingsRequest {
  webhookUrl?: string;
}

export interface ExecutionSchedule {
  id: number;
  projectId: string;
  name?: string;
  specPath?: string;
  hour: number;
  minute: number;
  daysOfWeek: string;
  enabled: boolean;
  lastTriggeredAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionScheduleRequest {
  name?: string;
  specPath?: string;
  hour: number;
  minute: number;
  daysOfWeek: string;
  enabled: boolean;
}

export type AiJobType = 'CODE_FIX' | 'TEMPLATE_GENERATE' | 'TEST_ANALYSIS' | 'LEARNING_LOOP';
export type AiJobStatus =
  | 'PROPOSED' | 'PENDING' | 'RUNNING' | 'DIFF_READY' | 'NEEDS_REVIEW'
  | 'APPLIED' | 'REJECTED' | 'FAILED' | 'ERROR' | 'CANCELED' | 'TIMEOUT';

export type PostApplyVerificationStatus = 'PENDING' | 'PASSED' | 'REGRESSED' | 'SKIPPED';

export interface AiJob {
  id: number;
  projectId: string;
  jobType: AiJobType;
  status: AiJobStatus;
  aiModelProvider: AiModelProvider;
  instruction: string;
  targetSpecPath: string;
  changedFiles?: string[];
  failedExecutionId?: number;
  iterationsUsed: number;
  summary?: string;
  errorMessage?: string;
  riskFlags?: string;
  postApplyVerificationStatus?: PostApplyVerificationStatus;
  revertedAt?: string;
  appliedCommitSha?: string;
  createdAt: string;
  /** 승인 · 거부한 사람(사용자 id). 백엔드 AiJobResponse.reviewedBy (A10) */
  reviewedBy?: number | null;
  /** 학습 루프(LEARNING_LOOP)가 띄운 수정 작업이면 그 루프 작업 id */
  parentJobId?: number | null;
  /** 실패에서 자동으로 만든 제안 · 학습 루프가 띄운 수정. 예전 서버 응답에는 없다 */
  autoCreated?: boolean;
  updatedAt: string;
}

/** 학습 루프 원인 5종 (E-05). 서버 FailureRules.Cause */
export type FailureCause = 'PRODUCT_DEFECT' | 'SCRIPT_ERROR' | 'ENVIRONMENT' | 'FLAKY' | 'UNCLASSIFIED';

/** 같은 원인으로 묶인 실패 (E-04). recalled 는 사람이 승인했던 비슷한 수정 (V22) */
export interface FailureCluster {
  signature: string;
  head: string;
  locator: string | null;
  specPath: string;
  cause: FailureCause;
  causeSource: 'RULE' | 'HUMAN';
  summary: string | null;
  count: number;
  cases: string[];
  sampleError: string;
  pastFixes: number;
  recalled: { aiJobId: number; specPath: string; cause: string; head: string; locator: string | null; diff: string; createdAt: string }[];
}

export interface AiJobFileDiff {
  path: string;
  content: string;
}

export interface CreateAiJobRequest {
  failedExecutionId?: number;
  targetSpecPath: string;
  instruction: string;
}

/** 저장소 코드 분석으로 만든 화면 구조. */
export interface SiteMapSource {
  url: string | null;
  branch: string | null;
  tokenSet: boolean;
  /** 소스 저장소를 따로 연결하지 않아 프로젝트 저장소를 읽는 경우 */
  usesProjectRepository: boolean;
  /** 프로젝트의 대상 사이트 주소. 있으면 소스 저장소 없이도 사이트 탐색을 할 수 있다 */
  siteUrl: string | null;
}

export interface SiteMapAnalysis {
  status: 'NONE' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  commitSha: string | null;
  /** URL 은 소스 저장소 없이 대상 사이트를 브라우저로 탐색한 결과 */
  framework: 'NEXT' | 'REACT_ROUTER' | 'URL' | null;
  partial: boolean;
  screenCount: number;
  /** 요소까지 읽은 화면 수 (진행 표시용) */
  processedCount: number;
  /** 이번 분석에서 AI 를 부른 횟수. 파일이 안 바뀐 화면은 부르지 않는다 */
  llmCalls: number;
  /** 남은 시간(초). 화면을 하나라도 읽은 뒤에만 나온다 */
  etaSeconds: number | null;
  warnings: string[];
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface SiteMapNode {
  routeKey: string;
  title: string | null;
  sourceFile: string | null;
  origin: string;
  /** 마지막 분석에서 코드에 없던 화면 */
  stale: boolean;
  elementCount: number;
  excluded: boolean;
  note: string | null;
  /** 사이트 탐색(origin=SITE)으로 실제로 연 주소 */
  url: string | null;
  hasScreenshot: boolean;
  /** 로그인해야 열리는 화면 */
  authRequired: boolean;
  /** 테스트 실행으로 확인된(PASSED) · 실패한(FAILED) 요소 수 */
  passedCount: number;
  failedCount: number;
  /** 실제 화면에서 본(OBSERVED) 요소 수. passed + failed + observed + unverified = elementCount */
  observedCount: number;
  /** 코드 분석으로만 찾은(UNVERIFIED) 요소 수. OBSERVED 는 빼고 센다 */
  unverifiedCount: number;
}

/** 구조 탭 "확인 지도" (docs/design/structure-coverage-contract.md) */
export type CoverageNodeState = 'TESTED' | 'OBSERVED' | 'UNSEEN' | 'BLOCKED';
export type CoverageEdgeState = 'TESTED' | 'OBSERVED' | 'FAILED' | 'UNKNOWN';
export type CoverageIssueKind = 'SELECTOR_FAILED' | 'LOGIN_REQUIRED' | 'OPEN_FAILED' | 'NOT_REACHED' | 'EXPLORE_STOPPED';
export type CoverageAction = 'SET_LOGIN' | 'RECORD_AGAIN' | 'FIX_WITH_AI' | 'RERUN' | 'NONE';
export type CoverageFlowSource = 'RECORDED' | 'GENERATED' | 'PATH' | 'OTHER';
export type CoverageFlowStatus = 'PASSED' | 'FAILED' | 'NEVER_RUN';
export type CoverageStepState = 'PASSED' | 'FAILED' | 'NOT_REACHED' | 'PENDING';

export type CoverageSummary = {
  /** 지도에 있는 화면 수 (excluded 제외) */
  screens: number;
  tested: number;
  observed: number;
  unseen: number;
  blocked: number;
  flows: number;
  /** 지도에 반영된 마지막 실행 시각 */
  lastRunAt: string | null;
};

export type CoverageIssue = {
  kind: CoverageIssueKind;
  /** 비개발자용 한국어 한 줄 */
  message: string;
  selector?: string | null;
  specPath?: string | null;
  executionId?: number | null;
  at?: string | null;
  action: CoverageAction;
};

export type CoverageNode = {
  routeKey: string;
  state: CoverageNodeState;
  counts: { passed: number; failed: number; observed: number; unseen: number; total: number };
  issues: CoverageIssue[];
};

export type CoverageEdge = {
  from: string;
  to: string;
  state: CoverageEdgeState;
};

export type CoverageFlowStep = {
  routeKey: string;
  state: CoverageStepState;
  message?: string | null;
};

export type CoverageFlow = {
  specPath: string;
  title: string;
  source: CoverageFlowSource;
  lastStatus: CoverageFlowStatus;
  lastRunAt: string | null;
  executionId: number | null;
  steps: CoverageFlowStep[];
};

export type Coverage = {
  summary: CoverageSummary;
  nodes: CoverageNode[];
  edges: CoverageEdge[];
  flows: CoverageFlow[];
};

export interface SiteMap {
  projectId: string;
  source: SiteMapSource;
  analysis: SiteMapAnalysis;
  nodes: SiteMapNode[];
  edges: SiteMapEdge[];
  layouts: SiteMapLayout[];
}

/** 여러 화면을 감싸는 공용 영역(상단 메뉴, 사이드바). routeKeys 의 화면 어디서든 links 의 화면으로 갈 수 있다. */
export interface SiteMapLayout {
  sourceFile: string;
  routeKeys: string[];
  elementCount: number;
  links: { to: string; label: string | null; selector: string | null }[];
}

/** 지금 돌고 있는 구조 분석 (프로젝트 목록 · 상단의 진행 배지용). */
export interface RunningAnalysis {
  projectId: string;
  screenCount: number;
  processedCount: number;
  etaSeconds: number | null;
}

export interface SiteMapEdge {
  from: string;
  to: string;
  kind: string;
  label: string | null;
  selector: string | null;
}

export interface SiteMapElement {
  kind: string | null;
  role: string | null;
  name: string | null;
  text: string | null;
  label: string | null;
  placeholder: string | null;
  testId: string | null;
  /** 코드에 있는 속성으로 조립한 Playwright 셀렉터. 만들 수 없으면 null */
  selector: string | null;
  selectorKind: string | null;
  /** 같은 화면에 셀렉터가 같은 요소가 또 있다 */
  duplicate: boolean;
  /** 목록 반복이나 조건에 따라 보이는 요소 */
  conditional: boolean;
  /** 코드 분석 요소의 위치. 사이트 탐색(SITE) 요소는 없다 */
  file?: string;
  line?: number | null;
  /** 사이트 탐색 요소의 순번 (forms 가 가리키는 값) */
  idx?: number;
  /** OBSERVED: 실제 사이트에서 이 요소 하나만 가리키는 것을 확인한 셀렉터 */
  verification: 'UNVERIFIED' | 'OBSERVED' | 'PASSED' | 'FAILED';
}

export interface SiteMapNodeDetail {
  node: SiteMapNode;
  elements: SiteMapElement[];
  edges: SiteMapEdge[];
  /** 사이트 탐색에서 모은 폼. fieldIdx · submitIdx 는 elements 의 idx 를 가리킨다 */
  forms: { idx: number; fieldIdx: number[]; submitIdx: number[] }[];
  /** 이 화면을 골라 만든 테스트와 마지막 실행 결과 (최근 실행 순) */
  tests: ScreenTestSummary[];
}

export interface ScreenTestSummary {
  specPath: string;
  /** 실행한 적이 없으면 null */
  lastStatus: 'PASSED' | 'FAILED' | 'SKIPPED' | null;
  lastRunAt: string | null;
  executionId: number | null;
  passedCases: number;
  failedCases: number;
}

/** AI 채팅 에이전트 세션 (docs/design/ai-chat-agent-contract.md) */
export type ChatSession = {
  id: number;
  projectId: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type StopReason = 'END' | 'CANCELLED' | 'MAX_TURNS' | 'ERROR';
export type ToolTier = 'READ' | 'RUN' | 'CHANGE';
export type ToolStatus = 'running' | 'ok' | 'error' | 'denied' | 'cancelled';
export type PermissionDecision = 'ALLOW' | 'ALLOW_SESSION' | 'DENY';

export type ToolDisplayTableData = {
  columns: string[];
  rows: (string | number | boolean | null)[][];
  truncated: boolean;
  sql?: string;
};

export type ToolDisplayCodeData = {
  path?: string;
  language?: string;
  content: string;
};

export type ToolDisplayJobData = {
  jobId: number;
  jobType: string;
  status: string;
  specPath?: string;
};

export type ToolDisplayExecutionData = {
  executionId: number;
  status: string;
  projectId: string;
};

export type ToolDisplayListData = {
  items: { label: string; detail?: string }[];
};

export type ToolDisplay =
  | { kind: 'table'; data: ToolDisplayTableData }
  | { kind: 'code'; data: ToolDisplayCodeData }
  | { kind: 'job'; data: ToolDisplayJobData }
  | { kind: 'execution'; data: ToolDisplayExecutionData }
  | { kind: 'list'; data: ToolDisplayListData };

export type ChatTextBlock = {
  type: 'text';
  text: string;
};

export type ChatToolPermission = {
  requestId: string;
  reason: string;
  decision?: PermissionDecision;
};

export type ChatToolBlock = {
  type: 'tool';
  callId: string;
  name: string;
  tier: ToolTier;
  input: Record<string, unknown>;
  status: ToolStatus;
  summary?: string;
  output?: string;
  display?: ToolDisplay;
  durationMs?: number;
  permission?: ChatToolPermission;
};

export type ChatBlock = ChatTextBlock | ChatToolBlock;

export type ChatUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type ChatMessage = {
  id: number;
  role: 'user' | 'assistant';
  createdAt: string;
  blocks: ChatBlock[]; // user 는 text 블록 하나
  stopReason?: StopReason; // assistant 만
  usage?: ChatUsage;
  errorMessage?: string;
};

export type ChatStreamEvent =
  | { type: 'message_start'; data: { userMessageId: number; messageId: number } }
  | { type: 'text_delta'; data: { delta: string } }
  | {
      type: 'tool_start';
      data: { callId: string; name: string; tier: ToolTier; input: Record<string, unknown> };
    }
  | {
      type: 'permission_request';
      data: {
        requestId: string;
        callId: string;
        name: string;
        input: Record<string, unknown>;
        reason: string;
      };
    }
  | { type: 'permission_resolved'; data: { requestId: string; decision: PermissionDecision } }
  | {
      type: 'tool_end';
      data: {
        callId: string;
        status: 'ok' | 'error' | 'denied' | 'cancelled';
        summary?: string;
        output?: string;
        display?: ToolDisplay;
        durationMs?: number;
      };
    }
  | { type: 'usage'; data: { inputTokens: number; outputTokens: number } }
  | { type: 'error'; data: { message: string } }
  | { type: 'message_end'; data: { messageId: number; stopReason: StopReason } };


// ── 클릭으로 테스트 만들기(녹화). 계약: docs/design/recorder-contract.md ──

export type RecorderStatus = 'STARTING' | 'READY' | 'BUSY' | 'CLOSED' | 'ERROR';

export type RecordedStepAction =
  | 'goto'
  | 'click'
  | 'fill'
  | 'press'
  | 'assertVisible'
  | 'assertText';

export interface RecordedStep {
  id: string;
  action: RecordedStepAction;
  /** Playwright 로케이터 식. 예: getByRole('button', { name: '로그인' }) */
  selector: string | null;
  /** .nth() 순번에 기대는 셀렉터 */
  fragile: boolean;
  /** 사람이 읽는 설명. 예: "'로그인' 버튼 클릭" */
  label: string;
  /** fill · press · assertText 의 값, goto 의 경로 */
  value?: string;
  /** 비밀번호 입력이면 값을 저장하지 않고 이 환경변수 이름으로 코드에 넣는다 */
  secretEnv?: string;
  /** 동작 직후 주소 */
  url: string;
}

/** inspect 응답에 붙는, 마우스 아래 요소 정보. box 는 viewport 좌표. */
export interface RecorderInspected {
  role: string | null;
  name: string | null;
  selector: string | null;
  fragile: boolean;
  tag: string;
  box: { x: number; y: number; width: number; height: number };
}

export interface RecorderViewport {
  width: number;
  height: number;
}

export interface RecorderState {
  sessionId: string;
  status: RecorderStatus;
  url: string | null;
  title: string | null;
  viewport: RecorderViewport;
  steps: RecordedStep[];
  /** 화면이 바뀔 때마다 1씩 증가. 화면은 이 값으로 다시 받는다 */
  screenshotVersion: number;
  error?: string | null;
  inspected?: RecorderInspected | null;
}

export type RecorderAction =
  | { type: 'click'; x: number; y: number }
  | { type: 'fill'; x: number; y: number; value: string }
  | { type: 'press'; key: string }
  | { type: 'goto'; url: string }
  | { type: 'assertVisible'; x: number; y: number }
  | { type: 'assertText'; x: number; y: number }
  | { type: 'scroll'; deltaY: number }
  | { type: 'inspect'; x: number; y: number };

export interface RecorderStartRequest {
  url?: string;
  useLogin?: boolean;
}

export interface RecorderCode {
  specPath: string;
  code: string;
}

/** 테스트 계획 표의 계획 행과 기존 테스트 케이스. */
export type PlanPriority = 'HIGH' | 'MEDIUM' | 'LOW';

export interface PlanItem {
  planId: number | null;
  stage: 'UNWRITTEN' | 'WRITTEN';
  screenRouteKey: string | null;
  expected: string | null;
  aiJobId: number | null;
  aiJobStatus: string | null;
  specPath: string;
  grep: string;
  title: string;
  describePath: string;
  line: number;
  enabled: boolean;
  /** 파일 · 상위 묶음이 모두 사용 중인지. false 면 이 행만 켜도 실행되지 않는다. */
  parentEnabled: boolean;
  sortOrder: number | null;
  /** 담당자 이름. assigneeUserId 가 없으면 계정과 잇지 못한 옛 이름 (#119) */
  assignee: string | null;
  assigneeUserId: number | null;
  /** YYYY-MM-DD */
  dueDate: string | null;
  priority: PlanPriority | null;
  lastStatus: 'PASSED' | 'FAILED' | null;
  lastRunAt: string | null;
  prevStatus: 'PASSED' | 'FAILED' | null;
  prevRunAt: string | null;
  defectStatus: DefectStatus | null;
  defectFailCount: number;
  /** 계획 칸을 마지막으로 고친 사람 · 때 (#118). 고친 적이 없으면 null */
  updatedByName: string | null;
  updatedAt: string | null;
}

/** 작성률과 완료율의 분모는 미작성을 포함한 사용 중 계획이다. */
export interface PlanSummary {
  total: number;
  enabled: number;
  disabled: number;
  passed: number;
  failed: number;
  notRun: number;
  completionRate: number;
  /** 사용 중 · 미작성 */
  unwritten: number;
  /** 사용 중 · 작성됨 */
  written: number;
  /** written ÷ enabled, 0~1 — 작성률 */
  writtenRate: number;
}

export interface PlanResponse {
  items: PlanItem[];
  summary: PlanSummary;
  /** 사용 중 행 기준 화면별 집계. 화면 = 계획 행의 화면, 없으면 그 테스트가 지나는 첫 화면 */
  screens: { routeKey: string; planned: number; written: number; passed: number; failed: number }[];
}

export interface PlanItemKey {
  planId?: number;
  specPath: string;
  grep: string;
}

export interface PlanEntryInput {
  title: string;
  screenRouteKey?: string | null;
  expected?: string | null;
  assigneeUserId?: number | null;
  dueDate?: string | null;
  priority?: PlanPriority | null;
}

export type PlanEntryPatch = Omit<PlanEntryInput, 'title'> & {
  title?: string | null;
  enabled?: boolean | null;
};

export interface PlanLinkTarget {
  specPath: string;
  grep: string;
}

export interface PlanLinkSuggestion extends PlanLinkTarget {
  planId: number;
  caseTitle: string;
  reason: string;
}

/** 케이스별 단계 기록 (#84 · #85). 문장은 서버가 규칙으로 만든다. offsetMs: 테스트 시작부터 그 단계까지 */
export interface StepRecord {
  text: string;
  category: string;
  status: 'PASSED' | 'FAILED';
  error: string | null;
  offsetMs: number | null;
}

/** path 는 실행 아티팩트 경로 */
export interface StepAttachment {
  name: string;
  contentType: string;
  path: string;
}

export interface CaseSteps {
  specPath: string;
  /** "파일 > 묶음 > 케이스" */
  title: string;
  status: 'PASSED' | 'FAILED' | 'SKIPPED';
  /** 실패한 단계 번호(0부터) */
  failedStep: number | null;
  steps: StepRecord[];
  attachments: StepAttachment[];
}

/** recorded=false: 단계 기록을 붙이기 전 실행 */
export interface StepsResponse {
  recorded: boolean;
  cases: CaseSteps[];
}

/** 결과 화면에서 펼쳐 보일 케이스 (결함을 눌렀을 때) */
export interface CaseFocus {
  specPath: string;
  title: string;
}

/** 통합 결함 리스트(F-4). 결함 = 사용 중 계획 항목의 실패. OPEN 미해결 · RESOLVED 실패 뒤 통과 */
export type DefectStatus = 'OPEN' | 'RESOLVED';

export interface DefectRun {
  executionId: number;
  status: 'PASSED' | 'FAILED';
  at: string | null;
  /** 결함 다시 실행이면 원래 실행 */
  rerunOf: number | null;
}

export interface Defect extends PlanItemKey {
  title: string;
  describePath: string;
  status: DefectStatus;
  assignee: string | null;
  assigneeUserId: number | null;
  /** 처음 발견한 뒤 실패한 실행 수 */
  failCount: number;
  firstFailedExecutionId: number;
  firstFailedAt: string | null;
  lastExecutionId: number;
  lastRunAt: string | null;
  resolvedExecutionId: number | null;
  resolvedAt: string | null;
  errorMessage: string | null;
  /** 테스트가 지나는 화면. 모르면 빈 배열 */
  routeKeys: string[];
  /** 발견 실행부터 오래된 순 */
  runs: DefectRun[];
}

/** open · resolved 는 돌려준 목록 안에서 센다 */
export interface DefectResponse {
  defects: Defect[];
  open: number;
  resolved: number;
}

export interface DefectFilter {
  status?: DefectStatus;
  assigneeUserId?: number;
  suiteId?: number;
  screen?: string;
}

export interface PlanItemPatch extends PlanItemKey {
  enabled?: boolean;
  assignee: string | null;
  /** 프로젝트 멤버. null 이면 assignee 글자만 남는다 */
  assigneeUserId: number | null;
  dueDate: string | null;
  priority: PlanPriority | null;
}

/** 일자별 정기 실행 격자 (F-3). 날짜는 서울 기준 YYYY-MM-DD */
export interface PlanDailyCell {
  date: string;
  /** null = 그날 정기 실행 결과 없음 */
  status: 'PASSED' | 'FAILED' | null;
  /** 그날 마지막 정기 실행 */
  executionId: number | null;
}

/** cells 는 days 와 같은 순서 (오래된 날 → 오늘) */
export interface PlanDailyItem extends PlanItemKey {
  cells: PlanDailyCell[];
}

/** 사용 중 항목만 센다. passRate 0~1, 그날 결과가 없으면 null */
export interface PlanDailyTotal {
  date: string;
  passed: number;
  failed: number;
  enabled: number;
  passRate: number | null;
}

export interface PlanDailyResponse {
  days: string[];
  items: PlanDailyItem[];
  totals: PlanDailyTotal[];
}
