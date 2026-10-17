import { routeAuth } from "#public/channels/auth.js";
import { sessionAuthFromResult } from "#channel/auth/result.js";
import { resolveForwardedPrincipal } from "#channel/forwarded-principal.js";
import { parseJsonRequest, requireSessionId } from "#eve-channel/request.js";
import type { EveChannelInput } from "#eve-channel/types.js";
import type { RouteContext } from "#public/definitions/channel.js";
import {
  copyCheckpointPrincipal,
  boundaryCopyCheckpointId,
  readCopyCheckpoint,
  validateCopyCheckpointRequest,
} from "#execution/copy-checkpoint.js";
import { resumeSessionInbox } from "#execution/session-inbox/resume.js";

export function copyCheckpointHandler(config: EveChannelInput) {
  return async (request: Request, context: RouteContext): Promise<Response> => {
    const authentication = await routeAuth(request, config.auth);
    if (authentication instanceof Response) return authentication;
    const forwarded = await resolveForwardedPrincipal({
      trustedForwarders: config.trustedForwarders,
      forwarder: sessionAuthFromResult(authentication),
      payload: {},
    });
    if (forwarded instanceof Response) return forwarded;
    const sessionId = requireSessionId(context.params);
    if (sessionId instanceof Response) return sessionId;
    if (
      forwarded.auth.principalType === "anonymous" ||
      config.authorizeFork === undefined ||
      !(await config.authorizeFork({ auth: forwarded.auth, sourceSessionId: sessionId }))
    )
      return Response.json({ error: "Source checkpoint is unavailable." }, { status: 403 });
    const query = new URL(request.url).searchParams;
    const capture = request.method === "POST";
    const body = capture ? await parseJsonRequest(request) : undefined;
    if (body instanceof Response) return body;
    if (
      capture &&
      (query.size !== 0 ||
        !body ||
        Object.keys(body).some((key) => key !== "beforeTurnId" && key !== "checkpointId") ||
        typeof body.beforeTurnId !== "string" ||
        typeof body.checkpointId !== "string")
    )
      return Response.json({ error: "Invalid checkpoint request." }, { status: 400 });
    const beforeTurnId = capture ? String(body?.beforeTurnId) : (query.get("beforeTurnId") ?? "");
    const checkpointId = capture
      ? String(body?.checkpointId)
      : (context.params.checkpointId ?? boundaryCopyCheckpointId(sessionId, beforeTurnId));
    const command = {
      kind: "copy-checkpoint" as const,
      checkpointId,
      beforeTurnId,
      principalId: forwarded.auth.principalId,
      principalIdentity: copyCheckpointPrincipal(forwarded.auth),
    };
    try {
      validateCopyCheckpointRequest(command);
    } catch {
      return Response.json({ error: "Invalid checkpoint identity." }, { status: 400 });
    }
    if (
      !capture &&
      ([...query.keys()].some((key) => key !== "beforeTurnId") ||
        query.getAll("beforeTurnId").length !== 1)
    )
      return Response.json({ error: "Invalid checkpoint query." }, { status: 400 });
    try {
      const record = await readCopyCheckpoint(sessionId, checkpointId);
      if (record !== undefined) {
        if (
          record.beforeTurnId !== beforeTurnId ||
          record.principalId !== command.principalId ||
          record.principalIdentity !== command.principalIdentity
        )
          return Response.json({ error: "Checkpoint identity conflict." }, { status: 409 });
        if (capture)
          return Response.json(
            { accepted: true },
            { status: 202, headers: { "cache-control": "no-store" } },
          );
        if ("rejected" in record)
          return Response.json(
            { checkpointRejected: true, error: record.rejected },
            { status: 409, headers: { "cache-control": "no-store" } },
          );
        return Response.json(
          { ready: true, sessionId, beforeTurnId, checkpointId },
          { headers: { "cache-control": "no-store" } },
        );
      }
      if (capture) {
        await resumeSessionInbox({ sessionId }, command);
        return Response.json(
          { accepted: true },
          { status: 202, headers: { "cache-control": "no-store" } },
        );
      }
      return Response.json(
        { code: "checkpoint_not_ready" },
        { status: 404, headers: { "cache-control": "no-store" } },
      );
    } catch {
      return Response.json(
        { error: "Source checkpoint is unavailable." },
        { status: 409, headers: { "cache-control": "no-store" } },
      );
    }
  };
}
