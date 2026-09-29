import { createHash, createPublicKey, createVerify, generateKeyPairSync, randomBytes } from 'node:crypto';
import http, { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Fake GitHub used by every test (spec SC-011). It implements only the calls Feature 001 makes,
 * verifies the App JWT signature so tests prove signing works, and can script failures.
 * All keys and tokens are generated at run time; nothing here is a real credential.
 */

export interface FakeRepo {
  id: number;
  name: string;
  owner: string;
  private?: boolean;
  defaultBranch?: string;
}

export interface FakeInstallation {
  id: number;
  account: { id: number; login: string; type: 'Organization' | 'User' };
  selection: 'all' | 'selected';
  suspended?: boolean;
  repos: FakeRepo[];
}

export interface FakeUser {
  id: number;
  login: string;
  email?: string;
}

interface Failure {
  match: RegExp;
  status: number;
  remaining: number;
  headers?: Record<string, string>;
}

export interface RecordedRequest {
  method: string;
  path: string;
  auth: 'jwt' | 'installation' | 'user' | 'none';
}

export class FakeGithub {
  readonly appId = '424242';
  readonly privateKeyPem: string;
  private readonly publicKeyPem: string;
  private server!: http.Server;

  url = '';
  /** Permissions reported for the app (GET /app). Change per test. */
  appPermissions: Record<string, string> = { metadata: 'read' };
  /** When false, the code returned on installation return is omitted (see authCode()). */
  installations = new Map<number, FakeInstallation>();
  users = new Map<number, FakeUser>();
  /** user id -> installation ids the user can access */
  userAccess = new Map<number, Set<number>>();
  /** `${userId}:${orgLogin}` -> GitHub organization role ("admin" for owners) */
  orgRoles = new Map<string, string>();
  requests: RecordedRequest[] = [];
  forceDown = false;
  /** Browser flows (used by the end-to-end run): who is signed in at github.com, and what happens on install. */
  browser = {
    userId: 0,
    declines: false,
    pendingInstallationId: 0,
    /** Where GitHub sends the browser after installation, for example http://localhost:8080/api/installations/callback */
    setupUrl: '',
    /** When false the installation return has no authorization code. */
    sendCode: true,
  };
  /** Artificial latency for matching requests, to prove slow GitHub work never delays a webhook reply. */
  latencies: { match: RegExp; ms: number }[] = [];

  private failures: Failure[] = [];
  private codes = new Map<string, number>(); // one-time code -> user id
  private userTokens = new Map<string, number>();
  private installationTokens = new Map<string, number>();

  constructor() {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    this.privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    this.publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  }

  async start(port = 0): Promise<this> {
    this.server = http.createServer((req, res) => void this.handle(req, res));
    const host = port === 0 ? '127.0.0.1' : '0.0.0.0';
    await new Promise<void>((resolve) => this.server.listen(port, host, resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  // -- test controls --------------------------------------------------------------------------

  addUser(user: FakeUser): this {
    this.users.set(user.id, user);
    return this;
  }

  addInstallation(installation: FakeInstallation, accessibleBy: number[] = []): this {
    this.installations.set(installation.id, installation);
    for (const userId of accessibleBy) this.grantAccess(userId, installation.id);
    return this;
  }

  removeInstallation(id: number): void {
    this.installations.delete(id);
    for (const set of this.userAccess.values()) set.delete(id);
  }

  grantAccess(userId: number, installationId: number): void {
    if (!this.userAccess.has(userId)) this.userAccess.set(userId, new Set());
    this.userAccess.get(userId)!.add(installationId);
  }

  revokeAccess(userId: number, installationId: number): void {
    this.userAccess.get(userId)?.delete(installationId);
  }

  setOrgRole(userId: number, orgLogin: string, role: string | null): void {
    const key = `${userId}:${orgLogin}`;
    if (role === null) this.orgRoles.delete(key);
    else this.orgRoles.set(key, role);
  }

  /** One-time authorization code for a user, as GitHub returns after user authorization. */
  authCode(userId: number): string {
    const code = `code-${randomBytes(8).toString('hex')}`;
    this.codes.set(code, userId);
    return code;
  }

  /** Next `times` requests whose path matches get `status` (for example 503 or 403 with rate limit). */
  failNext(match: RegExp, status: number, times = 1, headers?: Record<string, string>): void {
    this.failures.push({ match, status, remaining: times, headers });
  }

  clearFailures(): void {
    this.latencies = [];
    this.failures = [];
    this.forceDown = false;
  }

  countRequests(method: string, pathPrefix: string): number {
    return this.requests.filter((r) => r.method === method && r.path.startsWith(pathPrefix)).length;
  }

  // -- server ---------------------------------------------------------------------------------

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://fake');
    const path = url.pathname;
    const method = req.method ?? 'GET';
    const authHeader = req.headers.authorization ?? '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const kind = this.classify(bearer);
    this.requests.push({ method, path: path + url.search, auth: kind });

    const latency = this.latencies.find((l) => l.match.test(path + url.search));
    if (latency) await new Promise((resolve) => setTimeout(resolve, latency.ms));
    if (this.forceDown) return this.send(res, 503, { message: 'down' });
    const failure = this.failures.find((f) => f.remaining > 0 && f.match.test(path + url.search));
    if (failure) {
      failure.remaining -= 1;
      return this.send(res, failure.status, { message: 'scripted failure' }, failure.headers);
    }

    try {
      if (method === 'GET' && path === '/login/oauth/authorize') return this.browserAuthorize(res, url);
      const installPage = path.match(/^\/apps\/([^/]+)\/installations\/new$/);
      if (method === 'GET' && installPage) return this.browserInstall(res, url);
      if (method === 'POST' && path === '/login/oauth/access_token') return await this.exchange(req, res);
      if (method === 'GET' && path === '/user') return this.userRoute(res, bearer, (u) => ({ id: u.id, login: u.login, email: u.email ?? null, avatar_url: null }));
      if (method === 'GET' && path === '/user/installations') return this.userInstallations(res, bearer);
      const membership = path.match(/^\/user\/memberships\/orgs\/([^/]+)$/);
      if (method === 'GET' && membership) return this.membership(res, bearer, membership[1]);
      if (method === 'GET' && path === '/app') return this.appRoute(res, bearer, () => ({ id: Number(this.appId), permissions: this.appPermissions }));
      const one = path.match(/^\/app\/installations\/(\d+)$/);
      if (method === 'GET' && one) return this.appRoute(res, bearer, () => this.installationBody(Number(one[1]), res));
      const tokenRoute = path.match(/^\/app\/installations\/(\d+)\/access_tokens$/);
      if (method === 'POST' && tokenRoute) return this.issueInstallationToken(res, bearer, Number(tokenRoute[1]));
      if (method === 'GET' && path === '/installation/repositories') return this.repositories(res, bearer, url);
      return this.send(res, 404, { message: 'not implemented in fake' });
    } catch {
      return this.send(res, 500, { message: 'fake error' });
    }
  }

  /** github.com's authorization page: sends the browser back with a one-time code, or with an error. */
  private browserAuthorize(res: ServerResponse, url: URL): void {
    const redirect = url.searchParams.get('redirect_uri');
    const state = url.searchParams.get('state') ?? '';
    if (!redirect) return this.send(res, 400, { message: 'redirect_uri required' });
    const target = new URL(redirect);
    target.searchParams.set('state', state);
    if (this.browser.declines) target.searchParams.set('error', 'access_denied');
    else target.searchParams.set('code', this.authCode(this.browser.userId));
    res.writeHead(302, { location: target.toString() });
    res.end();
  }

  /** github.com's installation page: the person installs, and GitHub sends the browser to the setup URL. */
  private browserInstall(res: ServerResponse, url: URL): void {
    const target = new URL(this.browser.setupUrl);
    target.searchParams.set('installation_id', String(this.browser.pendingInstallationId));
    target.searchParams.set('setup_action', 'install');
    target.searchParams.set('state', url.searchParams.get('state') ?? '');
    if (this.browser.sendCode) target.searchParams.set('code', this.authCode(this.browser.userId));
    res.writeHead(302, { location: target.toString() });
    res.end();
  }

  private classify(bearer: string): RecordedRequest['auth'] {
    if (!bearer) return 'none';
    if (bearer.split('.').length === 3) return 'jwt';
    if (this.installationTokens.has(bearer)) return 'installation';
    if (this.userTokens.has(bearer)) return 'user';
    return 'none';
  }

  private jwtValid(token: string): boolean {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${parts[0]}.${parts[1]}`);
    if (!verifier.verify(createPublicKey(this.publicKeyPem), Buffer.from(parts[2], 'base64url'))) return false;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as { iss: string; exp: number };
    return payload.iss === this.appId && payload.exp * 1000 > Date.now() && payload.exp * 1000 - Date.now() <= 10 * 60 * 1000;
  }

  private async readBody(req: IncomingMessage): Promise<Record<string, string>> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString();
    if (!text) return {};
    try {
      return JSON.parse(text) as Record<string, string>;
    } catch {
      return Object.fromEntries(new URLSearchParams(text));
    }
  }

  private async exchange(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    const userId = this.codes.get(body.code ?? '');
    if (userId === undefined) return this.send(res, 200, { error: 'bad_verification_code' });
    this.codes.delete(body.code);
    const token = `ghu_fake_${randomBytes(12).toString('hex')}`;
    this.userTokens.set(token, userId);
    this.send(res, 200, { access_token: token, token_type: 'bearer', expires_in: 28800 });
  }

  private userOf(bearer: string): FakeUser | undefined {
    const id = this.userTokens.get(bearer);
    return id === undefined ? undefined : this.users.get(id);
  }

  private userRoute(res: ServerResponse, bearer: string, body: (u: FakeUser) => unknown): void {
    const user = this.userOf(bearer);
    if (!user) return this.send(res, 401, { message: 'Bad credentials' });
    this.send(res, 200, body(user));
  }

  private userInstallations(res: ServerResponse, bearer: string): void {
    const user = this.userOf(bearer);
    if (!user) return this.send(res, 401, { message: 'Bad credentials' });
    const ids = [...(this.userAccess.get(user.id) ?? [])];
    const list = ids.flatMap((id) => {
      const i = this.installations.get(id);
      return i ? [{ id: i.id, account: { id: i.account.id, login: i.account.login, type: i.account.type } }] : [];
    });
    this.send(res, 200, { total_count: list.length, installations: list });
  }

  private membership(res: ServerResponse, bearer: string, org: string): void {
    const user = this.userOf(bearer);
    if (!user) return this.send(res, 401, { message: 'Bad credentials' });
    const role = this.orgRoles.get(`${user.id}:${org}`);
    if (!role) return this.send(res, 404, { message: 'Not Found' });
    this.send(res, 200, { state: 'active', role, organization: { login: org } });
  }

  private appRoute(res: ServerResponse, bearer: string, body: () => unknown): void {
    if (!this.jwtValid(bearer)) return this.send(res, 401, { message: 'A JSON web token could not be decoded' });
    const value = body();
    if (value !== undefined) this.send(res, 200, value);
  }

  private installationBody(id: number, res: ServerResponse): unknown {
    const i = this.installations.get(id);
    if (!i) {
      this.send(res, 404, { message: 'Not Found' });
      return undefined;
    }
    return {
      id: i.id,
      account: { id: i.account.id, login: i.account.login, type: i.account.type, avatar_url: null },
      repository_selection: i.selection,
      suspended_at: i.suspended ? new Date().toISOString() : null,
      created_at: '2026-01-01T00:00:00Z',
    };
  }

  private issueInstallationToken(res: ServerResponse, bearer: string, id: number): void {
    if (!this.jwtValid(bearer)) return this.send(res, 401, { message: 'A JSON web token could not be decoded' });
    if (!this.installations.has(id)) return this.send(res, 404, { message: 'Not Found' });
    const token = `ghs_fake_${createHash('sha256').update(randomBytes(16)).digest('hex').slice(0, 24)}`;
    this.installationTokens.set(token, id);
    this.send(res, 201, { token, expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
  }

  private repositories(res: ServerResponse, bearer: string, url: URL): void {
    const installationId = this.installationTokens.get(bearer);
    if (installationId === undefined) return this.send(res, 401, { message: 'Bad credentials' });
    const installation = this.installations.get(installationId);
    if (!installation) return this.send(res, 404, { message: 'Not Found' });
    const perPage = Math.min(Number(url.searchParams.get('per_page') ?? 30), 100);
    const page = Math.max(Number(url.searchParams.get('page') ?? 1), 1);
    const slice = installation.repos.slice((page - 1) * perPage, page * perPage);
    this.send(res, 200, {
      total_count: installation.repos.length,
      repositories: slice.map((r) => ({
        id: r.id,
        name: r.name,
        full_name: `${r.owner}/${r.name}`,
        private: r.private ?? true,
        default_branch: r.defaultBranch ?? 'main',
        owner: { login: r.owner },
      })),
    });
  }

  private send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  }
}
