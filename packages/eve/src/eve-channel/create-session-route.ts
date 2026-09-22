import { resolveForwardedPrincipal } from "#channel/forwarded-principal.js";
import type { SessionParent, SessionTraceContext } from "#channel/types.js";
import {
  checkUploadPolicy,
  deriveOperationContinuationToken,
  parseCreateBody,
  parseOptionalJsonRequest,
  rejectSessionContinuationToken,
} from "#eve-channel/request.js";
import { resolveOnMessage } from "#eve-channel/support.js";
import type { EveChannelInput } from "#eve-channel/types.js";
import {
  parseSessionTranscriptSeed,
  type SessionTranscriptSeed,
} from "#execution/session-transcript-seed.js";
import { attachClientContext } from "#internal/client-context.js";
import { createLogger, logError } from "#internal/logging.js";
import { readRouteSessionCreator } from "#internal/nitro/routes/channel-route-context.js";
import {
  readForwardedAudienceBaggage,
  readForwardedParentSessionBaggage,
} from "#protocol/baggage.js";
import { EVE_SESSION_ID_HEADER } from "#protocol/message.js";
import { EVE_SESSION_ROUTE_PATH } from "#protocol/routes.js";
import { parseTraceparent, readAgentDispatchTraceContext } from "#protocol/traceparent.js";
import { routeAuth } from "#public/channels/auth.js";
import { mergeUploadPolicy } from "#public/channels/upload-policy.js";
import { POST } from "#public/definitions/channel.js";
import {
  FAIL_CLOSED_FORWARDED_TRACE_ASSERTION,
  formatTraceContentCeiling,
} from "#shared/forwarded-trace-policy.js";
import { readConversationBaggage } from "#tracing/conversation-context.js";

export * from "#eve-channel/types.js";

const log = createLogger("eve.channel");
export function createEveSessionRoute(input: EveChannelInput) {
  const uploadPolicy = mergeUploadPolicy(input.uploadPolicy);
  return POST(EVE_SESSION_ROUTE_PATH, async (req, args) => {
    const authResult = await routeAuth(req, input.auth);
    if (authResult instanceof Response) return authResult;

    const payload = await parseOptionalJsonRequest(req);
    if (payload instanceof Response) return payload;
    const tokenRejection = rejectSessionContinuationToken(payload);
    if (tokenRejection !== null) return tokenRejection;

    const forwarded = await resolveForwardedPrincipal({
      trustedForwarders: input.trustedForwarders,
      forwarder: authResult,
      payload,
    });
    if (forwarded instanceof Response) return forwarded;

    const body = parseCreateBody(payload);
    if (body instanceof Response) return body;
    if (body.seed && (forwarded.auth.principalType === "anonymous" || !input.resolveSeed)) {
      return Response.json({ error: "Session seed access denied.", ok: false }, { status: 403 });
    }
    if (body.fork) {
      if (
        forwarded.auth.principalType === "anonymous" ||
        !input.authorizeFork ||
        !(await input.authorizeFork({
          auth: forwarded.auth,
          sourceSessionId: body.fork.sessionId,
        }))
      ) {
        return Response.json({ error: "Session fork access denied.", ok: false }, { status: 403 });
      }
    }

    const forwardedParentSession =
      body.callback === undefined
        ? "absent"
        : readForwardedParentSessionBaggage(req.headers.get("baggage"));
    let parent: SessionParent | undefined;
    if (typeof forwardedParentSession === "object") {
      if (forwardedParentSession.callId !== body.callback?.callId) {
        log.warn("ignoring remote parent lineage with a mismatched callback", {
          forwarder: authResult.principalId,
        });
      } else {
        let accepted = forwarded.accepted;
        if (!accepted && input.trustedForwarders !== undefined) {
          try {
            accepted = await input.trustedForwarders(authResult);
          } catch (error) {
            const errorId = logError(log, "trustedForwarders handler failed", error, {
              forwarder: authResult.principalId,
            });
            return Response.json(
              { error: "trustedForwarders handler failed.", errorId, ok: false },
              { status: 500 },
            );
          }
        }
        if (accepted) {
          parent = forwardedParentSession;
        } else {
          log.warn("ignoring remote parent lineage from an untrusted forwarder", {
            forwarder: authResult.principalId,
          });
        }
      }
    } else if (forwardedParentSession === "malformed") {
      log.warn("ignoring malformed remote parent lineage", {
        forwarder: authResult.principalId,
      });
    }
    const transportParentTraceContext =
      body.callback === undefined ? undefined : parseTraceparent(req.headers.get("traceparent"));
    const parsedParentTraceContext =
      body.callback === undefined
        ? undefined
        : (readAgentDispatchTraceContext(
            req.headers.get("tracestate"),
            transportParentTraceContext,
          ) ?? transportParentTraceContext);

    const policyRejection = checkUploadPolicy(body, uploadPolicy);
    if (policyRejection !== null) return policyRejection;

    if (body.operationId !== undefined && forwarded.auth.principalType === "anonymous") {
      return Response.json(
        { error: "operationId requires an authenticated principal.", ok: false },
        { status: 400 },
      );
    }
    const operationToken =
      body.operationId === undefined
        ? undefined
        : await deriveOperationContinuationToken({
            auth: forwarded.auth,
            operationId: body.operationId,
            kind: body.seed ? "seed" : undefined,
          });
    if (operationToken !== undefined) {
      const owner = await args.resolveSession(operationToken);
      if (owner !== undefined) {
        return Response.json(
          { ok: true, sessionId: owner.id, status: "accepted" },
          {
            headers: {
              "cache-control": "no-store",
              [EVE_SESSION_ID_HEADER]: owner.id,
            },
            status: 202,
          },
        );
      }
    }

    let seed: SessionTranscriptSeed | undefined;
    if (body.seed) {
      try {
        const resolved = await input.resolveSeed?.({
          auth: forwarded.auth,
          operationId: body.operationId!,
        });
        if (!resolved)
          return Response.json(
            { error: "Session seed access denied.", ok: false },
            { status: 403 },
          );
        seed = parseSessionTranscriptSeed(resolved);
      } catch (error) {
        const errorId = logError(log, "session-seed preparation failed", error);
        return Response.json(
          { error: "Failed to prepare the session copy.", errorId, ok: false },
          { status: 500, headers: { "cache-control": "no-store" } },
        );
      }
    }

    const forwardedTraceAssertion =
      transportParentTraceContext === undefined
        ? "absent"
        : readForwardedAudienceBaggage(req.headers.get("baggage"));
    const acceptsForwardedTracePolicy =
      forwarded.accepted &&
      transportParentTraceContext !== undefined &&
      (transportParentTraceContext.traceFlags & 1) === 1;
    const acceptedForwardedTracePolicy = !acceptsForwardedTracePolicy
      ? undefined
      : typeof forwardedTraceAssertion === "object"
        ? forwardedTraceAssertion
        : forwardedTraceAssertion === "malformed"
          ? FAIL_CLOSED_FORWARDED_TRACE_ASSERTION
          : undefined;
    let parentTraceContext: SessionTraceContext | undefined = parsedParentTraceContext;
    if (acceptedForwardedTracePolicy !== undefined && parsedParentTraceContext !== undefined) {
      parentTraceContext = {
        ...parsedParentTraceContext,
        forwardedTracePolicy: acceptedForwardedTracePolicy,
      };
    }
    if (forwardedTraceAssertion === "malformed") {
      log.warn("using metadata-only policy for malformed forwarded audience baggage", {
        forwarder: authResult.principalId,
      });
    } else if (typeof forwardedTraceAssertion === "object") {
      if (acceptedForwardedTracePolicy !== undefined) {
        log.info("accepted forwarded trace policy", {
          audience: forwardedTraceAssertion.originAudience,
          ceiling: formatTraceContentCeiling(forwardedTraceAssertion.ceiling),
          forwarder: authResult.principalId,
        });
      } else {
        log.warn("ignoring forwarded trace policy without an accepted sampled principal", {
          forwarder: authResult.principalId,
        });
      }
    }

    const messageResult =
      body.message === undefined
        ? { auth: forwarded.auth }
        : await resolveOnMessage({
            auth: forwarded.auth,
            config: input,
            message: body.message,
            request: req,
          });
    if (messageResult instanceof Response) return messageResult;
    if (
      body.fork &&
      messageResult.auth !== forwarded.auth &&
      (messageResult.auth === null ||
        messageResult.auth.principalType === "anonymous" ||
        !input.authorizeFork ||
        !(await input.authorizeFork({
          auth: messageResult.auth,
          sourceSessionId: body.fork.sessionId,
        })))
    ) {
      return Response.json({ error: "Session fork access denied.", ok: false }, { status: 403 });
    }
    const createSession = readRouteSessionCreator(args);
    if (createSession === undefined) {
      return Response.json(
        { error: "Session creation requires internal channel dispatch context.", ok: false },
        { status: 500 },
      );
    }

    let handle: Awaited<ReturnType<typeof createSession>>;
    try {
      handle = await createSession({
        fork: body.fork,
        seed,
        activityObserver: body.activityObserver,
        audienceAuth: authResult,
        auth: messageResult.auth,
        capabilities:
          body.capabilities ?? (body.mode === "task" ? undefined : { requestInput: true }),
        callback: body.callback,
        continuationToken: operationToken,
        initiatorAuth: forwarded.accepted ? forwarded.initiatorAuth : undefined,
        input: attachClientContext(
          {
            message: body.message,
            messageMetadata: body.messageMetadata,
            context: messageResult.context,
            outputSchema: body.outputSchema,
          },
          body.context,
        ),
        mode: body.mode ?? "conversation",
        conversationId:
          body.callback === undefined
            ? undefined
            : readConversationBaggage(req.headers.get("baggage")),
        parent,
        parentTraceContext,
        title: messageResult.title,
      });
    } catch (error) {
      const errorId = logError(log, "session-create request failed", error);
      return Response.json(
        { error: "Failed to create the session.", errorId, ok: false },
        { status: 500 },
      );
    }

    // Workflow start returns a candidate before its continuation hook is claimed.
    // A create-once caller must receive the durable owner, including when a
    // concurrent candidate won. Never let it bind the losing candidate ID.
    let acceptedSessionId = handle.sessionId;
    if (operationToken !== undefined) {
      const deadline = Date.now() + 15_000;
      let owner = await args.resolveSession(operationToken);
      while (owner === undefined && Date.now() < deadline && !req.signal.aborted) {
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
        owner = await args.resolveSession(operationToken);
      }
      if (owner === undefined) {
        return Response.json(
          {
            error: "Operation acceptance is unresolved. Retry the same operationId.",
            code: "eve_operation_pending",
          },
          { status: 503, headers: { "cache-control": "no-store" } },
        );
      }
      acceptedSessionId = owner.id;
    }

    return Response.json(
      { ok: true, sessionId: acceptedSessionId, status: "accepted" },
      {
        headers: {
          "cache-control": "no-store",
          [EVE_SESSION_ID_HEADER]: acceptedSessionId,
        },
        status: 202,
      },
    );
  });
}
