import { beforeAll, describe, expect, it, vi } from "vitest";

let exampleWorker;

function env() {
  return {
    LINKS: { get: vi.fn(), put: vi.fn() },
    FLAGS: {
      getObjectDetails: vi.fn().mockResolvedValue({
        flagKey: "shorten-routing",
        value: { url: "https://variant.example/shorten" },
        variant: "sg",
        reason: "TARGETING_MATCH",
      }),
    },
  };
}

function request(url, country = "SG") {
  const result = new Request(url, {
    headers: {
      "Cf-Access-Jwt-Assertion": "token",
      "Cf-Access-Authenticated-User-Email": "operator@example.com",
    },
  });
  Object.defineProperty(result, "cf", { value: { country } });
  return result;
}

describe("Worker entrypoint parity", () => {
  beforeAll(async () => {
    ({ default: exampleWorker } = await import("../src/worker.example.js"));
  });

  it("routes the example root page through one Flagship evaluation", async () => {
    const workerEnv = env();
    const response = await exampleWorker.fetch(request("https://short.example/"), workerEnv);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://variant.example/shorten");
    expect(workerEnv.FLAGS.getObjectDetails).toHaveBeenCalledTimes(1);
  });

  it("does not evaluate redirects", async () => {
    const workerEnv = env();
    workerEnv.LINKS.get.mockResolvedValue("https://destination.example");
    const response = await exampleWorker.fetch(request("https://short.example/abc"), workerEnv);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://destination.example/");
    expect(workerEnv.FLAGS.getObjectDetails).not.toHaveBeenCalled();
  });
});
