import type {
  AiAnalysisRequest,
  AiAnalysisResponse,
  AiChatRequest,
  AppNotification,
  AuthUser,
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
  AiUsageSummary,
  ServiceHealth,
  SiteCheckResult,
  User,
  RunningAnalysis,
  SiteMap,
  SiteMapNodeDetail,
  ChatSession,
  ChatMessage,
  ChatStreamEvent,
  PermissionDecision,
  UserLevel,
  RecorderAction,
  RecorderCode,
  RecorderStartRequest,
  RecorderState,
  RecordedStep,
} from '@/types';
import { parseChatStreamEvent, readSseStream } from '@/lib/sseParser';

const TOKEN_KEY = 'playops_token';
const USER_KEY = 'playops_user';

// repositoryToken은 write-only 필드다. 빈 문자열이면 "변경 없음"을 의미하므로
// 전송 페이로드에서 아예 제외해 서버가 기존에 저장된 토큰을 그대로 유지하도록 한다.
function serializeProjectForm(data: ProjectFormData | Partial<ProjectFormData>): string {
  return JSON.stringify(data, (key, value) =>
    (key === 'repositoryToken' || key === 'sourceRepositoryToken') && value === '' ? undefined : value
  );
}

/**
 * 서버가 돌려준 오류. 상태 코드(status)와 서버가 붙인 오류 코드(code, 예: RECORDER_CLOSED)로
 * 갈라 안내해야 할 때 쓴다.
 */
export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** 오류 응답 본문 `{ message, error: { code } }` 에서 ApiError 를 만든다. 본문이 JSON 이 아니어도 status 는 남긴다. */
async function toApiError(res: Response, fallback?: string): Promise<ApiError> {
  const body = await res.json().catch(() => ({}));
  const code = typeof body?.error?.code === 'string' ? body.error.code : undefined;
  return new ApiError(body?.message || fallback || `서버 응답 오류 (HTTP ${res.status})`, res.status, code);
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
    // 터널(Cloudflare)이 502·504 를 자기 HTML 페이지로 바꾸면 서버가 보낸 메시지가 사라진다.
    // 그때도 빈 오류가 되지 않게 상태 코드를 남긴다.
    throw await toApiError(res);
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

  getNotifications: () => request<AppNotification[]>('/api/notifications'),
  deleteNotification: (id: number) => request<void>(`/api/notifications/${id}`, { method: 'DELETE' }),
  deleteAllNotifications: () => request<void>('/api/notifications', { method: 'DELETE' }),

  getProjects: () => request<Project[]>('/api/projects'),
  getAiAvailability: () =>
    request<AiAvailability>('/api/ai/availability'),

  getAiUsage: (days = 30) =>
    request<AiUsageSummary>(`/api/ai/usage?days=${days}`),

  checkSite: (url: string) =>
    request<SiteCheckResult>(`/api/projects/site-check?url=${encodeURIComponent(url)}`),

  getProject: (id: string) => request<Project>(`/api/projects/${id}`),

  getSiteMap: (projectId: string) =>
    request<SiteMap>(`/api/projects/${projectId}/sitemap`),

  /** 구조 탭 확인 지도: 화면 · 전환 · 테스트 흐름이 어디까지 확인됐고 어디서 막혔는지 */
  getSiteMapCoverage: (projectId: string) =>
    request<import('@/types').Coverage>(`/api/projects/${projectId}/sitemap/coverage`),

  // token 은 write-only: undefined 면 기존 토큰 유지, 값을 주면 교체.
  updateSiteMapSource: (projectId: string, source: { url: string; branch: string; token?: string }) =>
    request<SiteMap>(`/api/projects/${projectId}/sitemap/source`, {
      method: 'PUT',
      body: JSON.stringify(source),
    }),

  getSiteMapNode: (projectId: string, routeKey: string) =>
    request<SiteMapNodeDetail>(`/api/projects/${projectId}/sitemap/node?route=${encodeURIComponent(routeKey)}`),

  /** 사용자가 직접 화면 노드를 추가하거나 수정한다 */
  addSiteMapNode: (
    projectId: string,
    data: {
      routeKey: string;
      title?: string;
      url?: string;
      authRequired?: boolean;
      note?: string;
      fromRouteKey?: string;
      edgeLabel?: string;
    }
  ) =>
    request<SiteMap>(`/api/projects/${projectId}/sitemap/node`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /** 제외 표시와 메모. 값을 준 항목만 바꾼다 */
  updateSiteMapNode: (projectId: string, routeKey: string, edit: { excluded?: boolean; note?: string }) =>
    request<SiteMapNodeDetail>(`/api/projects/${projectId}/sitemap/node?route=${encodeURIComponent(routeKey)}`, {
      method: 'PATCH',
      body: JSON.stringify(edit),
    }),

  /** 화면 노드와 연결된 전환 · 메모를 삭제한다 */
  deleteSiteMapNode: (projectId: string, routeKey: string) =>
    request<SiteMap>(`/api/projects/${projectId}/sitemap/node?route=${encodeURIComponent(routeKey)}`, {
      method: 'DELETE',
    }),

  getRunningAnalyses: () => request<RunningAnalysis[]>('/api/sitemap/running'),

  analyzeSiteMap: (projectId: string) =>
    request<SiteMap>(`/api/projects/${projectId}/sitemap/analyze`, { method: 'POST' }),

  /** 소스 저장소 없이 대상 사이트 주소로 화면을 탐색한다 */
  analyzeSiteMapByUrl: (
    projectId: string,
    login?: { loginUrl?: string; loginId?: string; loginPassword?: string }
  ) =>
    request<SiteMap>(`/api/projects/${projectId}/sitemap/analyze-url`, {
      method: 'POST',
      ...(login ? { body: JSON.stringify(login) } : {}),
    }),

  fetchSiteMapScreenshot: async (projectId: string, routeKey: string): Promise<Blob> => {
    const auth = getStoredAuth();
    const headers = new Headers();
    if (auth?.token) {
      headers.set('Authorization', `Bearer ${auth.token}`);
    }
    const res = await fetch(
      `/api/projects/${projectId}/sitemap/screenshot?route=${encodeURIComponent(routeKey)}`,
      { headers }
    );
    if (!res.ok) {
      throw new Error(`스크린샷 조회 실패 (${res.status})`);
    }
    return res.blob();
  },

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

  getAiBootstrap: (projectId: string, bootstrapId: string) =>
    request<import('@/types').AiBootstrapResponse>(`/api/projects/${projectId}/ai/bootstrap/${bootstrapId}`),

  submitAiBootstrapCredentials: (
    projectId: string,
    bootstrapId: string,
    data: { loginId?: string; password?: string; loginPath?: string; skip?: boolean }
  ) =>
    request<import('@/types').AiBootstrapResponse>(
      `/api/projects/${projectId}/ai/bootstrap/${bootstrapId}/credentials`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    ),

  fetchAiBootstrapScreenshot: async (
    projectId: string,
    bootstrapId: string,
    file: string
  ): Promise<Blob> => {
    const auth = getStoredAuth();
    const headers = new Headers();
    if (auth?.token) {
      headers.set('Authorization', `Bearer ${auth.token}`);
    }
    const cleanFile = file.replace(/^screens\//, '');
    const res = await fetch(
      `/api/projects/${projectId}/ai/bootstrap/${bootstrapId}/screens/${encodeURIComponent(cleanFile)}`,
      { headers }
    );
    if (!res.ok) {
      throw new Error(`스크린샷 조회 실패 (${res.status})`);
    }
    return res.blob();
  },

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
      request<import('@/types').AiChatResponse>('/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    generateTemplate: (data: import('@/types').AiTemplateRequest) =>
      request<import('@/types').AiTemplateResponse>('/api/ai/templates/generate', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },

  chat: {
    createSession: (arg?: string | { projectId?: string }) => {
      const projectId = typeof arg === 'string' ? arg : arg?.projectId;
      return request<ChatSession>('/api/ai/chat/sessions', {
        method: 'POST',
        body: JSON.stringify(projectId ? { projectId } : {}),
      });
    },
    listSessions: (projectId?: string) =>
      request<ChatSession[]>(
        projectId
          ? `/api/ai/chat/sessions?projectId=${encodeURIComponent(projectId)}`
          : '/api/ai/chat/sessions'
      ),
    getSession: (id: number) =>
      request<{ session: ChatSession; messages: ChatMessage[] }>(`/api/ai/chat/sessions/${id}`),
    deleteSession: (id: number) =>
      request<void>(`/api/ai/chat/sessions/${id}`, { method: 'DELETE' }),
    respondPermission: (sessionId: number, requestId: string, decision: PermissionDecision) =>
      request<void>(
        `/api/ai/chat/sessions/${sessionId}/permissions/${encodeURIComponent(requestId)}`,
        {
          method: 'POST',
          body: JSON.stringify({ decision }),
        }
      ),
    cancel: (sessionId: number) =>
      request<void>(`/api/ai/chat/sessions/${sessionId}/cancel`, { method: 'POST' }),
    streamMessage: async (
      sessionId: number,
      payload: { content: string; userLevel?: UserLevel },
      onEvent: (event: ChatStreamEvent) => void,
      signal?: AbortSignal
    ): Promise<void> => {
      const auth = getStoredAuth();
      const headers = new Headers({
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      });
      if (auth?.token) {
        headers.set('Authorization', `Bearer ${auth.token}`);
      }
      const res = await fetch(`/api/ai/chat/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        credentials: 'omit',
        signal,
      });

      if (res.status === 401) {
        clearStoredAuth();
        window.location.href = '/login';
        throw new Error('Unauthorized');
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `서버 응답 오류 (HTTP ${res.status})`);
      }

      if (!res.body) {
        throw new Error('스트림 응답 본문이 없습니다.');
      }

      await readSseStream(
        res.body,
        (raw) => {
          const ev = parseChatStreamEvent(raw);
          if (ev) onEvent(ev);
        },
        signal
      );
    },
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
      data: { targetSpecPath: string; instruction: string; routeKeys?: string[] }
    ) =>
      request<import('@/types').AiJob>(`/api/projects/${projectId}/ai-jobs/template-generate`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    listByProject: (projectId: string) =>
      request<import('@/types').AiJob[]>(`/api/projects/${projectId}/ai-jobs`),
    /** 작업 한 건의 현재 상태. 채팅 패널의 작업 카드가 이걸 주기적으로 읽는다. */
    get: (id: number) => request<import('@/types').AiJob>(`/api/ai-jobs/${id}`),
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

  /** 클릭으로 테스트 만들기(녹화). 계약: docs/design/recorder-contract.md */
  recorder: {
    start: (projectId: string, body: RecorderStartRequest) =>
      request<RecorderState>(`/api/projects/${projectId}/recorder/sessions`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    get: (projectId: string, sid: string) =>
      request<RecorderState>(`/api/projects/${projectId}/recorder/sessions/${sid}`),
    /** 현재 화면(image/jpeg). 이미지 태그에는 헤더를 못 실어서 blob 으로 받아 쓴다. */
    screenshot: async (projectId: string, sid: string): Promise<Blob> => {
      const auth = getStoredAuth();
      const headers = new Headers();
      if (auth?.token) headers.set('Authorization', `Bearer ${auth.token}`);
      const res = await fetch(`/api/projects/${projectId}/recorder/sessions/${sid}/screenshot`, {
        headers,
        credentials: 'omit',
      });
      if (!res.ok) throw await toApiError(res, `화면 조회 실패 (${res.status})`);
      return res.blob();
    },
    act: (projectId: string, sid: string, action: RecorderAction) =>
      request<RecorderState>(`/api/projects/${projectId}/recorder/sessions/${sid}/actions`, {
        method: 'POST',
        body: JSON.stringify(action),
      }),
    putSteps: (projectId: string, sid: string, steps: RecordedStep[]) =>
      request<RecorderState>(`/api/projects/${projectId}/recorder/sessions/${sid}/steps`, {
        method: 'PUT',
        body: JSON.stringify({ steps }),
      }),
    code: (projectId: string, sid: string, title?: string) =>
      request<RecorderCode>(
        `/api/projects/${projectId}/recorder/sessions/${sid}/code${title ? `?title=${encodeURIComponent(title)}` : ''}`
      ),
    /** 같은 경로의 파일이 있으면 409(ApiError.status). */
    save: (projectId: string, sid: string, body: { specPath: string; title?: string }) =>
      request<{ specPath: string }>(`/api/projects/${projectId}/recorder/sessions/${sid}/save`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    close: (projectId: string, sid: string) =>
      request<void>(`/api/projects/${projectId}/recorder/sessions/${sid}`, { method: 'DELETE' }),
    /**
     * 페이지를 떠나는 중에 세션을 끝낸다. 화면이 닫혀도 요청이 끝까지 가도록 keepalive 로 보내고,
     * 응답은 기다리지 않는다. (실패해도 서버가 10분 뒤 스스로 멈춘다)
     */
    closeOnLeave: (projectId: string, sid: string) => {
      const auth = getStoredAuth();
      const headers = new Headers();
      if (auth?.token) headers.set('Authorization', `Bearer ${auth.token}`);
      void fetch(`/api/projects/${projectId}/recorder/sessions/${sid}`, {
        method: 'DELETE',
        headers,
        credentials: 'omit',
        keepalive: true,
      }).catch(() => undefined);
    },
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

/** 녹화 화면이 쓰는 호출 묶음. 개발용 가짜 응답(recorderMock)도 같은 모양을 맞춘다. */
export type RecorderApi = typeof api.recorder;
