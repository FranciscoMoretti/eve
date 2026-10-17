# Postgres workflow wakes

`@workflow/world-postgres@5.0.0-beta.44` serializes non-idempotency-key
workflow deliveries by run until the earlier HTTP invocation returns. An invocation
can remain active while executing an inline model step. A second delivery must be
able to replay the durable inbox and signal that step before it completes; waiting
for the original invocation blocks both steering and cancellation.

The patch removes that run-wide queue lock. It retains message-key deduplication,
retry handling, and successor scheduling. eve's vendored Workflow core already
registers all inline step executions with `runStepSingleFlight`; concurrent wakes
must not execute an already-running step again. Keep that protection when upgrading
Workflow. Remove this patch once the selected adapter supports concurrent wakes
and the regression tests pass without it.

Run the deterministic transport tests without Postgres or provider credentials:

```sh
node --experimental-test-module-mocks --test scripts/workflow-postgres-queue.test.mjs
```

The first test holds the original HTTP invocation behind a promise and requires
the second wake to reach the handler before releasing it. The unpatched adapter
times out. The remaining tests cover duplicate delivery, retry, and rescheduling.
The existing `cancellation/steer-pending-generation` eval supplies the full
Postgres runtime check in CI; its assertions and model timing are unchanged.

This workspace dependency patch is not shipped inside the published eve package.
ChatJS production must apply the equivalent change to its selected Postgres
adapter. No companion ChatJS change is included in this branch.
