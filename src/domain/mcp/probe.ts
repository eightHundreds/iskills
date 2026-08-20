import type { HttpProbeStatus, McpRecipe, McpSecretValues } from './types.js';

export interface HttpProbeInit {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function probeHttp(
  recipe: McpRecipe,
  secrets: McpSecretValues,
  init: HttpProbeInit = {}
): Promise<HttpProbeStatus> {
  if (recipe.transport !== 'http' && recipe.transport !== 'sse') return 'failed';
  const url = secrets.url ?? recipe.url;
  if (!url) return 'failed';
  const fetchImpl = init.fetchImpl ?? fetch;
  const timeoutMs = init.timeoutMs ?? 4000;
  const headers = new Headers(secrets.headers);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers,
      redirect: 'manual',
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) return 'needs-auth';
    if (response.status >= 200 && response.status < 400) return 'reachable';
    return 'failed';
  } catch {
    return 'failed';
  } finally {
    clearTimeout(timer);
  }
}

export function probeHeadersFromSecrets(secrets: McpSecretValues): Record<string, string> {
  return { ...secrets.headers };
}
