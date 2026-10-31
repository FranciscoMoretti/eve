import { createHash } from "node:crypto";
import { loadContext } from "#context/container.js";
import { SandboxKey } from "#context/keys.js";
import { decodeSandboxRef } from "#internal/attachments/sandbox-refs.js";
import { stageSeedFile } from "#harness/attachment-staging.js";
import type { HarnessSession } from "#harness/types.js";
import type { SessionTranscriptSeed } from "#execution/session-transcript-seed.js";
import type { HarnessModelMessage } from "#harness/messages.js";

const PENDING = "eve.pending-seed-files";
const STRICT = "eve.seed-file-digests";

export function markSeedAttachmentsPending(
  session: HarnessSession,
  seed: SessionTranscriptSeed,
): HarnessSession {
  const paths: Record<string, string> = {};
  for (const message of seed.messages) {
    for (const part of message.parts) {
      if (part.type !== "file") continue;
      if (paths[part.url] !== undefined && paths[part.url] !== part.existingPath)
        throw new Error("An imported attachment cannot identify different workspace paths.");
      paths[part.url] = part.existingPath;
    }
  }
  return Object.keys(paths).length === 0
    ? session
    : { ...session, state: { ...session.state, [PENDING]: paths } };
}

export function seedFileDigests(session: Pick<HarnessSession, "state">): Record<string, string> {
  const value = session.state?.[STRICT];
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid copied file state.");
  const result: Record<string, string> = {};
  for (const [path, digest] of Object.entries(value)) {
    if (typeof digest !== "string") throw new Error("Invalid copied file digest.");
    result[path] = digest;
  }
  return result;
}

/** The pending marker survives failure; only the complete staged history clears it. */
export async function stagePendingSeedAttachments(
  session: HarnessSession,
): Promise<HarnessSession> {
  const paths = session.state?.[PENDING];
  if (paths === undefined) return session;
  if (!paths || typeof paths !== "object" || Array.isArray(paths))
    throw new Error("Invalid imported attachment paths.");
  const history: HarnessModelMessage[] = [];
  const digests = seedFileDigests(session);
  for (const message of session.history) {
    if (
      (message.role !== "user" && message.role !== "assistant") ||
      typeof message.content === "string"
    ) {
      history.push(message);
      continue;
    }
    const content = [];
    for (const part of message.content) {
      if (part.type !== "file") {
        content.push(part);
        continue;
      }
      const url = part.data instanceof URL ? part.data.href : undefined;
      const existingPath = url === undefined ? undefined : Reflect.get(paths, url);
      if (typeof existingPath !== "string")
        throw new Error("Imported attachment has no authorized workspace path.");
      const { part: staged, digest } = await stageSeedFile(part, existingPath);
      const ref = decodeSandboxRef(staged.data as URL);
      const sandbox = await loadContext().get(SandboxKey)?.get();
      const bytes = await sandbox?.readBinaryFile({ path: ref.path });
      if (!bytes || createHash("sha256").update(bytes).digest("hex") !== digest)
        throw new Error("Copied file was not stored intact in the destination sandbox.");
      digests[ref.path] = digest;
      content.push(staged);
    }
    history.push({ ...message, content } as HarnessModelMessage);
  }
  const state: Record<string, unknown> = { ...session.state, [STRICT]: digests };
  delete state[PENDING];
  return { ...session, state, history };
}
