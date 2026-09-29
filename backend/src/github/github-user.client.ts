import { GithubError, classifyStatus } from './github-errors';

export interface GithubUserClientOptions {
  apiBaseUrl: string;
  webBaseUrl: string;
  clientId: string;
  /** Called only during the code exchange; the secret is never stored on this object. */
  clientSecret: () => string;
  fetchImpl?: typeof fetch;
}

export interface GithubAccessibleInstallation {
  githubInstallationId: number;
  account: { githubId: string; login: string; type: 'ORGANIZATION' | 'USER' };
}

export interface GithubUserProfile {
  githubUserId: string;
  login: string;
  email: string | null;
  avatarUrl: string | null;
}

/**
 * Calls made on behalf of a signed-in user with a short-lived user credential (research R1).
 * The credential is a parameter of each call: it is never kept, logged or returned to a browser,
 * and callers drop it as soon as they have read what they need (spec FR-034).
 */
export class GithubUserClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: GithubUserClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Exchanges the one-time authorization code for a short-lived user credential. */
  async exchangeCode(code: string): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.options.webBaseUrl}/login/oauth/access_token`, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'codelens' },
        body: JSON.stringify({
          client_id: this.options.clientId,
          client_secret: this.options.clientSecret(),
          code,
        }),
      });
    } catch {
      throw new GithubError('GITHUB_UNAVAILABLE', 'GitHub could not be reached');
    }
    if (!response.ok) {
      throw new GithubError(classifyStatus(response.status), `GitHub answered with status ${response.status}`, response.status);
    }
    const body = (await response.json()) as { access_token?: string; error?: string };
    if (!body.access_token) {
      // Includes an expired or reused code. The upstream text is deliberately not kept.
      throw new GithubError('OTHER', 'GitHub did not accept the authorization code');
    }
    return body.access_token;
  }

  async getUser(userToken: string): Promise<GithubUserProfile> {
    const body = await this.getJson<{ id: number; login: string; email?: string | null; avatar_url?: string | null }>(
      '/user',
      userToken,
    );
    return {
      githubUserId: String(body.id),
      login: body.login,
      email: body.email ?? null,
      avatarUrl: body.avatar_url ?? null,
    };
  }

  /** Installations of this app that the user can access. GitHub decides; CodeLens only reads. */
  async listInstallations(userToken: string): Promise<GithubAccessibleInstallation[]> {
    const result: GithubAccessibleInstallation[] = [];
    for (let page = 1; page <= 20; page += 1) {
      const body = await this.getJson<{
        installations: { id: number; account: { id: number; login: string; type: string } }[];
      }>(`/user/installations?per_page=100&page=${page}`, userToken);
      for (const installation of body.installations) {
        result.push({
          githubInstallationId: installation.id,
          account: {
            githubId: String(installation.account.id),
            login: installation.account.login,
            type: installation.account.type === 'Organization' ? 'ORGANIZATION' : 'USER',
          },
        });
      }
      if (body.installations.length < 100) break;
    }
    return result;
  }

  private async getJson<T>(path: string, userToken: string): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.options.apiBaseUrl}${path}`, {
        headers: {
          authorization: `Bearer ${userToken}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': 'codelens',
        },
      });
    } catch {
      throw new GithubError('GITHUB_UNAVAILABLE', 'GitHub could not be reached');
    }
    if (!response.ok) {
      throw new GithubError(
        classifyStatus(response.status, response.headers.get('x-ratelimit-remaining')),
        `GitHub answered with status ${response.status}`,
        response.status,
      );
    }
    return (await response.json()) as T;
  }
}
