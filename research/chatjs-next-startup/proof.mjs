import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const proofRoot = path.dirname(fileURLToPath(import.meta.url));
const modules = path.join(proofRoot, "node_modules");
const root = await realpath(await mkdtemp(path.join(tmpdir(), "eve080-next-")));
const agents = ["primary", "guest"];
const packageInfo = JSON.parse(await readFile(path.join(modules, "eve/package.json"), "utf8"));
assert.equal(packageInfo.version, "0.80.1");
assert.equal(process.versions.node.split(".")[0], "24", "Use Node 24 for this proof");

async function reserve(port = 0) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server;
}
async function freePair() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const first = await reserve();
    const port = first.address().port;
    try {
      const second = await reserve(port + 1);
      await Promise.all([
        new Promise((resolve) => first.close(resolve)),
        new Promise((resolve) => second.close(resolve)),
      ]);
      return port;
    } catch {
      await new Promise((resolve) => first.close(resolve));
    }
  }
  throw new Error("Could not reserve adjacent proof ports");
}
const basePort = await freePair();
let nextPort;
do {
  const hostReservation = await reserve();
  nextPort = hostReservation.address().port;
  await new Promise((resolve) => hostReservation.close(resolve));
} while (nextPort === basePort || nextPort === basePort + 1);
const env = {
  PATH: `${path.dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin`,
  HOME: root,
  TMPDIR: tmpdir(),
  NODE_ENV: "production",
  NEXT_TELEMETRY_DISABLED: "1",
  EVE_NEXT_PRODUCTION_PORT: String(basePort),
  EVE_PROOF_LOG: path.join(root, "config.jsonl"),
};
const running = new Set();
const commandResults = [];
function launch(args, cwd, label, extra = {}) {
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...env, ...extra },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  running.add(child);
  let output = "";
  const chunks = [];
  for (const pipe of [child.stdout, child.stderr])
    pipe.on("data", (chunk) => {
      output += chunk;
      chunks.push(chunk);
    });
  const completion = once(child, "exit").then(async ([code, signal]) => {
    await writeFile(path.join(root, `${label}.log`), Buffer.concat(chunks));
    return { code, signal };
  });
  return { child, completion, output: () => output, label };
}
async function stop(processHandle) {
  const hasGroup = () =>
    execFileSync("ps", ["-axo", "pgid="], { encoding: "utf8" })
      .split("\n")
      .some((value) => Number(value.trim()) === processHandle.child.pid);
  if (!hasGroup()) {
    running.delete(processHandle.child);
    return;
  }
  try {
    process.kill(-processHandle.child.pid, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH" && hasGroup()) throw error;
  }
  await Promise.race([processHandle.completion, delay(5000)]);
  try {
    process.kill(-processHandle.child.pid, "SIGKILL");
  } catch (error) {
    if (error.code !== "ESRCH" && hasGroup()) throw error;
  }
  running.delete(processHandle.child);
}
async function command(args, cwd, label) {
  const processHandle = launch(args, cwd, label);
  const timer = setTimeout(() => {
    try {
      process.kill(-processHandle.child.pid, "SIGKILL");
    } catch {}
  }, 180000);
  try {
    const result = await processHandle.completion;
    assert.equal(result.code, 0, `${label}: ${processHandle.output().slice(-6000)}`);
    commandResults.push({ label, exitCode: result.code });
  } finally {
    clearTimeout(timer);
    await stop(processHandle);
  }
}
async function until(check, label, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error(`${label} timed out; evidence: ${root}`);
}
async function health(port, route = "/eve/v1/health") {
  try {
    return (await fetch(`http://127.0.0.1:${port}${route}`, { signal: AbortSignal.timeout(1500) }))
      .status;
  } catch {
    return 0;
  }
}
function workers() {
  return execFileSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8" })
    .split("\n")
    .filter((line) =>
      agents.some((name) => line.includes(path.join(root, name, ".output/server/index.mjs"))),
    )
    .map((line) => line.trim());
}

await symlink(modules, path.join(root, "node_modules"));
await writeFile(
  path.join(root, "package.json"),
  JSON.stringify({
    private: true,
    type: "module",
    dependencies: {
      eve: "0.80.1",
      next: "16.3.0",
      react: "19.2.3",
      "react-dom": "19.2.3",
      ai: "7.0.137",
    },
  }),
);
await mkdir(path.join(root, "app"));
await writeFile(
  path.join(root, "app/layout.js"),
  "export default function Layout({children}) { return <html><body>{children}</body></html>; }",
);
await writeFile(
  path.join(root, "app/page.js"),
  "export default function Page() { return <main>native startup proof</main>; }",
);
for (const name of agents) {
  const agentRoot = path.join(root, name);
  await mkdir(path.join(agentRoot, "agent/channels"), { recursive: true });
  await writeFile(
    path.join(agentRoot, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: { eve: "0.80.1", ai: "7.0.137" },
    }),
  );
  await writeFile(
    path.join(agentRoot, "agent/agent.mjs"),
    `import {defineAgent} from 'eve'; import {mockModel} from 'eve/evals'; export default defineAgent({defaultTools:false,description:${JSON.stringify(name)},model:mockModel(${JSON.stringify(name)})});`,
  );
  await writeFile(
    path.join(agentRoot, "agent/instructions.md"),
    `You are the ${name} startup fixture.`,
  );
  await writeFile(
    path.join(agentRoot, "agent/channels/eve.mjs"),
    "import {eveChannel} from 'eve/channels/eve'; export default eveChannel({auth:()=>({attributes:{},authenticator:'startup-fixture',principalId:'owner',principalType:'user'})});",
  );
}
await writeFile(
  path.join(root, "next.config.mjs"),
  `import {withEve} from 'eve/next';
import {appendFileSync} from 'node:fs';
const wrapped=withEve({}, {agents:{primary:'./primary',guest:'./guest'}});
export default async function config(phase,context) {
 appendFileSync(process.env.EVE_PROOF_LOG,JSON.stringify({kind:'config',phase,pid:process.pid})+'\\n');
 const selected=process.env.EVE_PROOF_DISABLE_STARTUP==='1'&&phase==='phase-production-server'?'phase-production-build':phase;
 const configs=await Promise.all([wrapped(selected,context),wrapped(selected,context),wrapped(selected,context)]);
 const result=configs[0];
 return {...result,rewrites:async()=>{appendFileSync(process.env.EVE_PROOF_LOG,JSON.stringify({kind:'rewrites',phase,pid:process.pid})+'\\n');return await result.rewrites();}};
}`,
);
await writeFile(
  path.join(root, "retry.mjs"),
  `import assert from 'node:assert/strict';
import {withEve} from 'eve/next';
import {rename,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const entry='./primary/.output/server/index.mjs';
const config=withEve({}, {agents:{primary:'./primary',guest:'./guest'}});
await rename(entry,entry+'.saved');
await writeFile(entry,"throw new Error('deliberate startup failure before readiness');");
try {await assert.rejects(config('phase-production-server',{defaultConfig:{}}),/exited before printing its server URL/);} finally {await rename(entry+'.saved',entry);}
await Promise.all([config('phase-production-server',{defaultConfig:{}}),config('phase-production-server',{defaultConfig:{}})]);
await config('phase-production-server',{defaultConfig:{}});
const statuses=await Promise.all([0,1].map(async offset=>(await fetch('http://127.0.0.1:'+(Number(process.env.EVE_NEXT_PRODUCTION_PORT)+offset)+'/eve/v1/health')).status));
assert.deepEqual(statuses,[200,200]);
const rows=execFileSync('ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).split('\\n').filter(line=>line.includes(process.cwd()+'/primary/.output/server/index.mjs')||line.includes(process.cwd()+'/guest/.output/server/index.mjs'));
assert.equal(rows.length,2,rows.join('\\n'));
await writeFile('retry-result.json',JSON.stringify({earlyChildFailureRejected:true,sameProcessRetry:true,healthyAgents:statuses,workers:rows.map(row=>row.trim()),duplicateConfigLoads:3}));
process.exit(0);
`,
);

const results = {
  upstream: "e3cea42486e7e32b7b3001bb5912e076b5443ad5",
  maintainedFork: "5f129f3b0b4d9a094ead45ca1cd3c53548d1da3c",
  eve: packageInfo.version,
  next: "16.3.0",
  node: process.version,
  root,
  basePort,
  nextPort,
};
try {
  for (const name of agents)
    await command(
      [path.join(modules, "eve/bin/eve.js"), "build", "--skip-sandbox-prewarm"],
      path.join(root, name),
      `build-${name}`,
    );
  await command(
    [path.join(modules, "next/dist/bin/next"), "build", "--webpack"],
    root,
    "next-build",
  );
  assert.equal(workers().length, 0, "Build phase must not start production workers");
  const manifest = JSON.parse(
    await readFile(path.join(root, ".next/routes-manifest.json"), "utf8"),
  );
  const rules = manifest.rewrites.beforeFiles;
  for (const [index, name] of agents.entries())
    assert(
      rules.some(
        (rule) =>
          rule.source === `/eve/${name}/v1/:path+` &&
          rule.destination === `http://127.0.0.1:${basePort + index}/eve/v1/:path+`,
      ),
    );
  results.savedRewrites = rules;
  results.buildStartsNoWorkers = true;
  for (const negative of [true, false]) {
    const host = launch(
      [
        path.join(modules, "next/dist/bin/next"),
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(nextPort),
      ],
      root,
      negative ? "next-negative" : "next-positive",
      negative ? { EVE_PROOF_DISABLE_STARTUP: "1" } : {},
    );
    try {
      await until(async () => {
        if (host.child.exitCode !== null) throw new Error(host.output());
        return (await health(nextPort, "/")) === 200;
      }, "Next readiness");
      const statuses = await Promise.all(
        agents.map((name) => health(nextPort, `/eve/${name}/v1/health`)),
      );
      if (negative) {
        assert.deepEqual(statuses, [500, 500]);
        assert.equal(workers().length, 0);
        results.negativeControl = {
          configStartupSuppressed: true,
          proxyStatuses: statuses,
          workers: 0,
        };
      } else {
        assert.deepEqual(statuses, [200, 200]);
        assert.deepEqual(await Promise.all([health(basePort), health(basePort + 1)]), [200, 200]);
        const actual = workers();
        assert.equal(actual.length, 2, actual.join("\n"));
        const records = (await readFile(env.EVE_PROOF_LOG, "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        assert(
          records.some(
            (record) => record.kind === "rewrites" && record.phase === "phase-production-build",
          ),
        );
        assert(
          !records.some(
            (record) => record.kind === "rewrites" && record.phase === "phase-production-server",
          ),
        );
        results.production = {
          proxyStatuses: statuses,
          workers: actual,
          repeatedConcurrentConfigLoads: 3,
          rewritesNotCalledAtStartup: true,
        };
      }
    } finally {
      await stop(host);
    }
    await until(
      async () =>
        workers().length === 0 &&
        (await health(basePort)) === 0 &&
        (await health(basePort + 1)) === 0,
      "worker shutdown",
    );
  }
  await command([path.join(root, "retry.mjs")], root, "retry");
  results.retry = JSON.parse(await readFile(path.join(root, "retry-result.json"), "utf8"));
  await until(() => workers().length === 0, "retry worker shutdown");
  results.commands = commandResults;
  results.scope =
    "Two minimal authored agents and real local Next production host; not full ChatJS, hosted deployment, sandbox or multi-host process deduplication";
  await writeFile(path.join(proofRoot, "RESULTS.json"), JSON.stringify(results, null, 2) + "\n");
  console.log(`PASS: native Next startup; evidence ${root}`);
} finally {
  for (const child of running) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
  }
  await appendFile(path.join(root, "completed.txt"), new Date().toISOString() + "\n");
}
