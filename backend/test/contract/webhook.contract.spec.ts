import { fixtures, sign } from '../fakes/webhook-fixtures';
import { World, startWorld } from '../integration/scenario';
import { deliver } from '../integration/webhook-helpers';
import { documentedStatuses, expectMatchesContract } from './openapi';

/** POST /webhooks/github answers exactly as documented (FR-028). */
describe('webhook contract', () => {
  let world: World;

  beforeAll(async () => {
    world = await startWorld();
  });

  afterAll(async () => {
    await world.stop();
  });

  it('documents 202, 400 and 401', () => {
    expect(documentedStatuses('/webhooks/github', 'post')).toEqual(expect.arrayContaining(['202', '400', '401']));
  });

  it('202 for an authentic delivery and for its repeat', async () => {
    const webhook = fixtures.ping();
    for (let i = 0; i < 2; i += 1) {
      const response = await deliver(world.app, webhook);
      expect(response.status).toBe(202);
      expectMatchesContract('/webhooks/github', 'post', 202, response.body);
    }
  });

  it('400 for a malformed delivery whose signature is valid', async () => {
    const webhook = fixtures.ping();
    const response = await deliver(world.app, webhook, { headers: { 'x-github-event': undefined } });
    expect(response.status).toBe(400);
    expectMatchesContract('/webhooks/github', 'post', 400, response.body);
  });

  it('401 for a wrong signature, without a session cookie being needed or issued', async () => {
    const webhook = fixtures.ping();
    const response = await deliver(world.app, webhook, { headers: { 'x-hub-signature-256': sign(webhook.body, 'nope') } });
    expect(response.status).toBe(401);
    expectMatchesContract('/webhooks/github', 'post', 401, response.body);
    expect(response.headers['set-cookie']).toBeUndefined();
  });
});
