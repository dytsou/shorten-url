import { vi } from "vitest";

export const tracing = {
  enterSpan(_name, callback) {
    return callback({ isTraced: false, setAttribute() {} });
  },
};

export function createAssetsBinding(routes = {}) {
  const calls = [];
  return {
    calls,
    fetch: vi.fn(async (request) => {
      calls.push(request);
      const response = routes[new URL(request.url).pathname];
      return response ? response.clone() : new Response("missing", { status: 404 });
    }),
  };
}

export function createWorkerEnvironment({ assets, links, flags, ...overrides } = {}) {
  return {
    ...(assets ? { ASSETS: assets } : {}),
    LINKS: links || { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
    ...(flags ? { FLAGS: flags } : {}),
    ...overrides,
  };
}

export function mockedAccessHeaders() {
  return {
    "Cf-Access-Jwt-Assertion": "token",
    "Cf-Access-Authenticated-User-Email": "operator@example.com",
  };
}
