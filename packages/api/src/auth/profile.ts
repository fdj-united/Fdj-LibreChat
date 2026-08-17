import { fetch as undiciFetch } from 'undici';
import { logger } from '@librechat/data-schemas';
import type { IUser } from '@librechat/data-schemas';
import type { RequestInit } from 'undici';
import { getOpenIdProxyDispatcher } from '~/utils/proxy';

/**
 * Directory attributes mirrored onto the user document from the identity provider.
 */
export type DirectoryProfile = Pick<
  IUser,
  'jobTitle' | 'department' | 'companyName' | 'officeLocation' | 'managerName' | 'managerEmail'
>;

export interface DirectoryProfileOptions {
  /** Produces a Graph-scoped token, typically through the OBO flow */
  resolveGraphToken: () => Promise<string>;
  /** Upper bound for the whole operation, token exchange included */
  timeoutMs?: number;
}

interface GraphDirectoryUser {
  jobTitle?: string | null;
  department?: string | null;
  companyName?: string | null;
  officeLocation?: string | null;
  displayName?: string | null;
  mail?: string | null;
  userPrincipalName?: string | null;
}

/**
 * A resource is `absent` when Graph reports it does not exist (a user without a manager) and
 * `failed` when the request itself did not succeed. The two must stay distinguishable: an absent
 * resource clears stored values, whereas a failure has to leave them untouched.
 */
type GraphResourceResult =
  | { outcome: 'resolved'; user: GraphDirectoryUser }
  | { outcome: 'absent' }
  | { outcome: 'failed' };

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const ME_RESOURCE = '/me?$select=jobTitle,department,companyName,officeLocation';
const MANAGER_RESOURCE = '/me/manager?$select=displayName,mail,userPrincipalName';

/** Logins must never wait on Graph, so enrichment is abandoned past this budget */
const DEFAULT_TIMEOUT_MS = 5000;

function buildGraphRequestOptions(graphToken: string, signal: AbortSignal): RequestInit {
  const options: RequestInit = {
    signal,
    headers: {
      Authorization: `Bearer ${graphToken}`,
      'Content-Type': 'application/json',
    },
  };

  const dispatcher = getOpenIdProxyDispatcher();
  if (dispatcher) {
    options.dispatcher = dispatcher;
  }

  return options;
}

async function fetchGraphResource(
  resource: string,
  graphToken: string,
  signal: AbortSignal,
): Promise<GraphResourceResult> {
  const response = await undiciFetch(
    `${GRAPH_BASE_URL}${resource}`,
    buildGraphRequestOptions(graphToken, signal),
  );

  if (response.status === 404) {
    logger.debug(`[fetchDirectoryProfile] Microsoft Graph resource not found: ${resource}`);
    return { outcome: 'absent' };
  }

  if (!response.ok) {
    logger.warn(
      `[fetchDirectoryProfile] Microsoft Graph request failed for ${resource}: HTTP ${response.status} ${response.statusText}`,
    );
    return { outcome: 'failed' };
  }

  return { outcome: 'resolved', user: (await response.json()) as GraphDirectoryUser };
}

function rejectWhenAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

async function readDirectoryProfile(
  resolveGraphToken: () => Promise<string>,
  signal: AbortSignal,
): Promise<DirectoryProfile | null> {
  const graphToken = await resolveGraphToken();

  if (!graphToken) {
    logger.warn('[fetchDirectoryProfile] Graph token missing; cannot read directory attributes');
    return null;
  }

  const [me, manager] = await Promise.all([
    fetchGraphResource(ME_RESOURCE, graphToken, signal),
    fetchGraphResource(MANAGER_RESOURCE, graphToken, signal),
  ]);

  if (me.outcome !== 'resolved') {
    return null;
  }

  const profile: DirectoryProfile = {
    jobTitle: me.user.jobTitle ?? '',
    department: me.user.department ?? '',
    companyName: me.user.companyName ?? '',
    officeLocation: me.user.officeLocation ?? '',
  };

  if (manager.outcome === 'failed') {
    return profile;
  }

  if (manager.outcome === 'absent') {
    return { ...profile, managerName: '', managerEmail: '' };
  }

  return {
    ...profile,
    managerName: manager.user.displayName ?? '',
    managerEmail: manager.user.mail ?? manager.user.userPrincipalName ?? '',
  };
}

/**
 * Reads the signed-in user's job attributes and manager from Microsoft Graph.
 *
 * The token exchange and both Graph calls share a single deadline; outstanding requests are aborted
 * once it passes so a slow identity provider, proxy, or Graph can never hold up a login. Every
 * failure resolves to null, and a failed manager lookup omits the manager fields entirely rather
 * than blanking values that are already stored.
 *
 * @param options - Graph token resolver and optional timeout
 * @returns The resolved attributes, or null when the profile could not be read
 * @see https://learn.microsoft.com/en-us/graph/api/user-get
 * @see https://learn.microsoft.com/en-us/graph/api/user-list-manager
 */
export async function fetchDirectoryProfile(
  options: DirectoryProfileOptions,
): Promise<DirectoryProfile | null> {
  const { resolveGraphToken, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Directory profile lookup exceeded ${timeoutMs}ms`)),
    timeoutMs,
  );

  try {
    return await Promise.race([
      readDirectoryProfile(resolveGraphToken, controller.signal),
      rejectWhenAborted(controller.signal),
    ]);
  } catch (error) {
    if (controller.signal.aborted) {
      logger.warn(
        `[fetchDirectoryProfile] Abandoned after ${timeoutMs}ms; continuing login without directory attributes`,
      );
      return null;
    }

    logger.error(
      '[fetchDirectoryProfile] Failed to read directory attributes from Microsoft Graph:',
      error,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}
