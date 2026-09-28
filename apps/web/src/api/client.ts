import type {
  AiAnalysisRequest,
  AiAnalysisResponse,
  AiChatRequest,
  AuthUser,
  BoardPost,
  BoardPostComment,
  BoardPostCommentFormData,
  BoardPostFormData,
  BoardPostReactionFormData,
  BoardPostType,
  DockerHostResource,
  Execution,
  ExecutionDetail,
  ExecutionLogChunk,
  PlaywrightTemplate,
  PlaywrightTemplateFormData,
  Project,
  ProjectFormData,
  RunnerCapacity,
  RunnerCapacityFormData,
  RunnerCleanupResult,
  RunnerContainer,
  RunnerOperationLog,
  RunTestOptions,
  ScenarioTree,
  ScenarioUsageRequest,
  ScaffoldResult,
  AiAvailability,
  ServiceHealth,
  SiteCheckResult,
  User,
} from '@/types';

const TOKEN_KEY = 'playops_token';
const USER_KEY = 'playops_user';

// repositoryToken은 write-only 필드다. 빈 문자열이면 "변경 없음"을 의미하므로
// 전송 페이로드에서 아예 제외해 서버가 기존에 저장된 토큰을 그대로 유지하도록 한다.
function serializeProjectForm(data: ProjectFormData | Partial<ProjectFormData>): string {
  return JSON.stringify(data, (key, value) =>
    key === 'repositoryToken' && value === '' ? undefined : value
  );
}

type ApiRequestInit = RequestInit & {
  auth?: boolean;
};

export function getStoredAuth(): AuthUser | null {
  const token = localStorage.getItem(TOKEN_KEY);
  const raw = localStorage.getItem(USER_KEY);
  if (!token || !raw) return null;
  try {
    const { username, role } = JSON.parse(raw);
    return { token, username, role };
  } catch {
    return null;
  }
}

export function setStoredAuth(auth: AuthUser) {
  localStorage.setItem(TOKEN_KEY, auth.token);
  localStorage.setItem(USER_KEY, JSON.stringify({ username: auth.username, role: auth.role }));
}

export function clearStoredAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function request<T>(path: string, options: ApiRequestInit = {}): Promise<T> {
  const { auth: includeAuth = true, ...fetchOptions } = options;
  const auth = getStoredAuth();
  const headers = new Headers(fetchOptions.headers);

  if (includeAuth && auth?.token) {
    headers.set('Authorization', `Bearer ${auth.token}`);
  }

  if (!(fetchOptions.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(path, { ...fetchOptions, headers, credentials: 'omit' });

  if (res.status === 401) {
    // 로그인처럼 토큰 없이 부르는 요청은 화면을 옮기지 않고 오류만 돌려준다.
    // (그러지 않으면 비밀번호를 틀렸을 때 페이지가 새로고침되어 오류가 보이지 않는다)
    if (!includeAuth) {
      const err = await res.json().catch(() => ({ message: '' }));
      throw new Error(err.message || '사용자명 또는 비밀번호가 올바르지 않습니다.');
    }
    clearStoredAuth();
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message ?? 'Request failed');
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export const api = {
  login: (username: string, password: string) =>
    request<{ token: string; username: string; role: AuthUser['role'] }>('/api/auth/login', {
      method: 'POST',
      auth: false,
      body: JSON.stringify({ username, password }),
    }),

  getServiceHealth: () =>
    request<ServiceHealth>('/api/health/services', { auth: false }),

  logout: () =>
    request<void>('/api/auth/logout', { method: 'POST' }),

  getBoardPosts: (type?: BoardPostType | 'ALL', includeHidden = false) => {
    const params = new URLSearchParams();
    if (type && type !== 'ALL') params.set('type', type);
    if (includeHidden) params.set('includeHidden', 'true');
    const query = params.toString();
    return request<BoardPost[]>(`/api/board-posts${query ? `?${query}` : ''}`);
  },

  getVisibleNotices: () =>
    request<BoardPost[]>('/api/board-posts/notices/visible'),

  createBoardPost: (data: BoardPostFormData) =>
    request<BoardPost>('/api/board-posts', { method: 'POST', body: JSON.stringify(data) }),

  updateBoardPost: (id: number, data: BoardPostFormData) =>
    request<BoardPost>(`/api/board-posts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  deleteBoardPost: (id: number) =>
    request<void>(`/api/board-posts/${id}`, { method: 'DELETE' }),

  getBoardPostComments: (id: number) =>
    request<BoardPostComment[]>(`/api/board-posts/${id}/comments`),

  createBoardPostComment: (id: number, data: BoardPostCommentFormData) =>
    request<BoardPostComment>(`/api/board-posts/${id}/comments`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deleteBoardPostComment: (commentId: number) =>
    request<void>(`/api/board-posts/comments/${commentId}`, { method: 'DELETE' }),

  updateBoardPostReaction: (id: number, data: BoardPostReactionFormData) =>
    request<BoardPost>(`/api/board-posts/${id}/reaction`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  getProjects: () => request<Project[]>('/api/projects'),
  getAiAvailability: () =>
    request<AiAvailability>('/api/ai/availability'),

  checkSite: (url: string) =>
    request<SiteCheckResult>(`/api/projects/site-check?url=${encodeURIComponent(url)}`),

  getProject: (id: string) => request<Project>(`/api/projects/${id}`),

  createProject: (data: ProjectFormData) =>
    request<Project>('/api/projects', { method: 'POST', body: serializeProjectForm(data) }),

  updateProject: (id: string, data: Partial<ProjectFormData>) =>
    request<Project>(`/api/projects/${id}`, { method: 'PUT', body: serializeProjectForm(data) }),

  deleteProject: (id: string) =>
    request<void>(`/api/projects/${id}`, { method: 'DELETE' }),

  startDocker: (id: string) =>
    request<Project>(`/api/projects/${id}/docker/start`, { method: 'POST' }),

  stopDocker: (id: string) =>
    request<Project>(`/api/projects/${id}/docker/stop`, { method: 'POST' }),

  getDockerLogs: (id: string) =>
    request<RunnerOperationLog>(`/api/projects/${id}/docker/logs`),

  getAuthState: (id: string) =>
    request<import('@/types').AuthStateStatus>(`/api/projects/${id}/auth-state`),

  clearAuthState: (id: string) =>
    request<void>(`/api/projects/${id}/auth-state`, { method: 'DELETE' }),

  getRunnerContainers: () =>
    request<RunnerContainer[]>('/api/projects/docker/runners'),

  getDockerContainers: () =>
    request<RunnerContainer[]>('/api/projects/docker/containers'),

  getRunnerCapacity: () =>
    request<RunnerCapacity>('/api/projects/docker/runner-capacity'),

  getDockerHostResources: () =>
    request<DockerHostResource>('/api/projects/docker/host-resources'),

  updateRunnerCapacity: (data: RunnerCapacityFormData) =>
    request<RunnerCapacity>('/api/projects/docker/runner-capacity', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  reconcileRunnerContainers: () =>
    request<RunnerContainer[]>('/api/projects/docker/runners/reconcile', { method: 'POST' }),

  cleanupRunnerContainers: (containerNames?: string[], onlyUnused = true) =>
    request<RunnerCleanupResult>('/api/projects/docker/runners', {
      method: 'DELETE',
      body: JSON.stringify({ containerNames: containerNames ?? [], onlyUnused }),
    }),

  listFiles: (id: string) => request<string[]>(`/api/projects/${id}/files`),

  uploadZip: (id: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<{ message: string }>(`/api/projects/${id}/files/upload`, {
      method: 'POST',
      body: form,
      headers: {},
    });
  },

  getUsers: () => request<User[]>('/api/users'),

  createUser: (data: { username: string; password: string; role: User['role'] }) =>
    request<User>('/api/users', { method: 'POST', body: JSON.stringify(data) }),

  updateUser: (id: number, data: { role?: User['role']; password?: string }) =>
    request<User>(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  deleteUser: (id: number) =>
    request<void>(`/api/users/${id}`, { method: 'DELETE' }),

  revokeUserSessions: (id: number) =>
    request<void>(`/api/users/${id}/sessions`, { method: 'DELETE' }),

  getUserAuditLog: () => request<import('@/types').UserAuditLog[]>('/api/users/audit-log'),

  getTemplates: () => request<PlaywrightTemplate[]>('/api/templates'),

  getTemplate: (id: string) => request<PlaywrightTemplate>(`/api/templates/${id}`),

  createTemplate: (data: PlaywrightTemplateFormData) =>
    request<PlaywrightTemplate>('/api/templates', { method: 'POST', body: JSON.stringify(data) }),

  cloneTemplate: (sourceId: string, data: PlaywrightTemplateFormData) =>
    request<PlaywrightTemplate>(`/api/templates/${sourceId}/clone`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateTemplate: (id: string, data: Omit<PlaywrightTemplateFormData, 'id'>) =>
    request<PlaywrightTemplate>(`/api/templates/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ id, ...data }),
    }),

  deleteTemplate: (id: string) =>
    request<void>(`/api/templates/${id}`, { method: 'DELETE' }),

  getTemplateFile: (templateId: string, path: string) =>
    request<{ path: string; content: string }>(
      `/api/templates/${templateId}/files?path=${encodeURIComponent(path)}`
    ),

  saveTemplateFile: (templateId: string, path: string, content: string) =>
    request<PlaywrightTemplate>(
      `/api/templates/${templateId}/files?path=${encodeURIComponent(path)}`,
      { method: 'PUT', body: JSON.stringify({ content }) }
    ),

  deleteTemplateFile: (templateId: string, path: string) =>
    request<PlaywrightTemplate>(
      `/api/templates/${templateId}/files?path=${encodeURIComponent(path)}`,
      { method: 'DELETE' }
    ),

  downloadTemplateSource: async (templateId: string): Promise<Blob> => {
    const auth = getStoredAuth();
    const headers = new Headers();
    if (auth?.token) {
      headers.set('Authorization', `Bearer ${auth.token}`);
    }
    const res = await fetch(`/api/templates/${templateId}/source.zip`, { headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message ?? 'Template source download failed');
    }
    return res.blob();
  },

  scaffoldProject: (projectId: string, templateId?: string, overwrite?: boolean) =>
    request<ScaffoldResult>(`/api/projects/${projectId}/scaffold`, {
      method: 'POST',
      body: JSON.stringify({ templateId, overwrite: overwrite ?? false }),
    }),

  readProjectFile: (projectId: string, path: string) =>
    request<{ path: string; content: string }>(
      `/api/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`
    ),

  saveProjectFile: (projectId: string, path: string, content: string) =>
    request<{ path: string; content: string }>(
      `/api/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`,
      { method: 'PUT', body: JSON.stringify({ content }) }
    ),

  aiEditAssist: (
    projectId: string,
    data: { filePath: string; currentContent: string; instruction: string }
  ) =>
    request<{ content: string }>(`/api/projects/${projectId}/ai/edit-assist`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  aiEditAssistVerify: (
    projectId: string,
    data: { filePath: string; proposedContent: string; specPath?: string }
  ) =>
    request<import('@/types').AiEditAssistVerifyResponse>(`/api/projects/${projectId}/ai/edit-assist/verify`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  aiBootstrap: (projectId: string, data: { instruction: string; provider?: string }) =>
    request<import('@/types').AiBootstrapResponse>(`/api/projects/${projectId}/ai/bootstrap`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getScenarios: (projectId: string) =>
    request<ScenarioTree>(`/api/projects/${projectId}/scenarios`),

  updateScenarioUsage: (projectId: string, data: ScenarioUsageRequest) =>
    request<void>(`/api/projects/${projectId}/scenarios/usage`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  getExecutions: (projectId: string) =>
    request<Execution[]>(`/api/projects/${projectId}/executions`),

  cancelExecution: (executionId: number) =>
    request<Execution>(`/api/executions/${executionId}/cancel`, { method: 'POST' }),

  deleteExecution: (executionId: number) =>
    request<void>(`/api/executions/${executionId}`, { method: 'DELETE' }),

  resetExecutions: (projectId: string) =>
    request<void>(`/api/projects/${projectId}/executions`, { method: 'DELETE' }),

  runTests: (projectId: string, options?: RunTestOptions) =>
    request<Execution>(`/api/projects/${projectId}/executions`, {
      method: 'POST',
      body: JSON.stringify({
        grep: options?.grep ?? null,
        specPath: options?.specPath ?? null,
        specPaths: options?.specPaths ?? null,
        caseTitle: options?.caseTitle ?? null,
        sequential: options?.sequential ?? false,
      }),
    }),

  getCaseHistory: (projectId: string, grep: string) =>
    request<Execution[]>(
      `/api/projects/${projectId}/executions/history?grep=${encodeURIComponent(grep)}`
    ),

  getExecutionLogs: (executionId: number, offset: number) =>
    request<ExecutionLogChunk>(`/api/executions/${executionId}/logs?offset=${offset}`),

  getExecutionDetail: (executionId: number) =>
    request<ExecutionDetail>(`/api/executions/${executionId}`),

  artifactUrl: (executionId: number, path: string) =>
    `/api/executions/${executionId}/artifact?path=${encodeURIComponent(path)}`,

  fetchArtifactBlob: async (executionId: number, path: string): Promise<Blob> => {
    const auth = getStoredAuth();
    const headers = new Headers();
    if (auth?.token) {
      headers.set('Authorization', `Bearer ${auth.token}`);
    }
    const res = await fetch(
      `/api/executions/${executionId}/artifact?path=${encodeURIComponent(path)}`,
      { headers }
    );
    if (!res.ok) {
      throw new Error(`아티팩트 조회 실패 (${res.status})`);
    }
    return res.blob();
  },

  ai: {
    analyzeExecution: (data: AiAnalysisRequest) =>
      request<AiAnalysisResponse>('/api/ai/analyze', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    chat: (data: AiChatRequest) =>
      request<{ answer: string }>('/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    generateTemplate: (data: import('@/types').AiTemplateRequest) =>
      request<import('@/types').AiTemplateResponse>('/api/ai/templates/generate', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },

  admin: {
    getAiProviderSettings: () =>
      request<import('@/types').AiProviderSettingsResponse>('/api/admin/ai-provider-settings'),
    updateAiProviderSettings: (data: import('@/types').AiProviderSettingsRequest) =>
      request<import('@/types').AiProviderSettingsResponse>('/api/admin/ai-provider-settings', {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    getSlackSettings: () =>
      request<import('@/types').SlackSettingsResponse>('/api/admin/slack-settings'),
    updateSlackSettings: (data: import('@/types').SlackSettingsRequest) =>
      request<import('@/types').SlackSettingsResponse>('/api/admin/slack-settings', {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    testSlackNotification: () =>
      request<void>('/api/admin/slack-settings/test', { method: 'POST' }),
  },

  aiJobs: {
    create: (projectId: string, data: import('@/types').CreateAiJobRequest) =>
      request<import('@/types').AiJob>(`/api/projects/${projectId}/ai-jobs`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    createTemplateGenerate: (
      projectId: string,
      data: { targetSpecPath: string; instruction: string }
    ) =>
      request<import('@/types').AiJob>(`/api/projects/${projectId}/ai-jobs/template-generate`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    listByProject: (projectId: string) =>
      request<import('@/types').AiJob[]>(`/api/projects/${projectId}/ai-jobs`),
    needsReview: () => request<import('@/types').AiJob[]>('/api/ai-jobs/needs-review'),
    diff: (id: number) => request<import('@/types').AiJobFileDiff[]>(`/api/ai-jobs/${id}/diff`),
    approve: (id: number) =>
      request<import('@/types').AiJob>(`/api/ai-jobs/${id}/approve`, { method: 'POST' }),
    reject: (id: number) =>
      request<import('@/types').AiJob>(`/api/ai-jobs/${id}/reject`, { method: 'POST' }),
  },

  schedules: {
    listByProject: (projectId: string) =>
      request<import('@/types').ExecutionSchedule[]>(`/api/projects/${projectId}/schedules`),
    create: (projectId: string, data: import('@/types').ExecutionScheduleRequest) =>
      request<import('@/types').ExecutionSchedule>(`/api/projects/${projectId}/schedules`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (projectId: string, id: number, data: import('@/types').ExecutionScheduleRequest) =>
      request<import('@/types').ExecutionSchedule>(`/api/projects/${projectId}/schedules/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    remove: (projectId: string, id: number) =>
      request<void>(`/api/projects/${projectId}/schedules/${id}`, { method: 'DELETE' }),
  },

  testSuites: {
    listByProject: (projectId: string) =>
      request<import('@/types').TestSuite[]>(`/api/projects/${projectId}/test-suites`),
    create: (projectId: string, data: import('@/types').TestSuiteRequest) =>
      request<import('@/types').TestSuite>(`/api/projects/${projectId}/test-suites`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    remove: (projectId: string, id: number) =>
      request<void>(`/api/projects/${projectId}/test-suites/${id}`, { method: 'DELETE' }),
  },
};
