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

interface GraphDirectoryUser {
  jobTitle?: string | null;
  department?: string | null;
  companyName?: string | null;
  officeLocation?: string | null;
  displayName?: string | null;
  mail?: string | null;
  userPrincipalName?: string | null;
}

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const ME_RESOURCE = '/me?$select=jobTitle,department,companyName,officeLocation';
const MANAGER_RESOURCE = '/me/manager?$select=displayName,mail,userPrincipalName';

function buildGraphRequestOptions(graphToken: string): RequestInit {
  const options: RequestInit = {
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
): Promise<GraphDirectoryUser | null> {
  const response = await undiciFetch(
    `${GRAPH_BASE_URL}${resource}`,
    buildGraphRequestOptions(graphToken),
  );

  /** Users without a manager yield 404, which is expected rather than an error */
  if (response.status === 404) {
    logger.debug(`[fetchDirectoryProfile] Microsoft Graph resource not found: ${resource}`);
    return null;
  }

  if (!response.ok) {
    logger.warn(
      `[fetchDirectoryProfile] Microsoft Graph request failed for ${resource}: HTTP ${response.status} ${response.statusText}`,
    );
    return null;
  }

  return (await response.json()) as GraphDirectoryUser;
}

/**
 * Reads the signed-in user's job attributes and manager from Microsoft Graph.
 *
 * Requires a Graph-scoped token obtained through the OBO flow; the app-audience token from the
 * OpenID tokenset is rejected by Graph.
 *
 * @param graphToken - Graph-scoped access token, as returned by the OBO exchange
 * @returns The resolved attributes, or null when Graph is unreachable or returns an error
 * @see https://learn.microsoft.com/en-us/graph/api/user-get
 * @see https://learn.microsoft.com/en-us/graph/api/user-list-manager
 */
export async function fetchDirectoryProfile(graphToken: string): Promise<DirectoryProfile | null> {
  if (!graphToken) {
    logger.warn('[fetchDirectoryProfile] Graph token missing; cannot read directory attributes');
    return null;
  }

  try {
    const [me, manager] = await Promise.all([
      fetchGraphResource(ME_RESOURCE, graphToken),
      fetchGraphResource(MANAGER_RESOURCE, graphToken),
    ]);

    if (!me) {
      return null;
    }

    return {
      jobTitle: me.jobTitle ?? '',
      department: me.department ?? '',
      companyName: me.companyName ?? '',
      officeLocation: me.officeLocation ?? '',
      managerName: manager?.displayName ?? '',
      managerEmail: manager?.mail ?? manager?.userPrincipalName ?? '',
    };
  } catch (error) {
    logger.error(
      '[fetchDirectoryProfile] Failed to read directory attributes from Microsoft Graph:',
      error,
    );
    return null;
  }
}
