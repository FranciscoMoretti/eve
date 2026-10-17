import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { mock, test } from "node:test";

const fixtureRequire = createRequire(
  new URL("../e2e/fixtures/agent-cancellation/package.json", import.meta.url),
);
const queuePath = join(dirname(fixtureRequire.resolve("@workflow/world-postgres")), "queue.js");
const queueRequire = createRequire(queuePath);
let task;
let deliver;
let jobs;

mock.module(queueRequire.resolve("graphile-worker"), {
  namedExports: {
    Logger: class {},
    makeWorkerUtils: async () => ({
      migrate: async () => {},
      release: async () => {},
      addJob: async (_name, payload) => jobs.push(payload),
    }),
    run: async ({ taskList }) => {
      task = Object.values(taskList)[0];
      return { stop: async () => {}, promise: Promise.resolve() };
    },
  },
});
mock.module(queueRequire.resolve("@workflow/world-local"), {
  namedExports: { createWorld: () => ({}) },
});
mock.module(queueRequire.resolve("@workflow/world/node-http.js"), {
  namedExports: {
    createNodeHttpAgents: () => ({}),
    destroyNodeHttpAgents: () => {},
    nodeHttpFetch: async (_url, options) => deliver(JSON.parse(options.body)),
  },
});
const { createQueue } = await import(pathToFileURL(queuePath).href);

async function fixture(t) {
  jobs = [];
  // The transport is mocked; this non-loopback name avoids opening a readiness socket.
  const original = process.env.WORKFLOW_LOCAL_BASE_URL;
  process.env.WORKFLOW_LOCAL_BASE_URL = "http://queue.test";
  const queue = createQueue({}, { query: async () => ({ rows: [{ exists: false }] }) });
  t.after(async () => {
    await queue.close();
    if (original === undefined) delete process.env.WORKFLOW_LOCAL_BASE_URL;
    else process.env.WORKFLOW_LOCAL_BASE_URL = original;
  });
  await queue.start();
  return async (options) => {
    await queue.queue("__wkf_workflow_test", { runId: "wrun_test" }, options);
    return jobs.at(-1);
  };
}

test(
  "a hook wake reaches an active workflow before its inline model step settles",
  { timeout: 1000 },
  async (t) => {
    const enqueue = await fixture(t);
    const firstStarted = Promise.withResolvers();
    const wakeStarted = Promise.withResolvers();
    const finishModel = Promise.withResolvers();
    t.after(() => finishModel.resolve());
    let calls = 0;
    deliver = async () => {
      if (++calls === 1) {
        firstStarted.resolve();
        await finishModel.promise;
      } else wakeStarted.resolve();
      return new Response("{}");
    };
    const first = task(await enqueue(), {});
    await firstStarted.promise;
    const wake = task(await enqueue(), {});
    await wakeStarted.promise;
    assert.equal(calls, 2);
    finishModel.resolve();
    await Promise.all([first, wake]);
  },
);

test("duplicate idempotency keys still share one delivery and remain deduplicated", async (t) => {
  const enqueue = await fixture(t);
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  t.after(() => release.resolve());
  let calls = 0;
  deliver = async () => {
    calls++;
    started.resolve();
    await release.promise;
    return new Response("{}");
  };
  const payload = await enqueue({ idempotencyKey: "same-delivery" });
  const first = task(payload, {});
  await started.promise;
  const duplicate = task(payload, {});
  release.resolve();
  await Promise.all([first, duplicate]);
  await task(payload, {});
  assert.equal(calls, 1);
});

test("a failed delivery remains retryable with the same idempotency key", async (t) => {
  const enqueue = await fixture(t);
  let calls = 0;
  deliver = async () =>
    new Response(++calls === 1 ? "retry" : "{}", { status: calls === 1 ? 503 : 200 });
  const payload = await enqueue({ idempotencyKey: "retry-delivery" });
  await assert.rejects(task(payload, {}), /Queue execution failed \(503\)/);
  await task(payload, {});
  await task(payload, {});
  assert.equal(calls, 2);
});

test("a suspended invocation enqueues its successor before acknowledging delivery", async (t) => {
  const enqueue = await fixture(t);
  let calls = 0;
  deliver = async () => new Response(++calls === 1 ? '{"timeoutSeconds":1}' : "{}");
  const payload = await enqueue({ idempotencyKey: "suspended-delivery" });
  await task(payload, {});
  assert.equal(jobs.length, 2);
  assert.equal(jobs[1].attempt, payload.attempt + 1);
  assert.equal(jobs[1].idempotencyKey, payload.idempotencyKey);
  await task(jobs[1], {});
  assert.equal(calls, 2);
});
