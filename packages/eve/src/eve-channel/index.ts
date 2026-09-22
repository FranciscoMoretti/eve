import { resolveForwardedPrincipal } from "#channel/forwarded-principal.js";
import type { Session } from "#channel/session.js";
import type { SessionAuthContext } from "#channel/types.js";
import { defaultEveAudience } from "#eve-channel/audience.js";
import { createEveSessionRoute } from "#eve-channel/create-session-route.js";
import {
  checkUploadPolicy,
  deriveOperationContinuationToken,
  parseCancelTurnBody,
  parseJsonRequest,
  parseResetBody,
  parseSessionControlBody,
  parseSessionMessageBody,
  requireSessionId,
} from "#eve-channel/request.js";
import {
  createSessionStreamResponse,
  parseIncludeTailIndex,
  parseStartIndex,
} from "#eve-channel/stream-response.js";
import {
  findRemoteSubagentBinding,
  healthResponse,
  normalizeEveCors,
  resolveOnMessage,
} from "#eve-channel/support.js";
import type { EveChannel, EveChannelInput, EveEventContext } from "#eve-channel/types.js";
import { handleActivityRequest } from "#execution/activity-route.js";
import { handleCheckpointReadiness } from "#execution/checkpoint-readiness.js";
import { handleConnectionCallbackRequest } from "#execution/connections/callback-route.js";
import { handleExpiredLegacyAuthorization } from "#execution/legacy-session/authorization.js";
import {
  readSessionCheckpoint,
  SessionCheckpointNotFoundError,
  SessionCheckpointRejectedError,
} from "#execution/read-session-checkpoint.js";
import { handleSandboxIdentityRead } from "#execution/sandbox-identity-read.js";
import { handleTaskInputResponseRequest } from "#execution/task-input-response-route.js";
import {
  handleWorkflowWebhookRequest,
  WORKFLOW_WEBHOOK_ROUTE_PATTERN,
} from "#execution/workflow-webhook-route.js";
import { attachClientContext } from "#internal/client-context.js";
import { createLogger, logError } from "#internal/logging.js";
import {
  readAgentInfoRouteResponse,
  readRemoteAgentStreamHeadersResolver,
} from "#internal/nitro/routes/channel-route-context.js";
import type { CancelTurnResponse } from "#protocol/cancel-turn.js";
import type { ClearResponse } from "#protocol/clear-session.js";
import type { CompactResponse } from "#protocol/compact-session.js";
import {
  EVE_SESSION_ID_HEADER,
  EVE_STREAM_CONTROL_VERSION_QUERY,
  EVE_STREAM_FORMAT_HEADER,
  EVE_STREAM_TAIL_INDEX_HEADER,
  EVE_STREAM_VERSION_HEADER,
  type SubagentCalledStreamEvent,
} from "#protocol/message.js";
import type { ResetResponse } from "#protocol/reset-session.js";
import {
  createEveSessionStreamRoutePath,
  createEveSubagentStreamRoutePath,
  EVE_ACTIVITY_ROUTE_PATTERN,
  EVE_CALLBACK_ROUTE_PATTERN,
  EVE_CONNECTION_CALLBACK_ROUTE_PATTERN,
  EVE_HEALTH_ROUTE_PATH,
  EVE_INFO_ROUTE_PATH,
  EVE_ROUTE_PREFIX,
  EVE_SESSION_CANCEL_ROUTE_PATTERN,
  EVE_SESSION_CLEAR_ROUTE_PATTERN,
  EVE_SESSION_COMPACT_ROUTE_PATTERN,
  EVE_SESSION_RESET_ROUTE_PATTERN,
  EVE_SESSION_ROUTE_PATTERN,
  EVE_SESSION_STREAM_ROUTE_PATTERN,
  EVE_SUBAGENT_STREAM_ROUTE_PATTERN,
  EVE_TASK_INPUT_ROUTE_PATTERN,
} from "#protocol/routes.js";
import { routeAuth } from "#public/channels/auth.js";
import { mergeUploadPolicy } from "#public/channels/upload-policy.js";
import { defineChannel, DELETE, GET, HEAD, PATCH, POST, PUT } from "#public/definitions/channel.js";
import { handleSessionCallbackRequest } from "#subagents/callback-route.js";

export * from "#eve-channel/types.js";

const log = createLogger("eve.channel");

/**
 * Builds the default eve HTTP channel: a {@link defineChannel} instance serving the
 * built-in `/eve/v1` routes (GET inspects the agent, POST creates a session,
 * ID-addressed POST routes deliver follow-ups and controls, and GET streams a
 * session's NDJSON event feed). Every route
 * runs {@link EveChannelInput.auth} via {@link routeAuth} before dispatching.
 * Default-export the result as your `agent/channels/eve.ts` channel; reach for
 * {@link defineChannel} directly only for a custom transport.
 */
export function eveChannel(input: EveChannelInput): EveChannel {
  const uploadPolicy = mergeUploadPolicy(input.uploadPolicy);

  return defineChannel<undefined, EveEventContext>({
    fetchFile: input.fetchFile,
    cors: normalizeEveCors(input.cors),
    turnPolicy: input.turnPolicy,
    audience: (classifierInput) => {
      const audience = input.audience ?? defaultEveAudience;
      return typeof audience === "function" ? audience(classifierInput) : audience;
    },
    routes: [
      GET(EVE_HEALTH_ROUTE_PATH, async () => healthResponse()),
      HEAD(EVE_HEALTH_ROUTE_PATH, async () => healthResponse()),

      GET("/eve/v1/operation/:operationId", async (req, { params, resolveSession }) => {
        const authResult = await routeAuth(req, input.auth);
        if (authResult instanceof Response) return authResult;
        if (authResult.principalType === "anonymous" || !params.operationId) {
          return Response.json(
            {
              error: "Operation lookup requires an authenticated principal and operation id.",
              ok: false,
            },
            { status: 400 },
          );
        }
        const kind = new URL(req.url).searchParams.get("kind");
        if (kind !== null && kind !== "seed")
          return Response.json({ error: "Unknown operation kind.", ok: false }, { status: 400 });
        const token = await deriveOperationContinuationToken({
          auth: authResult,
          operationId: params.operationId,
          kind: kind === "seed" ? "seed" : undefined,
        });
        const owner = await resolveSession(token);
        return owner
          ? Response.json({ sessionId: owner.id }, { headers: { "cache-control": "no-store" } })
          : Response.json(
              { error: "Operation not found.", code: "eve_operation_not_found" },
              { status: 404, headers: { "cache-control": "no-store" } },
            );
      }),

      GET(EVE_INFO_ROUTE_PATH, async (req, args) => {
        const authResult = await routeAuth(req, input.auth);
        if (authResult instanceof Response) return authResult;

        const respond = readAgentInfoRouteResponse(args);
        if (respond === undefined) {
          return Response.json(
            { error: "Agent info route requires internal channel dispatch context.", ok: false },
            { status: 500 },
          );
        }

        return await respond();
      }),

      GET(
        `${EVE_ROUTE_PREFIX}/connections/:name/callback/:token`,
        handleExpiredLegacyAuthorization,
      ),
      POST(
        `${EVE_ROUTE_PREFIX}/connections/:name/callback/:token`,
        handleExpiredLegacyAuthorization,
      ),
      GET(EVE_CONNECTION_CALLBACK_ROUTE_PATTERN, handleConnectionCallbackRequest),
      POST(EVE_CONNECTION_CALLBACK_ROUTE_PATTERN, handleConnectionCallbackRequest),
      POST(EVE_ACTIVITY_ROUTE_PATTERN, handleActivityRequest),
      POST(EVE_CALLBACK_ROUTE_PATTERN, handleSessionCallbackRequest),
      POST(EVE_TASK_INPUT_ROUTE_PATTERN, handleTaskInputResponseRequest),
      GET(WORKFLOW_WEBHOOK_ROUTE_PATTERN, handleWorkflowWebhookRequest),
      POST(WORKFLOW_WEBHOOK_ROUTE_PATTERN, handleWorkflowWebhookRequest),
      PUT(WORKFLOW_WEBHOOK_ROUTE_PATTERN, handleWorkflowWebhookRequest),
      PATCH(WORKFLOW_WEBHOOK_ROUTE_PATTERN, handleWorkflowWebhookRequest),
      DELETE(WORKFLOW_WEBHOOK_ROUTE_PATTERN, handleWorkflowWebhookRequest),

      createEveSessionRoute(input),

      POST(EVE_SESSION_ROUTE_PATTERN, async (req, { attachSession, params }) => {
        const authResult = await routeAuth(req, input.auth);
        if (authResult instanceof Response) return authResult;

        const sessionId = requireSessionId(params);
        if (sessionId instanceof Response) return sessionId;
        const payload = await parseJsonRequest(req);
        if (payload instanceof Response) return payload;
        const forwarded = await resolveForwardedPrincipal({
          trustedForwarders: input.trustedForwarders,
          forwarder: authResult,
          payload,
        });
        if (forwarded instanceof Response) return forwarded;
        const body = parseSessionMessageBody(payload);
        if (body instanceof Response) return body;

        const policyRejection = checkUploadPolicy(body, uploadPolicy);
        if (policyRejection !== null) return policyRejection;

        let context: readonly string[] | undefined;
        let title: string | undefined;
        let dispatchAuth: SessionAuthContext | null = forwarded.auth;
        if (body.message !== undefined) {
          const messageResult = await resolveOnMessage({
            auth: forwarded.auth,
            config: input,
            message: body.message,
            request: req,
            sessionId,
          });
          if (messageResult instanceof Response) return messageResult;
          context = messageResult.context;
          title = messageResult.title;
          dispatchAuth = messageResult.auth;
        }

        let result: Awaited<ReturnType<Session["send"]>>;
        try {
          const session = attachSession(sessionId);
          const options = attachClientContext(
            {
              activityObserver: body.activityObserver,
              auth: dispatchAuth,
              callback: body.callback,
              context,
              outputSchema: body.outputSchema,
              turnPolicy: body.turnPolicy,
              title,
              messageMetadata: body.messageMetadata,
            },
            body.context,
          );
          result =
            body.inputResponses === undefined
              ? await session.send(body.message!, options)
              : await session.respond(body.inputResponses, options);
        } catch (error) {
          const errorId = logError(log, "session-message request failed", error, { sessionId });
          return Response.json(
            { error: "Failed to send the session message.", errorId, ok: false },
            { status: 500 },
          );
        }
        if (result.status !== "accepted") {
          return Response.json(
            {
              code: result.retryable ? "session_not_ready" : "session_not_active",
              error:
                result.retryable === true
                  ? "The session is not ready to accept messages yet."
                  : "The session is no longer active.",
              ok: false,
            },
            { headers: { "cache-control": "no-store" }, status: 409 },
          );
        }

        return Response.json(
          {
            ok: true,
            sessionId: result.sessionId,
            status: "accepted",
            deliveryId: result.deliveryId,
          },
          {
            headers: {
              "cache-control": "no-store",
              [EVE_SESSION_ID_HEADER]: result.sessionId,
            },
            status: 202,
          },
        );
      }),

      POST(EVE_SESSION_CANCEL_ROUTE_PATTERN, async (req, { attachSession, params }) => {
        const authResult = await routeAuth(req, input.auth);
        if (authResult instanceof Response) return authResult;
        const sessionId = requireSessionId(params);
        if (sessionId instanceof Response) return sessionId;
        const body = await parseCancelTurnBody(req);
        if (body instanceof Response) return body;
        let result: Awaited<ReturnType<Session["cancel"]>>;
        try {
          result = await attachSession(sessionId).cancel({
            taskId: body.taskId,
            tasks: body.tasks,
            turnId: body.turnId,
          });
        } catch (error) {
          const errorId = logError(log, "cancel-turn request failed", error, { sessionId });
          return Response.json(
            { error: "Failed to cancel the turn.", errorId, ok: false },
            { status: 500 },
          );
        }
        return Response.json(
          result.status === "accepted"
            ? ({
                ok: true,
                sessionId: result.sessionId,
                status: "accepted",
              } satisfies CancelTurnResponse)
            : ({ ok: true, status: "no_active_turn" } satisfies CancelTurnResponse),
          {
            headers: { "cache-control": "no-store" },
            status: result.status === "accepted" ? 202 : 200,
          },
        );
      }),

      GET("/eve/v1/session/:sessionId/sandbox-identity", async (req, { params }) => {
        const authResult = await routeAuth(req, input.auth);
        if (authResult instanceof Response) return authResult;
        const sessionId = requireSessionId(params);
        if (sessionId instanceof Response) return sessionId;
        return handleSandboxIdentityRead(req, sessionId);
      }),

      GET("/eve/v1/session/:sessionId/checkpoint", async (req, { params }) => {
        const authResult = await routeAuth(req, input.auth);
        if (authResult instanceof Response) return authResult;
        const sessionId = requireSessionId(params);
        if (sessionId instanceof Response) return sessionId;
        return handleCheckpointReadiness(req, sessionId);
      }),

      POST("/eve/v1/session/:sessionId/checkpoint", async (req, { attachSession, params }) => {
        const authResult = await routeAuth(req, input.auth);
        if (authResult instanceof Response) return authResult;
        const sessionId = requireSessionId(params);
        if (sessionId instanceof Response) return sessionId;
        const body = await req.json().catch(() => null);
        if (
          !body ||
          typeof body !== "object" ||
          !("checkpointId" in body) ||
          !("beforeTurnId" in body) ||
          typeof body.checkpointId !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            body.checkpointId,
          ) ||
          typeof body.beforeTurnId !== "string" ||
          !/^turn_(0|[1-9][0-9]*)$/.test(body.beforeTurnId)
        )
          return Response.json({ error: "Invalid checkpoint request." }, { status: 400 });
        const source = attachSession(sessionId);
        if (!source.checkpoint)
          return Response.json({ error: "Idle checkpoints are unavailable." }, { status: 409 });
        const result = await source.checkpoint({
          checkpointId: body.checkpointId,
          beforeTurnId: body.beforeTurnId,
        });
        return Response.json(result, {
          status: result.status === "accepted" ? 202 : 409,
          headers: { "cache-control": "no-store" },
        });
      }),
      GET("/eve/v1/session/:sessionId/checkpoint/:checkpointId", async (req, { params }) => {
        const authResult = await routeAuth(req, input.auth);
        if (authResult instanceof Response) return authResult;
        const sessionId = requireSessionId(params);
        if (sessionId instanceof Response) return sessionId;
        const checkpointId = params?.checkpointId;
        const beforeTurnId = new URL(req.url).searchParams.get("beforeTurnId");
        if (
          typeof checkpointId !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(checkpointId) ||
          !beforeTurnId ||
          !/^turn_(0|[1-9][0-9]*)$/.test(beforeTurnId)
        )
          return Response.json({ error: "Invalid checkpoint reference." }, { status: 400 });
        try {
          await readSessionCheckpoint({ sessionId, checkpointId, beforeTurnId });
          return Response.json(
            { ready: true, sessionId, checkpointId, beforeTurnId },
            { headers: { "cache-control": "no-store" } },
          );
        } catch (error) {
          if (error instanceof SessionCheckpointNotFoundError)
            return Response.json(
              { code: "checkpoint_not_ready" },
              { status: 404, headers: { "cache-control": "no-store" } },
            );
          if (error instanceof SessionCheckpointRejectedError)
            return Response.json(
              { error: error.message, checkpointRejected: true },
              { status: 409 },
            );
          throw error;
        }
      }),

      POST(EVE_SESSION_COMPACT_ROUTE_PATTERN, async (req, { attachSession, params }) => {
        const authResult = await routeAuth(req, input.auth);
        if (authResult instanceof Response) return authResult;
        const sessionId = requireSessionId(params);
        if (sessionId instanceof Response) return sessionId;
        const body = await parseSessionControlBody(req);
        if (body instanceof Response) return body;
        let result: Awaited<ReturnType<Session["compact"]>>;
        try {
          result = await attachSession(sessionId).compact();
        } catch (error) {
          const errorId = logError(log, "session-compaction request failed", error, { sessionId });
          return Response.json(
            { error: "Failed to compact the session.", errorId, ok: false },
            { status: 500 },
          );
        }
        return Response.json(
          result.status === "accepted"
            ? ({
                ok: true,
                sessionId: result.sessionId,
                status: "accepted",
              } satisfies CompactResponse)
            : ({ ok: true, status: "no_active_session" } satisfies CompactResponse),
          {
            headers: { "cache-control": "no-store" },
            status: result.status === "accepted" ? 202 : 200,
          },
        );
      }),

      POST(EVE_SESSION_CLEAR_ROUTE_PATTERN, async (req, { attachSession, params }) => {
        const authResult = await routeAuth(req, input.auth);
        if (authResult instanceof Response) return authResult;
        const sessionId = requireSessionId(params);
        if (sessionId instanceof Response) return sessionId;
        const body = await parseSessionControlBody(req);
        if (body instanceof Response) return body;
        let result: Awaited<ReturnType<Session["clear"]>>;
        try {
          result = await attachSession(sessionId).clear();
        } catch (error) {
          const errorId = logError(log, "session-clear request failed", error, { sessionId });
          return Response.json(
            { error: "Failed to clear the session context.", errorId, ok: false },
            { status: 500 },
          );
        }
        return Response.json(
          result.status === "accepted"
            ? ({
                ok: true,
                sessionId: result.sessionId,
                status: "accepted",
              } satisfies ClearResponse)
            : ({ ok: true, status: "no_active_session" } satisfies ClearResponse),
          {
            headers: { "cache-control": "no-store" },
            status: result.status === "accepted" ? 202 : 200,
          },
        );
      }),

      POST(EVE_SESSION_RESET_ROUTE_PATTERN, async (req, { attachSession, params }) => {
        const authResult = await routeAuth(req, input.auth);
        if (authResult instanceof Response) return authResult;
        const sessionId = requireSessionId(params);
        if (sessionId instanceof Response) return sessionId;
        const body = await parseResetBody(req);
        if (body instanceof Response) return body;
        let result: Awaited<ReturnType<Session["reset"]>>;
        try {
          result = await attachSession(sessionId).reset({ reason: body.reason });
        } catch (error) {
          const errorId = logError(log, "session-reset request failed", error, { sessionId });
          return Response.json(
            { error: "Failed to reset the session.", errorId, ok: false },
            { status: 500 },
          );
        }
        return Response.json(
          result.status === "reset"
            ? ({
                ok: true,
                previousSessionId: result.previousSessionId,
                status: "reset",
              } satisfies ResetResponse)
            : ({ ok: true, status: "no_active_session" } satisfies ResetResponse),
          { headers: { "cache-control": "no-store" } },
        );
      }),

      GET(EVE_SESSION_STREAM_ROUTE_PATTERN, async (req, { attachSession, params }) => {
        const authResult = await routeAuth(req, input.auth);
        if (authResult instanceof Response) return authResult;
        const sessionId = requireSessionId(params);
        if (sessionId instanceof Response) return sessionId;
        return await createSessionStreamResponse(req, attachSession(sessionId));
      }),

      GET(EVE_SUBAGENT_STREAM_ROUTE_PATTERN, async (req, args) => {
        const authResult = await routeAuth(req, input.auth);
        if (authResult instanceof Response) return authResult;

        const parentSessionId = args.params.parentSessionId;
        const callId = args.params.callId;
        const childSessionId = args.params.childSessionId;
        if (!parentSessionId || !callId || !childSessionId) {
          return Response.json(
            { error: "Missing subagent stream coordinates.", ok: false },
            { status: 400 },
          );
        }

        const startIndex = parseStartIndex(req);
        if (startIndex instanceof Response) return startIndex;
        const includeTailIndex = parseIncludeTailIndex(req);

        const childStreamPath = createEveSubagentStreamRoutePath({
          callId,
          childSessionId,
          parentSessionId,
        });
        let binding: SubagentCalledStreamEvent;
        try {
          const parent = args.attachSession(parentSessionId);
          const found = await findRemoteSubagentBinding({
            callId,
            childSessionId,
            childStreamPath,
            parentSessionId,
            parent,
          });
          if (found === undefined) {
            throw new Error("Remote subagent binding not found.");
          }
          binding = found;
        } catch {
          return Response.json({ error: "Subagent stream not found.", ok: false }, { status: 404 });
        }

        const resolveHeaders = readRemoteAgentStreamHeadersResolver(args);
        if (resolveHeaders === undefined) {
          return Response.json(
            {
              error: "Subagent stream proxy requires internal channel dispatch context.",
              ok: false,
            },
            { status: 500 },
          );
        }

        let headers: Record<string, string>;
        try {
          headers = await resolveHeaders({
            name: binding.data.toolName,
            resolverId: binding.data.remote!.resolverId,
            url: binding.data.remote!.url,
          });
        } catch {
          return Response.json({ error: "Subagent stream not found.", ok: false }, { status: 404 });
        }

        const upstreamUrl = new URL(
          createEveSessionStreamRoutePath(childSessionId).replace(/^\/+/, ""),
          `${binding.data.remote!.url.replace(/\/+$/, "")}/`,
        );
        if (startIndex !== undefined) {
          upstreamUrl.searchParams.set("startIndex", String(startIndex));
        }
        const controlVersion = new URL(req.url).searchParams.get(EVE_STREAM_CONTROL_VERSION_QUERY);
        if (controlVersion !== null) {
          upstreamUrl.searchParams.set(EVE_STREAM_CONTROL_VERSION_QUERY, controlVersion);
        }
        if (includeTailIndex) {
          upstreamUrl.searchParams.set("includeTailIndex", "1");
        }

        const upstream = await fetch(upstreamUrl, {
          cache: "no-store",
          headers,
          redirect: "manual",
          signal: req.signal,
        });
        const responseHeaders = new Headers();
        for (const name of [
          "cache-control",
          "content-type",
          "x-accel-buffering",
          EVE_SESSION_ID_HEADER,
          EVE_STREAM_FORMAT_HEADER,
          EVE_STREAM_TAIL_INDEX_HEADER,
          EVE_STREAM_VERSION_HEADER,
        ]) {
          const value = upstream.headers.get(name);
          if (value !== null) responseHeaders.set(name, value);
        }
        return new Response(upstream.body, {
          headers: responseHeaders,
          status: upstream.status,
          statusText: upstream.statusText,
        });
      }),
    ],
    events: input.events,
  });
}
