import http from 'node:http';
import { FakeGithub, FakeInstallation } from './fake-github';

/**
 * Runs the fake GitHub as a standalone server for the `test` compose profile.
 * Keys are generated at start-up and printed nowhere; the API in that profile is given the
 * matching key through the shared volume file below.
 */
async function main(): Promise<void> {
  const port = Number(process.env.FAKE_GITHUB_PORT ?? 4010);
  const github = new FakeGithub();
  await github.start(port);
  if (process.env.FAKE_GITHUB_PERMISSIONS) github.appPermissions = JSON.parse(process.env.FAKE_GITHUB_PERMISSIONS) as Record<string, string>;
  const keyPath = process.env.FAKE_GITHUB_KEY_FILE;
  if (keyPath) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(keyPath, github.privateKeyPem, { mode: 0o400 });
  }
  if (process.env.FAKE_GITHUB_CONTROL_PORT) startControl(github, Number(process.env.FAKE_GITHUB_CONTROL_PORT));
  process.stdout.write(`fake github listening on ${github.url} (app id ${github.appId})\n`);
}

/**
 * A tiny JSON control interface for the end-to-end run, on its own port so it is never reachable
 * through the fake GitHub's public address. It only changes the fake's pretend GitHub state.
 */
function startControl(github: FakeGithub, port: number): void {
  http
    .createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = chunks.length ? (JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>) : {};
        const reply = (status: number, value: unknown = { ok: true }) => {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(value));
        };
        switch (req.url) {
          case '/reset':
            github.installations.clear();
            github.users.clear();
            github.userAccess.clear();
            github.orgRoles.clear();
            github.clearFailures();
            return reply(200);
          case '/user':
            github.addUser(body as { id: number; login: string });
            return reply(200);
          case '/installation': {
            const { users, ...installation } = body as unknown as FakeInstallation & { users?: number[] };
            github.addInstallation(installation, users ?? []);
            return reply(200);
          }
          case '/remove-installation':
            github.removeInstallation(Number(body.id));
            return reply(200);
          case '/latency':
            github.latencies = [{ match: new RegExp(String(body.match)), ms: Number(body.ms) }];
            return reply(200);
          case '/browser':
            Object.assign(github.browser, body);
            return reply(200);
          default:
            return reply(404, { ok: false });
        }
      });
    })
    .listen(port, '127.0.0.1');
}

void main();
