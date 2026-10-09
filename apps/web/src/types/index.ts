export type PackageManager = 'NPM' | 'YARN' | 'PNPM';
export type DockerStatus = 'STOPPED' | 'RUNNING' | 'ERROR' | 'NOT_CONFIGURED';
export type RunnerActivity = 'IDLE' | 'TESTING' | 'UNAVAILABLE';
export type RunnerLifecycle = 'PERSISTENT' | 'EPHEMERAL';
export type UserRole = 'ADMIN' | 'USER';
export type ProjectServerType = 'DEV' | 'TEST' | 'PROD';
export type BoardPostType = 'REQUEST' | 'QUESTION' | 'FAQ' | 'FREE' | 'NOTICE' | 'ETC';

export interface Project {
  projectId: string;
  projectName: string;
  displayOrder: number;
  serverType: ProjectServerType;
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
  serverType: ProjectServerType | null;
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

export interface BoardPost {
  id: number;
  type: BoardPostType;
  title: string;
  parentId: number | null;
  content: string;
  attachments: BoardAttachment[];
  visible: boolean;
  pinned: boolean;
  visibleFrom: string | null;
  visibleUntil: string | null;
  createdBy: string;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  likeCount: number;
  ratingAverage: number | null;
  ratingCount: number;
  commentCount: number;
  replyCount: number;
  myLiked: boolean;
  myRating: number | null;
  myMemo: string | null;
}

export interface BoardAttachment {
  name: string;
  contentType: string;
  size: number;
  dataUrl: string;
}

export interface BoardPostFormData {
  type: BoardPostType;
  title: string;
  parentId: number | null;
  content: string;
  attachments: BoardAttachment[];
  visible: boolean;
  pinned: boolean;
  visibleFrom: string | null;
  visibleUntil: string | null;
}

export interface BoardPostComment {
  id: number;
  parentId: number | null;
  content: string;
  attachments: BoardAttachment[];
  createdBy: string;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BoardPostCommentFormData {
  parentId?: number | null;
  content: string;
  attachments: BoardAttachment[];
}

export interface BoardPostReactionFormData {
  liked: boolean;
  rating: number | null;
  memo: string;
}

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
  projectId: string;
  projectName: string;
  displayOrder: number;
  serverType: ProjectServerType;
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
  serverType: 'DEV',
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

export interface AiBootstrapResponse {
  executionId: number;
  generatedFiles: string[];
  specPath: string;
  estimatedDurationMs: number;
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

export type AiJobType = 'CODE_FIX' | 'TEMPLATE_GENERATE' | 'TEST_ANALYSIS';
export type AiJobStatus =
  | 'PENDING' | 'RUNNING' | 'DIFF_READY' | 'NEEDS_REVIEW'
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
  updatedAt: string;
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
}

export interface SiteMapAnalysis {
  status: 'NONE' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  commitSha: string | null;
  framework: 'NEXT' | 'REACT_ROUTER' | null;
  partial: boolean;
  screenCount: number;
  /** 요소까지 읽은 화면 수 (진행 표시용) */
  processedCount: number;
  /** 이번 분석에서 AI 를 부른 횟수. 파일이 안 바뀐 화면은 부르지 않는다 */
  llmCalls: number;
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
}

export interface SiteMap {
  projectId: string;
  source: SiteMapSource;
  analysis: SiteMapAnalysis;
  nodes: SiteMapNode[];
  edges: SiteMapEdge[];
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
  file: string;
  line: number | null;
  verification: 'UNVERIFIED' | 'PASSED' | 'FAILED';
}

export interface SiteMapNodeDetail {
  node: SiteMapNode;
  elements: SiteMapElement[];
  edges: SiteMapEdge[];
}
