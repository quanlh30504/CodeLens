import { readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import { parse } from 'yaml';

/** Loads specs/001-github-app-onboarding/contracts/api.openapi.yaml and validates bodies against it. */
const specPath = path.resolve(__dirname, '../../../specs/001-github-app-onboarding/contracts/api.openapi.yaml');
export const openapi = parse(readFileSync(specPath, 'utf8')) as {
  paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
  components: Record<string, unknown>;
};

const ajv = new Ajv({ strict: false, allErrors: true });

function resolve(node: unknown): unknown {
  if (node && typeof node === 'object' && '$ref' in node) {
    const ref = (node as { $ref: string }).$ref.replace('#/', '').split('/');
    let current: unknown = openapi;
    for (const part of ref) current = (current as Record<string, unknown>)[part];
    return resolve(current);
  }
  return node;
}

export function responseSchema(pathKey: string, method: string, status: number | string): object | undefined {
  const response = resolve(openapi.paths[pathKey]?.[method.toLowerCase()]?.responses?.[String(status)]) as
    | { content?: Record<string, { schema?: unknown }> }
    | undefined;
  if (!response) throw new Error(`Contract has no ${method} ${pathKey} ${status} response`);
  return response.content?.['application/json']?.schema as object | undefined;
}

/** Throws with the validation errors when `body` does not match the documented response. */
export function expectMatchesContract(pathKey: string, method: string, status: number, body: unknown): void {
  const schema = responseSchema(pathKey, method, status);
  if (!schema) {
    if (body !== undefined && body !== '' && !(typeof body === 'object' && Object.keys(body as object).length === 0)) {
      throw new Error(`Contract documents no body for ${method} ${pathKey} ${status}`);
    }
    return;
  }
  const validate = ajv.compile({ ...schema, components: openapi.components });
  if (!validate(body)) {
    throw new Error(`Response does not match contract: ${ajv.errorsText(validate.errors)}`);
  }
}

export function documentedStatuses(pathKey: string, method: string): string[] {
  return Object.keys(openapi.paths[pathKey]?.[method.toLowerCase()]?.responses ?? {});
}
