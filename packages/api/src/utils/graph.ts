import { logger } from '@librechat/data-schemas';
import type { IUser } from '@librechat/data-schemas';
import {
  GRAPH_TOKEN_PLACEHOLDER,
  DEFAULT_GRAPH_SCOPES,
  extractOpenIDTokenInfo,
  isOpenIDTokenValid,
} from './oidc';

/**
 * Pre-computed regex for matching the Graph token placeholder.
 * Escapes curly braces in the placeholder string for safe regex use.
 */
const GRAPH_TOKEN_REGEX = new RegExp(
  GRAPH_TOKEN_PLACEHOLDER.replace(/[{}]/g, '\\$&'),
  'g',
);

/**
 * Response from a Graph API token exchange.
 */
export interface GraphTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

/**
 * Function type for resolving Graph API tokens via OBO flow.
 * This function is injected from the main API layer since it requires
 * access to OpenID configuration and caching services.
 */
export type GraphTokenResolver = (
  user: IUser,
  accessToken: string,
  scopes: string,
  fromCache?: boolean,
) => Promise<GraphTokenResponse>;

/**
 * Options for processing Graph token placeholders.
 */
export interface GraphTokenOptions {
  user?: IUser;
  graphTokenResolver?: GraphTokenResolver;
  scopes?: string;
}

/**
 * Checks if a string contains the Graph token placeholder.
 */
export function containsGraphTokenPlaceholder(value: string): boolean {
  return typeof value === 'string' && value.includes(GRAPH_TOKEN_PLACEHOLDER);
}

/**
 * Checks if any value in a record contains the Graph token placeholder.
 */
export function recordContainsGraphTokenPlaceholder(
  record: Record<string, string> | undefined,
): boolean {
  if (!record || typeof record !== 'object') {
    return false;
  }
  return Object.values(record).some(containsGraphTokenPlaceholder);
}

/**
 * Checks if MCP options contain the Graph token placeholder in headers, env, or url.
 */
export function mcpOptionsContainGraphTokenPlaceholder(options: {
  headers?: Record<string, string>;
  env?: Record<string, string>;
  url?: string;
}): boolean {
  if (options.url && containsGraphTokenPlaceholder(options.url)) {
    return true;
  }
  if (recordContainsGraphTokenPlaceholder(options.headers)) {
    return true;
  }
  if (recordContainsGraphTokenPlaceholder(options.env)) {
    return true;
  }
  return false;
}

/**
 * Asynchronously resolves Graph token placeholders in a string.
 * Must be called before the synchronous processMCPEnv pipeline.
 */
export async function resolveGraphTokenPlaceholder(
  value: string,
  options: GraphTokenOptions,
): Promise<string> {
  if (!containsGraphTokenPlaceholder(value)) {
    return value;
  }

  const { user, graphTokenResolver, scopes } = options;

  if (!user || !graphTokenResolver) {
    logger.warn(
      '[resolveGraphTokenPlaceholder] User or graphTokenResolver not provided, cannot resolve Graph token',
    );
    return value;
  }

  const tokenInfo = extractOpenIDTokenInfo(user);
  if (!tokenInfo || !isOpenIDTokenValid(tokenInfo)) {
    logger.warn(
      '[resolveGraphTokenPlaceholder] No valid OpenID token available for Graph token exchange',
    );
    return value;
  }

  if (!tokenInfo.accessToken) {
    logger.warn(
      '[resolveGraphTokenPlaceholder] No access token available for OBO exchange',
    );
    return value;
  }

  try {
    const graphScopes = scopes || process.env.GRAPH_API_SCOPES || DEFAULT_GRAPH_SCOPES;
    const graphTokenResponse = await graphTokenResolver(
      user,
      tokenInfo.accessToken,
      graphScopes,
      true,
    );

    if (graphTokenResponse?.access_token) {
      return value.replace(GRAPH_TOKEN_REGEX, graphTokenResponse.access_token);
    }

    logger.warn(
      '[resolveGraphTokenPlaceholder] Graph token exchange did not return an access token',
    );
    return value;
  } catch (error) {
    logger.error(
      '[resolveGraphTokenPlaceholder] Failed to exchange token for Graph API:',
      error,
    );
    return value;
  }
}

/**
 * Asynchronously resolves Graph token placeholders in a record of string values.
 */
export async function resolveGraphTokensInRecord(
  record: Record<string, string> | undefined,
  options: GraphTokenOptions,
): Promise<Record<string, string> | undefined> {
  if (!record || typeof record !== 'object') {
    return record;
  }

  if (!recordContainsGraphTokenPlaceholder(record)) {
    return record;
  }

  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    resolved[key] = await resolveGraphTokenPlaceholder(value, options);
  }
  return resolved;
}

/**
 * Pre-processes MCP options to resolve Graph token placeholders asynchronously.
 * Must be called before processMCPEnv since Graph token resolution is async.
 */
export async function preProcessGraphTokens<
  T extends {
    headers?: Record<string, string>;
    env?: Record<string, string>;
    url?: string;
  },
>(options: T, graphOptions: GraphTokenOptions): Promise<T> {
  if (!mcpOptionsContainGraphTokenPlaceholder(options)) {
    return options;
  }

  const result = { ...options };

  if (result.url && containsGraphTokenPlaceholder(result.url)) {
    result.url = await resolveGraphTokenPlaceholder(result.url, graphOptions);
  }

  if (result.headers) {
    result.headers = await resolveGraphTokensInRecord(result.headers, graphOptions);
  }

  if (result.env) {
    result.env = await resolveGraphTokensInRecord(result.env, graphOptions);
  }

  return result;
}
