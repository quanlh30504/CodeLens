import { createPrivateKey, createSign } from 'node:crypto';
import { GithubError, classifyStatus } from './github-errors';

export interface GithubAppClientOptions {
  appId: string;
  apiBaseUrl: string;
  /** Called only when a JWT must be signed. The key is never stored on this object. */
  privateKey: () => string;
  fetchImpl?: typeof fetch;
  now?: () => number; // epoch seconds
}

export interface GithubInstallationInfo {
  githubInstallationId: number;
  account: { githubId: string; login: string; type: 'ORGANIZATION' | 'USER'; avatarUrl: string | null };
  repositorySelection: 'ALL' | 'SELECTED';
  suspendedAt: Date | null;
  installedAt: Date;
}

export interface GithubRepositoryInfo {
  githubRepositoryId: number;
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string | null;
}

export interface GithubAppInfo {
  /** Permission name -> access level exactly as granted to the app (for example "metadata": "read"). */
  permissions: Record<string, string>;
}

const PAGE_SIZE = 100;

/**
 * Read-only GitHub App client (Constitution II; spec FR-032, FR-034).
 *
 * There is no method that writes to repositories, workflows, settings, issues or pull requests,
 * and none may be added by this feature. The single POST it performs is the token exchange
 * GitHub requires to obtain a short-lived installation token; that token is held in memory only
 * and is never logged, persisted or returned to a client.
 */
export class GithubAppClient {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly tokens = new Map<number, { token: string; expiresAt: number }>();

  constructor(private readonly options: GithubAppClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
  }

  /** The app's own metadata, including the permissions granted to it (startup permission check). */
  async getApp(): Promise<GithubAppInfo> {
    const body = await this.getJson<{ permissions?: Record<string, string> }>('/app', this.appJwt());
    return { permissions: body.permissions ?? {} };
  }

  /** Returns null when GitHub reports the installation does not exist (it was uninstalled). */
  async getInstallation(githubInstallationId: number): Promise<GithubInstallationInfo | null> {
    const response = await this.request('GET', `/app/installations/${githubInstallationId}`, this.appJwt());
    if (response.status === 404) return null;
    const body = (await this.parse(response)) as {
      id: number;
      account: { id: number; login: string; type: string; avatar_url?: string | null };
      repository_selection: string;
      suspended_at: string | null;
      created_at: string;
    };
    return {
      githubInstallationId: body.id,
      account: {
        githubId: String(body.account.id),
        login: body.account.login,
        type: body.account.type === 'Organization' ? 'ORGANIZATION' : 'USER',
        avatarUrl: body.account.avatar_url ?? null,
      },
      repositorySelection: body.repository_selection === 'all' ? 'ALL' : 'SELECTED',
      suspendedAt: body.suspended_at ? new Date(body.suspended_at) : null,
      installedAt: new Date(body.created_at),
    };
  }

  /**
   * All repositories the installation can access, in ascending GitHub repository id order so a
   * truncated list is the same on every run (spec FR-011). Fetches at most `limit + 1` entries.
   */
  async listInstallationRepositories(
    githubInstallationId: number,
    limit = 5000,
  ): Promise<{ repositories: GithubRepositoryInfo[]; truncated: boolean }> {
    const token = await this.installationToken(githubInstallationId);
    const all: GithubRepositoryInfo[] = [];
    for (let page = 1; ; page += 1) {
      const body = await this.getJson<{
        repositories: {
          id: number;
          name: string;
          full_name: string;
          private: boolean;
          default_branch?: string | null;
          owner: { login: string };
        }[];
      }>(`/installation/repositories?per_page=${PAGE_SIZE}&page=${page}`, token);
      for (const r of body.repositories) {
        all.push({
          githubRepositoryId: r.id,
          owner: r.owner.login,
          name: r.name,
          fullName: r.full_name,
          private: r.private,
          defaultBranch: r.default_branch ?? null,
        });
      }
      if (body.repositories.length < PAGE_SIZE) break;
    }
    all.sort((a, b) => a.githubRepositoryId - b.githubRepositoryId);
    return { repositories: all.slice(0, limit), truncated: all.length > limit };
  }

  /** Whether the installation still lists the repository (used for transfer decisions, research R7). */
  async installationHasRepository(githubInstallationId: number, githubRepositoryId: number): Promise<boolean> {
    const { repositories } = await this.listInstallationRepositories(githubInstallationId, Number.MAX_SAFE_INTEGER);
    return repositories.some((r) => r.githubRepositoryId === githubRepositoryId);
  }

  // -- internals ------------------------------------------------------------------------------

  private async installationToken(githubInstallationId: number): Promise<string> {
    const cached = this.tokens.get(githubInstallationId);
    if (cached && cached.expiresAt - 60 > this.now()) return cached.token;

    // Token exchange required by GitHub; not a write to any repository resource.
    const response = await this.request('POST', `/app/installations/${githubInstallationId}/access_tokens`, this.appJwt());
    const body = (await this.parse(response)) as { token: string; expires_at: string };
    this.tokens.set(githubInstallationId, {
      token: body.token,
      expiresAt: Math.floor(new Date(body.expires_at).getTime() / 1000),
    });
    return body.token;
  }

  /** RS256 JWT valid for at most 10 minutes, as GitHub requires. */
  private appJwt(): string {
    const now = this.now();
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ iat: now - 30, exp: now + 9 * 60, iss: this.options.appId }),
    ).toString('base64url');
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${payload}`);
    const signature = signer.sign(createPrivateKey(this.options.privateKey())).toString('base64url');
    return `${header}.${payload}.${signature}`;
  }

  private async request(method: 'GET' | 'POST', path: string, bearer: string): Promise<Response> {
    try {
      return await this.fetchImpl(`${this.options.apiBaseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${bearer}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': 'codelens',
        },
      });
    } catch {
      throw new GithubError('GITHUB_UNAVAILABLE', 'GitHub could not be reached');
    }
  }

  private async parse(response: Response): Promise<unknown> {
    if (!response.ok) {
      throw new GithubError(
        classifyStatus(response.status, response.headers.get('x-ratelimit-remaining')),
        `GitHub answered with status ${response.status}`,
        response.status,
      );
    }
    return response.json();
  }

  private async getJson<T>(path: string, bearer: string): Promise<T> {
    return (await this.parse(await this.request('GET', path, bearer))) as T;
  }
}
