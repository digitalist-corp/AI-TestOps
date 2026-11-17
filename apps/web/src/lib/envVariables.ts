export interface EnvEntry {
  key: string;
  value: string;
}

export type EnvRequirementState =
  | 'required-missing'
  | 'required-configured'
  | 'optional-configured'
  | 'optional-empty';

const SECRET_KEY = /password|secret|token|credential/i;

export function isSecretEnvKey(key: string): boolean {
  return SECRET_KEY.test(key);
}

export function parseEnvVariablesJson(json: string): EnvEntry[] {
  if (!json?.trim()) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return [];
    }
    return Object.entries(parsed as Record<string, unknown>).map(([key, value]) => ({
      key,
      value: value == null ? '' : String(value),
    }));
  } catch {
    return [];
  }
}

export function configuredEnvCount(json: string): number {
  return parseEnvVariablesJson(json).filter((entry) => entry.key.trim() && entry.value.trim()).length;
}

export function resolveEnvRequirementState(loginEnvRequired: boolean, json: string): EnvRequirementState {
  const count = configuredEnvCount(json);
  if (loginEnvRequired) {
    return count > 0 ? 'required-configured' : 'required-missing';
  }
  return count > 0 ? 'optional-configured' : 'optional-empty';
}

/** 팀원에게: 환경변수 입력은 프로젝트 수정이라 PM · 관리자만 한다 (#106) */
export const ENV_ASK_PM = '테스트 계정 환경변수가 필요합니다. PM에게 입력을 요청하세요.';

export function isRequiredEnvMissing(loginEnvRequired: boolean, json: string): boolean {
  return resolveEnvRequirementState(loginEnvRequired, json) === 'required-missing';
}

function stripEnvValueQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;
  const quote = trimmed[0];
  if ((quote !== '"' && quote !== "'") || trimmed[trimmed.length - 1] !== quote) {
    return trimmed;
  }
  return trimmed.slice(1, -1);
}

export function parseEnvVariablesText(text: string): EnvEntry[] {
  const raw = text.trim();
  if (!raw) return [];

  const jsonEntries = parseEnvVariablesJson(raw);
  if (jsonEntries.length > 0 || raw === '{}') {
    return jsonEntries;
  }

  const entries: EnvEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const normalized = trimmed.startsWith('export ') ? trimmed.slice(7).trimStart() : trimmed;
    const separatorIndex = normalized.indexOf('=');
    if (separatorIndex <= 0) continue;

    const key = normalized.slice(0, separatorIndex).trim();
    if (!key || key.startsWith('#')) continue;

    const value = normalized.slice(separatorIndex + 1);
    entries.push({ key, value: stripEnvValueQuotes(value) });
  }

  return entries;
}

export function serializeEnvVariables(entries: EnvEntry[]): string {
  const obj: Record<string, string> = {};
  for (const { key, value } of entries) {
    const k = key.trim();
    if (!k) continue;
    obj[k] = value;
  }
  return JSON.stringify(obj, null, 2);
}

export const SUGGESTED_ENV_KEYS = [
  'LOGIN_ID',
  'LOGIN_PASSWORD',
  'LOGIN_PATH',
  'BASE_URL',
  'NAV_MODE',
  'MENU_GREP',
  'TEST_PROJECT_NAME',
] as const;
