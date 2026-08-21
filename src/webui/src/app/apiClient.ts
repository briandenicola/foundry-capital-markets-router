import { useMemo } from 'react';
import { ApiClient } from '../api/client';

/**
 * The API base URL.
 *
 * Read from the environment rather than defaulted to a production host, because a build that
 * silently points at the wrong environment is a demo that fails in a way nobody can see from the
 * screen. An unset value falls back to the local dev proxy only.
 */
export const apiBaseUrl: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api';

/**
 * Builds a client.
 *
 * `getAccessToken` returns null until MSAL is wired (T-028b). Null is honest: the client sends no
 * Authorization header, the services answer 403, and the UI shows the refusal. That is a better
 * failure than a placeholder token, which would produce a 401 that looks like an outage rather
 * than a control.
 */
export function createApiClient(getAccessToken: () => Promise<string | null>): ApiClient {
  return new ApiClient({ baseUrl: apiBaseUrl, getAccessToken });
}

export function useApiClient(getAccessToken: () => Promise<string | null>): ApiClient {
  return useMemo(() => createApiClient(getAccessToken), [getAccessToken]);
}
