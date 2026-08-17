import { fetch as undiciFetch, Response } from 'undici';
import { getOpenIdProxyDispatcher } from '~/utils/proxy';
import { fetchDirectoryProfile } from './profile';

jest.mock('undici', () => {
  const actual = jest.requireActual('undici');
  return { ...actual, fetch: jest.fn() };
});

jest.mock('~/utils/proxy', () => ({
  getOpenIdProxyDispatcher: jest.fn(),
}));

jest.mock('@librechat/data-schemas', () => {
  const actual = jest.requireActual('@librechat/data-schemas');
  return {
    ...actual,
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  };
});

const mockFetch = jest.mocked(undiciFetch);
const mockGetDispatcher = jest.mocked(getOpenIdProxyDispatcher);

const GRAPH_TOKEN = 'graph-access-token';

const jsonResponse = (body: Record<string, string | null>, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const emptyResponse = (status: number, statusText: string): Response =>
  new Response(null, { status, statusText });

/** A response body can only be read once, so every call needs its own instance */
const alwaysJsonResponse = (body: Record<string, string | null>): void => {
  mockFetch.mockImplementation(async () => jsonResponse(body));
};

describe('fetchDirectoryProfile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDispatcher.mockReturnValue(undefined);
  });

  it('resolves job attributes and manager from Microsoft Graph', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          jobTitle: 'Staff Engineer',
          department: 'Platform',
          companyName: 'FDJ United',
          officeLocation: 'Paris',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ displayName: 'Marie Dupont', mail: 'marie.dupont@example.com' }),
      );

    const profile = await fetchDirectoryProfile(GRAPH_TOKEN);

    expect(profile).toEqual({
      jobTitle: 'Staff Engineer',
      department: 'Platform',
      companyName: 'FDJ United',
      officeLocation: 'Paris',
      managerName: 'Marie Dupont',
      managerEmail: 'marie.dupont@example.com',
    });
  });

  it('requests the user and manager resources with a bearer token', async () => {
    alwaysJsonResponse({});

    await fetchDirectoryProfile(GRAPH_TOKEN);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [[meUrl, meOptions], [managerUrl]] = mockFetch.mock.calls;
    expect(meUrl).toBe(
      'https://graph.microsoft.com/v1.0/me?$select=jobTitle,department,companyName,officeLocation',
    );
    expect(managerUrl).toBe(
      'https://graph.microsoft.com/v1.0/me/manager?$select=displayName,mail,userPrincipalName',
    );
    expect(meOptions?.headers).toMatchObject({ Authorization: `Bearer ${GRAPH_TOKEN}` });
    expect(meOptions?.dispatcher).toBeUndefined();
  });

  it('falls back to the manager userPrincipalName when no mail is set', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ jobTitle: 'Analyst' })).mockResolvedValueOnce(
      jsonResponse({
        displayName: 'Jean Martin',
        mail: null,
        userPrincipalName: 'jean.martin@example.com',
      }),
    );

    const profile = await fetchDirectoryProfile(GRAPH_TOKEN);

    expect(profile).toMatchObject({
      managerName: 'Jean Martin',
      managerEmail: 'jean.martin@example.com',
    });
  });

  it('returns empty manager fields when the user has no manager', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ jobTitle: 'Head of Data', department: 'Data' }))
      .mockResolvedValueOnce(emptyResponse(404, 'Not Found'));

    const profile = await fetchDirectoryProfile(GRAPH_TOKEN);

    expect(profile).toEqual({
      jobTitle: 'Head of Data',
      department: 'Data',
      companyName: '',
      officeLocation: '',
      managerName: '',
      managerEmail: '',
    });
  });

  it('normalizes missing attributes to empty strings', async () => {
    alwaysJsonResponse({});

    const profile = await fetchDirectoryProfile(GRAPH_TOKEN);

    expect(profile).toEqual({
      jobTitle: '',
      department: '',
      companyName: '',
      officeLocation: '',
      managerName: '',
      managerEmail: '',
    });
  });

  it('returns null when the user lookup is rejected by Graph', async () => {
    mockFetch.mockResolvedValue(emptyResponse(403, 'Forbidden'));

    await expect(fetchDirectoryProfile(GRAPH_TOKEN)).resolves.toBeNull();
  });

  it('returns null when the Graph request throws', async () => {
    mockFetch.mockRejectedValue(new Error('network unreachable'));

    await expect(fetchDirectoryProfile(GRAPH_TOKEN)).resolves.toBeNull();
  });

  it('returns null without calling Graph when no token is provided', async () => {
    await expect(fetchDirectoryProfile('')).resolves.toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('routes requests through the proxy dispatcher when one is configured', async () => {
    const dispatcher = jest.mocked({} as ReturnType<typeof getOpenIdProxyDispatcher>);
    mockGetDispatcher.mockReturnValue(dispatcher);
    alwaysJsonResponse({});

    await fetchDirectoryProfile(GRAPH_TOKEN);

    const [[, meOptions]] = mockFetch.mock.calls;
    expect(meOptions?.dispatcher).toBe(dispatcher);
  });
});
