/**
 * The one place that calls Atlassian REST APIs. Every request goes through the concurrency
 * limiter and the 429/503 retry policy from `./rateLimit`.
 *
 * One limiter per function invocation (module scope): a scan batch is one invocation, so
 * this caps in-flight requests per batch. Forge platform limits are per app per site, so
 * `MAX_CONCURRENT` is kept small; raise it only after measuring on the dev site (T13).
 */
import api, { type APIResponse, type Route } from "@forge/api";
import { createLimiter, withRetry, type RetryOptions } from "./rateLimit";

export const MAX_CONCURRENT = 4;

const limit = createLimiter(MAX_CONCURRENT);

const retryOptions: RetryOptions = {
  onRetry: ({ status, attempt, delayMs }) =>
    console.warn(`rate limited (HTTP ${status}), attempt ${attempt}: waiting ${Math.round(delayMs)} ms`),
};

export function confluenceGet(path: Route): Promise<APIResponse> {
  return limit(() => withRetry(() => api.asApp().requestConfluence(path), retryOptions));
}

export function jiraGet(path: Route): Promise<APIResponse> {
  return limit(() => withRetry(() => api.asApp().requestJira(path), retryOptions));
}
