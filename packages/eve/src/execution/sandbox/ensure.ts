import { assertLocalSessionSandboxIdentity } from "#execution/sandbox/local-session-identity.js";
import type { HarnessSession } from "#harness/types.js";
import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SandboxSession } from "#public/definitions/sandbox.js";
import type {
  SandboxBackend,
  SandboxBackendCreateInput,
  SandboxBackendHandle,
  SandboxBackendTags,
} from "#public/definitions/sandbox-backend.js";
import { SandboxTemplateNotProvisionedError } from "#public/definitions/sandbox-backend.js";
import { isEveDevEnvironment } from "#internal/application/optional-package-install.js";
import {
  getRuntimeCompiledArtifactsSandboxAppRoot,
  type RuntimeCompiledArtifactsSource,
} from "#runtime/compiled-artifacts-source.js";
import { trackActiveSandboxHandle } from "#execution/sandbox/active-handles.js";
import { waitForDevelopmentSandboxPrewarm } from "#execution/sandbox/development-prewarm.js";
import { prewarmAppSandboxes } from "#execution/sandbox/prewarm.js";
import { waitForSandboxTemplatePrewarmLock } from "#execution/sandbox/template-prewarm-lock.js";
import { buildCallbackContext } from "#context/build-callback-context.js";
import { createRuntimeSandboxKeys } from "#runtime/sandbox/keys.js";
import type { RuntimeSandboxRegistry } from "#runtime/sandbox/registry.js";
import { createRuntimeSandboxTemplatePlan } from "#runtime/sandbox/template-plan.js";
import type { SandboxAccess, SandboxSessionState, SandboxState } from "#sandbox/state.js";

/**
 * Input for creating or reattaching the live sandbox for one step execution.
 */
export interface EnsureSandboxAccessInput {
  readonly compiledArtifactsSource: RuntimeCompiledArtifactsSource;
  readonly nodeId: string;
  /** Whether this durable session owns the sandbox lifecycle. */
  readonly ownsSandbox?: boolean;
  readonly localSandboxIdentity?: HarnessSession["localSandboxIdentity"];
  readonly registry: RuntimeSandboxRegistry;
  readonly sessionId: string;
  readonly runOnSession?: (callback: () => Promise<void>) => Promise<void>;
  readonly state: SandboxState | null;
  readonly tags?: SandboxBackendTags;
}

/**
 * Creates or reattaches the live sandbox from the compiled agent bundle's
 * registry and persisted session state, returning a {@link SandboxAccess}
 * suitable for the runtime context.
 *
 * Every agent has exactly one sandbox. The sandbox carries its own
 * `SandboxBackend` value (resolved from the authored module or
 * substituted with `defaultSandbox()` when omitted), and the runtime
 * simply calls `backend.create(...)`.
 */
export async function ensureSandboxAccess(input: EnsureSandboxAccessInput): Promise<SandboxAccess> {
  let initialized = input.state?.initialized ?? false;
  let persistedSession: SandboxSessionState | null = input.state?.session ?? null;
  const appRoot =
    getRuntimeCompiledArtifactsSandboxAppRoot(input.compiledArtifactsSource) ?? process.cwd();

  const registered = input.registry.sandbox;
  let handlePromise: Promise<SandboxBackendHandle | null> | undefined;

  function getHandle(): Promise<SandboxBackendHandle | null> {
    if (handlePromise !== undefined) {
      return handlePromise;
    }
    handlePromise = createHandle().catch((error) => {
      handlePromise = undefined;
      throw error;
    });
    return handlePromise;
  }

  async function createHandle(): Promise<SandboxBackendHandle | null> {
    if (registered === null) {
      return null;
    }
    const inheritance = registered.inheritance;
    const definition = inheritance?.definition ?? registered.definition;
    const backend = definition.backend;
    await assertLocalSessionSandboxIdentity(input.localSandboxIdentity, {
      appRoot,
      backendName: backend.name,
    });
    const templatePlan = createRuntimeSandboxTemplatePlan({
      definition,
      workspaceResourceRoot: inheritance?.workspaceResourceRoot ?? registered.workspaceResourceRoot,
    });

    const keys = await createRuntimeSandboxKeys({
      backendName: backend.name,
      compiledArtifactsSource: input.compiledArtifactsSource,
      nodeId: inheritance?.nodeId ?? input.nodeId,
      sessionId: input.sessionId,
      sourceId: definition.sourceId,
      templatePlan,
    });

    if (keys.templateKey !== null) {
      await waitForDevelopmentSandboxPrewarm({
        appRoot,
        compiledArtifactsSource: input.compiledArtifactsSource,
        log: (message) =>
          logDevelopmentSandbox(
            `eve: sandbox template "${formatNodeLabel(input.nodeId)}" (${backend.name}): ${message}`,
          ),
      });
      await waitForSandboxTemplatePrewarmLock({
        appRoot,
        backendName: backend.name,
        log: (message) =>
          logDevelopmentSandbox(
            `eve: sandbox template "${formatNodeLabel(input.nodeId)}" (${backend.name}): ${message}`,
          ),
        templateKey: keys.templateKey,
      });
    }

    // The session eve may reattach to: the persisted record is only
    // meaningful when it names the sandbox this step derived. A rotated
    // session key (the sandbox definition changed) means the backend
    // provisions a fresh sandbox, so per-session initialization must run
    // again even though the durable state says it already did.
    const reattachSession =
      persistedSession !== null &&
      persistedSession.backendName === backend.name &&
      persistedSession.sessionKey === keys.sessionKey
        ? persistedSession
        : null;
    const forkCheckpoint = reattachSession === null ? input.state?.forkCheckpoint : undefined;
    if (reattachSession === null) {
      // A fork inherits the already-initialized filesystem, not source process
      // state. Running the initializer again would overwrite checkpoint files.
      initialized = forkCheckpoint !== undefined;
    }
    if (forkCheckpoint && forkCheckpoint.backendName !== backend.name) {
      throw new Error("Sandbox fork checkpoint belongs to a different backend.");
    }
    const createInput: SandboxBackendCreateInput = {
      existingMetadata: reattachSession?.metadata,
      forkCheckpoint: forkCheckpoint?.metadata,
      runtimeContext: { appRoot },
      sessionKey: keys.sessionKey,
      tags: input.tags,
      templateKey: keys.templateKey,
    };

    if (backend.name === "microsandbox") {
      await recordLocalSandboxOwner(appRoot, keys.sessionKey, input.sessionId);
    }

    const handle = await withDevelopmentSandboxProgress(
      `eve: opening sandbox session "${formatNodeLabel(input.nodeId)}" on backend "${backend.name}"...`,
      `eve: opening sandbox session "${formatNodeLabel(input.nodeId)}" on backend "${backend.name}"`,
      async () =>
        await createBackendHandleWithPrewarmRetry({
          appRoot,
          backend,
          compiledArtifactsSource: input.compiledArtifactsSource,
          createInput,
        }),
    );
    trackActiveSandboxHandle({
      backendName: backend.name,
      handle,
      sessionKey: keys.sessionKey,
    });

    if (!initialized) {
      await runOnSession(async () => {
        await definition.onSession?.({
          ctx: { session: buildCallbackContext().session },
          use: handle.useSessionFn,
        });
      });
      initialized = true;
    }

    return handle;
  }

  async function runOnSession(callback: () => Promise<void>): Promise<void> {
    if (input.runOnSession !== undefined) {
      await input.runOnSession(callback);
      return;
    }
    await callback();
  }

  return {
    async captureForkCheckpoint(checkpointKey) {
      if (input.ownsSandbox === false) return undefined;
      const handle = await getHandle();
      if (!handle?.captureForkCheckpoint || !registered) return undefined;
      const metadata = await handle.captureForkCheckpoint(checkpointKey);
      return metadata === undefined
        ? undefined
        : { backendName: registered.definition.backend.name, metadata };
    },
    async captureState() {
      if (handlePromise !== undefined) {
        const handle = await handlePromise;
        if (handle !== null) {
          persistedSession = await handle.captureState();
        }
      }

      return {
        initialized,
        session: persistedSession,
        ...(persistedSession === null && input.state?.forkCheckpoint
          ? { forkCheckpoint: input.state.forkCheckpoint }
          : {}),
      };
    },
    async delete(options) {
      if (input.ownsSandbox === false) {
        throw new Error(
          "Only the owning session can delete a shared sandbox. Delete it from the parent session instead.",
        );
      }
      const handle = await getHandle();
      if (handle === null) {
        throw new Error("The sandbox is not available in the current authored runtime context.");
      }
      await handle.delete(options);
      handlePromise = undefined;
      initialized = false;
      persistedSession = null;
    },
    async get(): Promise<SandboxSession | null> {
      const handle = await getHandle();
      if (handle === null) return null;
      return handle.session;
    },
    async stop(): Promise<void> {
      const handle = await getHandle();
      if (handle === null) {
        throw new Error("The sandbox is not available in the current authored runtime context.");
      }
      await handle.stop();
    },
  };
}

async function createBackendHandleWithPrewarmRetry(input: {
  readonly appRoot: string;
  readonly backend: SandboxBackend;
  readonly compiledArtifactsSource: RuntimeCompiledArtifactsSource;
  readonly createInput: SandboxBackendCreateInput;
}): Promise<SandboxBackendHandle> {
  try {
    return await input.backend.create(input.createInput);
  } catch (error) {
    if (
      input.createInput.templateKey === null ||
      input.compiledArtifactsSource.kind !== "disk" ||
      !SandboxTemplateNotProvisionedError.is(error)
    ) {
      throw error;
    }

    await prewarmAppSandboxes({
      appRoot: input.appRoot,
      compiledArtifactsSource: input.compiledArtifactsSource,
      log: (message) => logDevelopmentSandbox(message),
    });
    await waitForSandboxTemplatePrewarmLock({
      appRoot: input.appRoot,
      backendName: input.backend.name,
      log: (message) => logDevelopmentSandbox(`eve: ${message}`),
      templateKey: input.createInput.templateKey,
    });
    logDevelopmentSandbox("eve: sandbox template is ready; retrying sandbox creation...");
    return await input.backend.create(input.createInput);
  }
}

function logDevelopmentSandbox(message: string): void {
  if (isEveDevEnvironment()) {
    console.log(message);
  }
}

async function withDevelopmentSandboxProgress<T>(
  startMessage: string,
  progressMessage: string,
  callback: () => Promise<T>,
): Promise<T> {
  logDevelopmentSandbox(startMessage);
  if (!isEveDevEnvironment()) {
    return await callback();
  }

  const startedAt = Date.now();
  const timer = setInterval(() => {
    const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
    logDevelopmentSandbox(`${progressMessage} (${elapsedSeconds}s elapsed)...`);
  }, 5_000);
  timer.unref?.();

  try {
    return await callback();
  } finally {
    clearInterval(timer);
  }
}

function formatNodeLabel(nodeId: string): string {
  return nodeId === "__root__" ? "root" : nodeId;
}

/** Persist the unsanitized owner before a local backend can create any resources. */
async function recordLocalSandboxOwner(appRoot: string, sessionKey: string, sessionId: string) {
  const directory = join(appRoot, ".eve", "sandbox-cache", "microsandbox", "sessions", sessionKey);
  const createdDirectory = await mkdir(directory, { recursive: true });
  const path = join(directory, "owner.json");
  const temporary = `${path}.${randomUUID()}.tmp`;
  // Only a new directory proves resource recording was enabled from its inception.
  // Never upgrade a preexisting cache whose older provider resources may be unrecorded.
  const identity = JSON.stringify({
    version: 1,
    backendName: "microsandbox",
    sessionKey,
    sessionId,
    writeAheadResources: createdDirectory !== undefined ? true : undefined,
  });
  try {
    await writeFile(temporary, identity, { mode: 0o600 });
    try {
      // Publish a complete record without ever replacing a different owner.
      await link(temporary, path);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      const owner = JSON.parse(await readFile(path, "utf8"));
      if (
        owner.version !== 1 ||
        owner.backendName !== "microsandbox" ||
        owner.sessionKey !== sessionKey ||
        owner.sessionId !== sessionId ||
        (owner.writeAheadResources !== undefined && owner.writeAheadResources !== true)
      ) {
        throw new Error("Sandbox session already belongs to a different owner.");
      }
    }
  } finally {
    await rm(temporary, { force: true });
  }
}
