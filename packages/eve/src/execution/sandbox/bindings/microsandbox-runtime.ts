import {
  updateMicrosandboxMaterialization,
  withMicrosandboxResourceOperation,
} from "#execution/sandbox/bindings/microsandbox-resource-metadata.js";
import { createHash, randomUUID } from "node:crypto";
import { access, stat } from "node:fs/promises";
import { posix } from "node:path";

import { shellQuote } from "#execution/sandbox/shell-quote.js";
import { createMicrosandboxWithProgress } from "#execution/sandbox/bindings/microsandbox-create.js";
import {
  applyMicrosandboxNetwork,
  createMicrosandboxNetworkPlan,
  createTransformBrokerEnvironment,
} from "#execution/sandbox/bindings/microsandbox-network.js";
import {
  MICROSANDBOX_USER,
  type ResolvedMicrosandboxOptions,
} from "#execution/sandbox/bindings/microsandbox-options.js";
import {
  createMicrosandboxSessionMetadata,
  MICROSANDBOX_METADATA_VERSION,
  type MicrosandboxSessionMetadata,
  type MicrosandboxResourceFact,
  readSessionMetadata,
} from "#execution/sandbox/bindings/microsandbox-metadata.js";
import {
  assertMicrosandboxPlatformCandidate,
  ensureMicrosandboxBaseRuntime,
} from "#execution/sandbox/bindings/microsandbox-platform.js";
import { adaptMicrosandboxExecToSandboxProcess } from "#execution/sandbox/bindings/microsandbox-process.js";
import {
  importInstalledEnginePackage,
  isEveDevEnvironment,
} from "#internal/application/optional-package-install.js";
import { readInstalledPackageVersion } from "#internal/application/optional-package-import.js";
import { withDevelopmentSandboxTags } from "#execution/sandbox/development-run.js";
import { SANDBOX_AGENT_ENV } from "#execution/sandbox/session.js";
import { WORKSPACE_ROOT } from "#runtime/workspace/types.js";
import type { SandboxNetworkPolicy } from "#shared/sandbox-network-policy.js";
import type { SandboxProviderHost } from "#shared/sandbox-provider.js";
import type {
  SandboxProcess,
  SandboxRemovePathOptions,
  SandboxSpawnOptions,
} from "#shared/sandbox-session.js";
import {
  isMicrosandboxNotFoundError,
  isMicrosandboxSnapshotSourceRunningError,
  isMicrosandboxStillRunningError,
  snapshotExists,
} from "#execution/sandbox/bindings/microsandbox-provider-state.js";
import type {
  Sandbox as MicrosandboxSandbox,
  Snapshot as MicrosandboxSnapshot,
} from "microsandbox";

export {
  isMicrosandboxNotFoundError,
  removeSnapshotIfExists,
  sandboxExists,
  snapshotExists,
} from "#execution/sandbox/bindings/microsandbox-provider-state.js";

export type MicrosandboxModule = typeof import("microsandbox");

const MICROSANDBOX_PACKAGE_NAME = "microsandbox";
const MICROSANDBOX_PACKAGE_VERSION = "0.6.18";
const MICROSANDBOX_INSTALL_SPECIFIER = `${MICROSANDBOX_PACKAGE_NAME}@${MICROSANDBOX_PACKAGE_VERSION}`;
const MICROSANDBOX_CONNECT_TIMEOUT_MS = 10_000;
const MICROSANDBOX_STOP_TIMEOUT_MS = 10_000;

const MICROSANDBOX_HOME = `/home/${MICROSANDBOX_USER}`;

export class MicrosandboxVm {
  readonly #input: {
    readonly module: MicrosandboxModule;
    readonly options: ResolvedMicrosandboxOptions;
    readonly sessionKey: string;
    readonly tags?: Readonly<Record<string, string>>;
  };
  #metadataPath?: string;
  #networkPolicy?: SandboxNetworkPolicy;
  #optionsHash?: string;
  #sandbox: MicrosandboxSandbox;
  #sandboxName: string;
  #stateSnapshotName?: string;

  constructor(
    input: {
      readonly module: MicrosandboxModule;
      readonly options: ResolvedMicrosandboxOptions;
      readonly sessionKey: string;
      readonly tags?: Readonly<Record<string, string>>;
    },
    sandbox: MicrosandboxSandbox,
    sandboxName: string,
    networkPolicy: SandboxNetworkPolicy | undefined,
    metadataPath?: string,
    optionsHash?: string,
    stateSnapshotName?: string,
  ) {
    this.#input = input;
    this.#sandbox = sandbox;
    this.#sandboxName = sandboxName;
    this.#networkPolicy = networkPolicy;
    this.#metadataPath = metadataPath;
    this.#optionsHash = optionsHash;
    this.#stateSnapshotName = stateSnapshotName;
  }

  get id(): string {
    return this.#input.sessionKey;
  }

  get name(): string {
    return this.#sandboxName;
  }

  async captureFork(
    checkpointKey: string,
  ): Promise<{ snapshotName: string; snapshotDigest: string }> {
    const snapshotName = createProviderName(
      "eve-sbx-fork",
      `${this.#input.sessionKey}:${checkpointKey}`,
    );
    await this.resourceOperation(
      "fork-snapshot",
      snapshotName,
      "allocate",
      async (previouslyLive) => {
        if (previouslyLive) {
          return await this.#input.module.Snapshot.get(snapshotName);
        }
        const snapshots = await this.#input.module.Snapshot.list();
        if (snapshots.some((snapshot) => snapshot.name === snapshotName)) {
          throw new Error("Microsandbox fork snapshot already exists without ownership.");
        }
        try {
          return await this.stopAndSnapshot(snapshotName);
        } finally {
          // Restart is fenced independently: retirement may have raced capture.
          this.#sandbox = await this.resourceOperation(
            "sandbox",
            this.#sandboxName,
            "allocate",
            async (_live, nativeId) => {
              if (nativeId === undefined)
                return await this.#input.module.Sandbox.start(this.#sandboxName);
              const handle = await this.#input.module.Sandbox.get(this.#sandboxName);
              if (handle.id !== nativeId) throw new Error("Microsandbox VM was replaced.");
              return await handle.startDetached();
            },
          );
        }
      },
    );
    const metadata =
      this.#metadataPath === undefined ? null : await readSessionMetadata(this.#metadataPath);
    const snapshotDigest = metadata?.resources?.entries.find(
      (entry) =>
        entry.kind === "fork-snapshot" && entry.name === snapshotName && entry.phase === "live",
    )?.nativeId;
    if (snapshotDigest === undefined)
      throw new Error("Microsandbox fork identity receipt is unavailable.");
    return { snapshotName, snapshotDigest };
  }

  async captureState(optionsHash: string): Promise<MicrosandboxSessionMetadata> {
    this.#optionsHash = optionsHash;
    if (isEveDevEnvironment()) {
      if (this.#metadataPath !== undefined) {
        await this.writeMetadata(this.#metadataPath, optionsHash);
      }
      return createMicrosandboxSessionMetadata({
        networkPolicy: this.#networkPolicy,
        optionsHash,
        sandboxName: this.#sandboxName,
        stateSnapshotName: this.#stateSnapshotName,
      });
    }

    const previousStateSnapshotName = this.#stateSnapshotName;
    const stateSnapshotName = createProviderName(
      "eve-sbx-state",
      `${this.#input.sessionKey}:${randomUUID()}`,
    );

    await this.resourceOperation("state-snapshot", stateSnapshotName, "allocate", () =>
      this.stopAndSnapshot(stateSnapshotName),
    );
    this.#stateSnapshotName = stateSnapshotName;
    if (this.#metadataPath !== undefined) {
      await this.writeMetadata(this.#metadataPath, optionsHash);
    }
    if (previousStateSnapshotName !== undefined) {
      await this.removeResource("state-snapshot", previousStateSnapshotName);
    }
    return createMicrosandboxSessionMetadata({
      networkPolicy: this.#networkPolicy,
      optionsHash,
      sandboxName: this.#sandboxName,
      stateSnapshotName,
    });
  }

  async detach(): Promise<void> {
    await this.#sandbox.detach().catch(() => {});
  }

  /**
   * Stops the VM and releases the SDK client for server shutdown. The
   * stopped sandbox persists on disk, so a later `connect` restarts it
   * (dev) or restores from the last captured snapshot (production).
   */
  async shutdown(): Promise<void> {
    await this.#sandbox.stop().catch(() => {});
    await this.detach();
  }

  async stop(): Promise<void> {
    await this.#sandbox.stop();
    // SDK stop requests shutdown; the persisted handle waits for it. Reconnecting
    // before that wait can attach to the old process just as it exits.
    await (
      await this.#input.module.Sandbox.get(this.#sandboxName)
    ).stopWithTimeout(MICROSANDBOX_STOP_TIMEOUT_MS);
    await this.detach();
  }

  async readFileBytes(path: string): Promise<Buffer | null> {
    try {
      const fs = this.#sandbox.fs();
      if (!(await fs.exists(path))) {
        return null;
      }
      return Buffer.from(await fs.read(path));
    } catch {
      return null;
    }
  }

  async removePath(options: SandboxRemovePathOptions): Promise<void> {
    const flags = `${options.force === true ? "f" : ""}${options.recursive === true ? "r" : ""}`;
    const command = `${flags.length > 0 ? `rm -${flags}` : "rm"} -- ${shellQuote(options.path)}`;
    await this.runInternalCommand({
      abortSignal: options.abortSignal,
      command,
      user: MICROSANDBOX_USER,
    });
  }

  async removePersisted(): Promise<void> {
    await this.removeResource("sandbox", this.#sandboxName);
    const stateSnapshotName = this.#stateSnapshotName;
    if (stateSnapshotName === undefined) {
      return;
    }
    await this.removeResource("state-snapshot", stateSnapshotName);
    this.#stateSnapshotName = undefined;
  }

  async setNetworkPolicy(policy: SandboxNetworkPolicy): Promise<void> {
    const previousStateSnapshotName = this.#stateSnapshotName;
    const stateSnapshotName = createProviderName(
      "eve-sbx-state",
      `${this.#input.sessionKey}:${randomUUID()}`,
    );
    const previousSandboxName = this.#sandboxName;

    await this.resourceOperation("state-snapshot", stateSnapshotName, "allocate", () =>
      this.stopAndSnapshot(stateSnapshotName),
    );
    await this.removeResource("sandbox", previousSandboxName);

    const nextSandboxName = createProviderName(
      "eve-sbx-ses",
      `${this.#input.sessionKey}:${randomUUID()}`,
    );
    this.#sandbox = await createMicrosandbox({
      fromSnapshot: stateSnapshotName,
      metadataPath: this.#metadataPath,
      sessionKey: this.#input.sessionKey,
      module: this.#input.module,
      name: nextSandboxName,
      networkPolicy: policy,
      options: this.#input.options,
      tags: this.#input.tags,
      user: MICROSANDBOX_USER,
      workdir: WORKSPACE_ROOT,
    });
    this.#sandboxName = nextSandboxName;
    this.#networkPolicy = policy;
    this.#stateSnapshotName = undefined;
    if (this.#metadataPath !== undefined && this.#optionsHash !== undefined) {
      await this.writeMetadata(this.#metadataPath, this.#optionsHash);
    }
    await this.removeResource("state-snapshot", stateSnapshotName);
    if (previousStateSnapshotName !== undefined) {
      await this.removeResource("state-snapshot", previousStateSnapshotName);
    }
  }

  async spawn(options: SandboxSpawnOptions): Promise<SandboxProcess> {
    if (options.abortSignal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }

    const env = {
      ...SANDBOX_AGENT_ENV,
      ...this.#input.options.env,
      HOME: MICROSANDBOX_HOME,
      ...createTransformBrokerEnvironment(createMicrosandboxNetworkPlan(this.#networkPolicy)),
      ...options.env,
    };

    const handle = await this.#sandbox.execStreamWith("bash", (builder) =>
      builder
        .args(["-lc", options.command])
        .cwd(options.workingDirectory ?? WORKSPACE_ROOT)
        .envs(env)
        .user(MICROSANDBOX_USER),
    );

    if (options.abortSignal !== undefined) {
      const kill = () => {
        void handle.kill().catch(() => {});
      };
      options.abortSignal.addEventListener("abort", kill, { once: true });
    }

    return adaptMicrosandboxExecToSandboxProcess(handle);
  }

  async stopAndSnapshot(snapshotName: string): Promise<MicrosandboxSnapshot> {
    await this.#sandbox.stop().catch(() => {});
    return await stopAndSnapshotMicrosandboxSandbox(
      this.#input.module,
      this.#sandboxName,
      snapshotName,
      this.#sandbox.id,
    );
  }

  async writeFiles(
    files: ReadonlyArray<{ path: string; content: string | Uint8Array }>,
  ): Promise<void> {
    const fs = this.#sandbox.fs();
    for (const file of files) {
      const dir = posix.dirname(file.path);
      // Create parents as the sandbox user so every intermediate
      // directory is user-owned — a root-owned intermediate would make
      // the tree undeletable for `removePath`, which runs as the user.
      await this.runInternalCommand({
        command: `mkdir -p ${shellQuote(dir)}`,
        user: MICROSANDBOX_USER,
      });
      await fs.write(file.path, file.content);
      await this.runInternalCommand({
        command: `chown ${MICROSANDBOX_USER}:${MICROSANDBOX_USER} ${shellQuote(file.path)}`,
        user: "root",
      });
    }
  }

  async writeMetadata(path: string, optionsHash: string): Promise<void> {
    this.#metadataPath = path;
    this.#optionsHash = optionsHash;
    await updateMicrosandboxMaterialization(path, this.#input.sessionKey, {
      image: this.#input.options.image,
      networkPolicy: this.#networkPolicy,
      optionsHash,
      sandboxName: this.#sandboxName,
      stateSnapshotName: this.#stateSnapshotName,
      version: MICROSANDBOX_METADATA_VERSION,
    });
  }

  private async resourceOperation<T>(
    kind: MicrosandboxResourceFact["kind"],
    name: string,
    operation: "allocate" | "remove",
    run: (previouslyLive: boolean, nativeId?: string) => Promise<T>,
  ): Promise<T> {
    if (this.#metadataPath === undefined) return await run(false);
    return await withMicrosandboxResourceOperation({
      path: this.#metadataPath,
      sessionId: this.#input.sessionKey,
      resource: { kind, name },
      operation,
      run,
      identify: async (result) => {
        if (typeof result !== "object" || result === null)
          throw new Error("Microsandbox allocation returned no identity receipt.");
        if (kind === "sandbox" && "id" in result && typeof result.id === "string")
          return { nativeId: result.id };
        if (
          kind !== "sandbox" &&
          "digest" in result &&
          typeof result.digest === "string" &&
          "path" in result &&
          typeof result.path === "string"
        )
          return { nativeId: result.digest, nativePath: result.path };
        throw new Error("Microsandbox allocation returned an invalid identity receipt.");
      },
    });
  }

  private async removeResource(
    kind: MicrosandboxResourceFact["kind"],
    name: string,
  ): Promise<void> {
    await this.resourceOperation(kind, name, "remove", async (_live, nativeId) => {
      const resources =
        this.#metadataPath === undefined || nativeId === undefined
          ? undefined
          : (await readSessionMetadata(this.#metadataPath))?.resources;
      const nativePath = resources?.entries.find(
        (entry) => entry.kind === kind && entry.name === name,
      )?.nativePath;
      await removeMicrosandboxResource(this.#input.module, { kind, name, nativeId, nativePath });
    });
  }

  private async runInternalCommand(input: {
    readonly abortSignal?: AbortSignal;
    readonly command: string;
    readonly failureMessage?: string;
    readonly user: string;
  }): Promise<void> {
    if (input.abortSignal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    const output = await this.#sandbox.execWith("bash", (builder) =>
      builder.args(["-lc", input.command]).cwd(WORKSPACE_ROOT).user(input.user),
    );
    if (output.code !== 0) {
      const message = input.failureMessage ?? "Microsandbox command failed.";
      throw new Error(`${message} ${output.stderr()}`.trim());
    }
  }
}

export async function createPreparedMicrosandbox(input: {
  readonly metadataPath?: string;
  readonly fromSnapshot?: string;
  readonly log?: (message: string) => void;
  readonly module: MicrosandboxModule;
  readonly name: string;
  readonly networkPolicy?: SandboxNetworkPolicy;
  readonly options: ResolvedMicrosandboxOptions;
  readonly resourcesPath?: string;
  readonly sessionKey: string;
  readonly setupBaseRuntime: boolean;
  readonly tags?: Readonly<Record<string, string>>;
}): Promise<MicrosandboxVm> {
  const initialNetworkPolicy = input.setupBaseRuntime ? "allow-all" : input.networkPolicy;
  const sandbox = await createMicrosandbox({
    fromSnapshot: input.fromSnapshot,
    metadataPath: input.metadataPath,
    sessionKey: input.sessionKey,
    log: input.log,
    module: input.module,
    name: input.name,
    networkPolicy: initialNetworkPolicy,
    options: input.options,
    resourcesPath: input.resourcesPath,
    tags: input.tags,
    user: input.setupBaseRuntime ? undefined : MICROSANDBOX_USER,
    workdir: input.setupBaseRuntime ? "/" : WORKSPACE_ROOT,
  });

  const vm = new MicrosandboxVm(
    {
      module: input.module,
      options: input.options,
      sessionKey: input.sessionKey,
      tags: input.tags,
    },
    sandbox,
    input.name,
    initialNetworkPolicy,
    input.metadataPath,
  );

  if (input.setupBaseRuntime) {
    await withProgressHeartbeat("preparing base runtime inside VM", input.log, async () => {
      await ensureMicrosandboxBaseRuntime(sandbox, { log: input.log });
    });
    if (input.networkPolicy !== undefined && input.networkPolicy !== "allow-all") {
      input.log?.("applying network policy");
      await vm.setNetworkPolicy(input.networkPolicy);
    }
  }

  return vm;
}

export async function connectMicrosandbox(input: {
  readonly metadata: MicrosandboxSessionMetadata;
  readonly metadataPath: string;
  readonly module: MicrosandboxModule;
  readonly options: ResolvedMicrosandboxOptions;
  readonly sessionKey: string;
  readonly tags?: Readonly<Record<string, string>>;
}): Promise<MicrosandboxVm | null> {
  let handle;
  try {
    handle = await input.module.Sandbox.get(input.metadata.sandboxName);
  } catch (error) {
    if (!isMicrosandboxNotFoundError(error)) {
      throw error;
    }
    if (input.metadata.stateSnapshotName === undefined) {
      return null;
    }
    return await restoreMicrosandboxSessionSnapshot(input);
  }

  if (
    handle.status !== "running" &&
    handle.status !== "draining" &&
    input.metadata.stateSnapshotName !== undefined
  ) {
    return await restoreMicrosandboxSessionSnapshot(input);
  }

  const sandbox = await withMicrosandboxResourceOperation<MicrosandboxSandbox>({
    path: input.metadataPath,
    sessionId: input.sessionKey,
    resource: { kind: "sandbox", name: input.metadata.sandboxName },
    operation: "allocate",
    identify: async (sandbox) => ({ nativeId: sandbox.id }),
    run: async (previouslyLive, nativeId) => {
      if (handle.id !== nativeId) throw new Error("Microsandbox VM was replaced.");
      if (!previouslyLive) throw new Error("Microsandbox resume ownership is unavailable.");
      return handle.status === "running" || handle.status === "draining"
        ? await handle.connectWithTimeout(MICROSANDBOX_CONNECT_TIMEOUT_MS)
        : await handle.startDetached();
    },
  });

  return new MicrosandboxVm(
    {
      module: input.module,
      options: input.options,
      sessionKey: input.sessionKey,
      tags: input.tags,
    },
    sandbox,
    input.metadata.sandboxName,
    input.metadata.networkPolicy,
    input.metadataPath,
    input.metadata.optionsHash,
    input.metadata.stateSnapshotName,
  );
}

async function restoreMicrosandboxSessionSnapshot(input: {
  readonly metadata: MicrosandboxSessionMetadata;
  readonly metadataPath: string;
  readonly module: MicrosandboxModule;
  readonly options: ResolvedMicrosandboxOptions;
  readonly sessionKey: string;
  readonly tags?: Readonly<Record<string, string>>;
}): Promise<MicrosandboxVm | null> {
  if (
    input.metadata.stateSnapshotName === undefined ||
    !(await snapshotExists(input.module, input.metadata.stateSnapshotName))
  ) {
    return null;
  }

  const stateReceipt = input.metadata.resources?.entries.find(
    (entry) =>
      entry.kind === "state-snapshot" &&
      entry.name === input.metadata.stateSnapshotName &&
      entry.phase === "live",
  );
  if (stateReceipt?.nativeId === undefined || stateReceipt.nativePath === undefined)
    throw new Error("Microsandbox state snapshot ownership is unavailable.");
  if ((await input.module.Snapshot.open(stateReceipt.nativePath)).digest !== stateReceipt.nativeId)
    throw new Error("Microsandbox state snapshot was replaced.");
  const sandboxName = createProviderName("eve-sbx-ses", `${input.sessionKey}:${randomUUID()}`);
  const sandbox = await createMicrosandbox({
    fromSnapshot: stateReceipt.nativePath,
    metadataPath: input.metadataPath,
    sessionKey: input.sessionKey,
    module: input.module,
    name: sandboxName,
    networkPolicy: input.metadata.networkPolicy,
    options: input.options,
    tags: input.tags,
    user: MICROSANDBOX_USER,
    workdir: WORKSPACE_ROOT,
  });
  await withMicrosandboxResourceOperation({
    path: input.metadataPath,
    sessionId: input.sessionKey,
    resource: { kind: "sandbox", name: input.metadata.sandboxName },
    operation: "remove",
    run: (_live, nativeId) =>
      removeMicrosandboxResource(input.module, {
        kind: "sandbox",
        name: input.metadata.sandboxName,
        nativeId,
      }),
  });

  const vm = new MicrosandboxVm(
    {
      module: input.module,
      options: input.options,
      sessionKey: input.sessionKey,
      tags: input.tags,
    },
    sandbox,
    sandboxName,
    input.metadata.networkPolicy,
    input.metadataPath,
    input.metadata.optionsHash,
    input.metadata.stateSnapshotName,
  );
  await vm.writeMetadata(input.metadataPath, input.metadata.optionsHash);
  return vm;
}

const MICROSANDBOX_MISSING_PACKAGE_MESSAGE =
  "The microsandbox sandbox provider requires the `microsandbox` package, which is not bundled " +
  `with eve. Install it in your application (for example \`pnpm add -D ${MICROSANDBOX_INSTALL_SPECIFIER}\`), or use ` +
  "DockerSandbox or VercelSandbox instead.";

/**
 * Loads the microsandbox npm package and ensures its VM runtime is
 * installed. During `eve dev`, both are installed automatically when
 * missing (unless `setup.autoInstall: false`): the package with the
 * project's package manager, the runtime via microsandbox's installer.
 * Production processes never install — they fail with actionable
 * errors instead.
 */
export async function loadMicrosandboxModule(input: {
  readonly host: SandboxProviderHost;
  readonly log?: (message: string) => void;
  readonly options: ResolvedMicrosandboxOptions;
}): Promise<MicrosandboxModule> {
  input.log?.("checking microsandbox platform support");
  await assertMicrosandboxPlatformCandidate();

  const module = await withProgressHeartbeat("loading microsandbox npm package", input.log, () =>
    input.host.loadOptionalPackage<MicrosandboxModule>({
      autoInstall: input.options.setup.autoInstall,
      importModule: async () => await import("microsandbox"),
      installPackageName: MICROSANDBOX_INSTALL_SPECIFIER,
      missingMessage: MICROSANDBOX_MISSING_PACKAGE_MESSAGE,
      packageName: MICROSANDBOX_PACKAGE_NAME,
    }),
  );

  await assertSupportedMicrosandboxApi(module, input.host);

  input.log?.("checking microsandbox VM runtime");
  if (!module.isInstalled()) {
    if (!input.options.setup.autoInstall || !isEveDevEnvironment()) {
      throw new Error(
        "The microsandbox VM runtime is not installed. Run `npx microsandbox install`, set " +
          "MSB_PATH for a custom install, or let `eve dev` install it automatically with " +
          "microsandbox({ setup: { autoInstall: true } }).",
      );
    }

    await withProgressHeartbeat("installing microsandbox VM runtime", input.log, async () => {
      await module.setup().skipVerify(input.options.setup.skipVerify).install();
    });
  }

  input.log?.("microsandbox runtime ready");
  return module;
}

/**
 * microsandbox 0.7 renamed `isInstalled` and removed `setup`. Projects that
 * already depend on it would otherwise fail every sandbox operation with a
 * bare `TypeError`.
 */
async function assertSupportedMicrosandboxApi(
  module: MicrosandboxModule,
  host: SandboxProviderHost,
): Promise<void> {
  const loaded = module as Partial<Pick<MicrosandboxModule, "isInstalled" | "setup">>;
  if (typeof loaded.isInstalled === "function" && typeof loaded.setup === "function") {
    return;
  }

  const version = await readInstalledPackageVersion({
    appRoot: host.resolveProjectPath("."),
    packageName: MICROSANDBOX_PACKAGE_NAME,
  }).catch(() => undefined);
  const installed =
    version === undefined ? "The installed `microsandbox`" : `\`microsandbox@${version}\``;
  throw new Error(
    `${installed} is not supported by eve. Install the supported version with ` +
      `\`pnpm add -D ${MICROSANDBOX_INSTALL_SPECIFIER}\`, or use DockerSandbox or VercelSandbox instead.`,
  );
}

async function withProgressHeartbeat<T>(
  message: string,
  log: ((message: string) => void) | undefined,
  callback: () => Promise<T>,
): Promise<T> {
  log?.(message);
  if (log === undefined) {
    return await callback();
  }

  const startedAt = Date.now();
  const timer = setInterval(() => {
    const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
    log(`${message} (${elapsedSeconds}s elapsed)`);
  }, 10_000);
  timer.unref?.();

  try {
    return await callback();
  } finally {
    clearInterval(timer);
  }
}

/**
 * Loads microsandbox only when its package and runtime are already
 * present — used by cleanup paths that must never trigger installs.
 */
export async function loadMicrosandboxWithoutInstall(
  appRoot: string,
): Promise<MicrosandboxModule | null> {
  try {
    const module = await importInstalledEnginePackage<MicrosandboxModule>({
      appRoot,
      packageName: MICROSANDBOX_PACKAGE_NAME,
    });
    return module.isInstalled() ? module : null;
  } catch {
    return null;
  }
}

export async function stopAndSnapshotMicrosandboxSandbox(
  module: MicrosandboxModule,
  sandboxName: string,
  snapshotName: string,
  expectedId?: string,
): Promise<MicrosandboxSnapshot> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const handle = await module.Sandbox.get(sandboxName);
    if (expectedId !== undefined && handle.id !== expectedId)
      throw new Error("Microsandbox VM was replaced.");
    await handle.stopWithTimeout(attempt === 0 ? MICROSANDBOX_STOP_TIMEOUT_MS : 0).catch(() => {});
    try {
      return await handle.snapshot(snapshotName);
    } catch (error) {
      if (!isMicrosandboxSnapshotSourceRunningError(error) || attempt === 2) {
        throw error;
      }
      await handle.kill().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error("Microsandbox snapshot capture did not complete.");
}

export function createProviderName(prefix: string, key: string, extra = ""): string {
  const hash = createStableHash(`${key}:${extra}`).slice(0, 32);
  return `${prefix}-${hash}`;
}

export function createStableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function doesPathExist(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function createMicrosandbox(input: {
  readonly metadataPath?: string;
  readonly sessionKey?: string;
  readonly fromSnapshot?: string;
  readonly log?: (message: string) => void;
  readonly module: MicrosandboxModule;
  readonly name: string;
  readonly networkPolicy?: SandboxNetworkPolicy;
  readonly options: ResolvedMicrosandboxOptions;
  readonly resourcesPath?: string;
  readonly tags?: Readonly<Record<string, string>>;
  readonly user?: string;
  readonly workdir: string;
}): Promise<MicrosandboxSandbox> {
  let builder = input.module.Sandbox.builder(input.name)
    .cpus(input.options.cpus)
    .detached(true)
    .envs({ ...input.options.env, HOME: MICROSANDBOX_HOME })
    .labels(resolveMicrosandboxLabels(input.tags))
    .memory(input.options.memoryMiB)
    .pullPolicy(input.options.pullPolicy)
    .workdir(input.workdir);

  if (input.fromSnapshot !== undefined) {
    builder = builder.fromSnapshot(input.fromSnapshot);
  } else {
    builder = builder.image(input.options.image);
  }

  if (input.options.image.startsWith("127.0.0.1:")) {
    builder = builder.registry((registry) => registry.insecure());
  }
  if (input.resourcesPath !== undefined) {
    builder = builder.volume("/eve/resources", (mount) =>
      mount.bind(input.resourcesPath).readonly(),
    );
  }

  if (input.user !== undefined) {
    builder = builder.user(input.user);
  }

  const source =
    input.fromSnapshot === undefined
      ? `image "${input.options.image}"`
      : `snapshot "${input.fromSnapshot}"`;
  if (input.metadataPath === undefined) builder = builder.replace();
  const create = () =>
    createMicrosandboxWithProgress({
      builder: applyMicrosandboxNetwork(builder, input.networkPolicy),
      errorType: input.module.MicrosandboxError,
      log: input.log,
      source,
    });
  if (input.metadataPath === undefined) return await create();
  if (input.sessionKey === undefined) throw new Error("Microsandbox session owner is required.");
  return await withMicrosandboxResourceOperation({
    path: input.metadataPath,
    sessionId: input.sessionKey,
    resource: { kind: "sandbox", name: input.name },
    operation: "allocate",
    identify: async (sandbox) => ({ nativeId: sandbox.id }),
    run: async (previouslyLive) => {
      if (previouslyLive) throw new Error("Microsandbox resource must be resumed, not replaced.");
      return await create();
    },
  });
}

async function removeSandboxIfExists(
  module: MicrosandboxModule,
  sandboxName: string,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const handle = await module.Sandbox.get(sandboxName);
      await handle
        .stopWithTimeout(attempt === 0 ? MICROSANDBOX_STOP_TIMEOUT_MS : 0)
        .catch(() => {});
      await handle.remove();
      return;
    } catch (error) {
      if (isMicrosandboxNotFoundError(error)) {
        return;
      }

      if (isMicrosandboxStillRunningError(error) && attempt < 2) {
        const handle = await module.Sandbox.get(sandboxName).catch(() => null);
        await handle?.kill().catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }

      throw error;
    }
  }
}

function resolveMicrosandboxLabels(
  tags: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  return {
    "eve.provider": "microsandbox",
    ...withDevelopmentSandboxTags(tags),
  };
}

/** Confirms exact absence after removal; an SDK error message is not an absence proof. */
export async function removeMicrosandboxResource(
  module: MicrosandboxModule,
  resource: Pick<MicrosandboxResourceFact, "kind" | "name" | "nativeId" | "nativePath">,
): Promise<void> {
  if (resource.kind !== "sandbox") {
    if (resource.nativeId !== undefined) {
      const path = resource.nativePath;
      if (path === undefined) throw new Error("Microsandbox snapshot path receipt is unavailable.");
      const exists = await stat(path).then(
        () => true,
        (error) => {
          if (error?.code === "ENOENT") return false;
          throw error;
        },
      );
      if (!exists) return;
      const current = await module.Snapshot.open(path);
      if (current.digest !== resource.nativeId)
        throw new Error("Microsandbox snapshot was replaced.");
      // A digest targets the receipt's artifact, and native child protection stays enabled.
      await module.Snapshot.remove(resource.nativeId);
      const remains = await stat(path).then(
        () => true,
        (error) => {
          if (error?.code === "ENOENT") return false;
          throw error;
        },
      );
      if (remains) throw new Error("Microsandbox snapshot removal is unconfirmed.");
    } else {
      // Shared template cleanup has no session ownership record.
      await module.Snapshot.remove(resource.name);
      if ((await module.Snapshot.list()).some((snapshot) => snapshot.name === resource.name))
        throw new Error("Microsandbox snapshot removal is unconfirmed.");
    }
    return;
  }
  if (resource.nativeId === undefined) {
    await removeSandboxIfExists(module, resource.name);
  } else {
    let handle;
    try {
      handle = await module.Sandbox.get(resource.name);
    } catch (error) {
      if (!isMicrosandboxNotFoundError(error)) throw error;
    }
    if (handle !== undefined) {
      if (handle.id !== resource.nativeId || handle.backendKind !== "local")
        throw new Error("Microsandbox VM was replaced or changed backend.");
      await handle.stopWithTimeout(MICROSANDBOX_STOP_TIMEOUT_MS);
      await handle.remove();
    }
  }
  let cursor: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const result = await module.Sandbox.listWith((builder) =>
      cursor === undefined ? builder.limit(100) : builder.limit(100).cursor(cursor),
    );
    if (result.sandboxes.some((sandbox) => sandbox.name === resource.name))
      throw new Error("Microsandbox removal is unconfirmed.");
    cursor = result.nextCursor;
    if (cursor === undefined) return;
  }
  throw new Error("Microsandbox removal verification exceeded its inventory limit.");
}
