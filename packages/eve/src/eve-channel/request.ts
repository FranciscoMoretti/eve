import type { SessionForkReference } from "#execution/session-checkpoint-contract.js";
import type { FilePart, TextPart, UserContent } from "ai";

import { parseSessionCallback } from "#channel/session-callback.js";
import type {
  ActivityObserverConfig,
  SessionAuthContext,
  SessionCallback,
  SessionCapabilities,
  TurnPolicy,
} from "#channel/types.js";
import {
  parseActivityObserverField,
  validateActivityObserverBinding,
} from "#eve-channel/activity-observer-request.js";
import { validateMessageFreeCreate, type ParsedCreateBody } from "#eve-channel/create-request.js";
import { hasInternalRefScheme } from "#internal/attachments/url-refs.js";
import {
  collectUploadPolicyViolations,
  formatUploadPolicyViolation,
  type UploadPolicy,
} from "#public/channels/upload-policy.js";
import { isInputResponse, type ValidatedInputResponse } from "#shared/input.js";
import { parseJsonObject, type JsonObject } from "#shared/json.js";
import type { RunMode } from "#shared/run-mode.js";

/** Replay-stable identity for one authenticated create operation. */
export async function deriveOperationContinuationToken(input: {
  readonly auth: SessionAuthContext;
  readonly operationId: string;
  readonly kind?: "seed";
}): Promise<string> {
  const identity = JSON.stringify([
    input.kind === "seed" ? "eve:seed-session:v1" : "eve:create-session:v1",
    input.auth.authenticator,
    input.auth.issuer ?? null,
    input.auth.principalType,
    input.auth.principalId,
    input.operationId,
  ]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
  return `eve:op:${hex.slice(0, 32)}`;
}

export function parseCreateBody(payload: Record<string, unknown>): ParsedCreateBody | Response {
  if (payload.seed !== undefined) {
    if (
      payload.seed !== true ||
      typeof payload.operationId !== "string" ||
      !payload.operationId.length ||
      payload.operationId.length > 256 ||
      Object.keys(payload).some((key) => !["seed", "operationId"].includes(key))
    ) {
      return Response.json(
        { error: "A seed request accepts only seed: true and an operationId.", ok: false },
        { status: 400 },
      );
    }
    return { seed: true, operationId: payload.operationId, mode: "conversation" };
  }
  if (payload.inputResponses !== undefined) {
    return Response.json(
      { error: "'inputResponses' is only accepted for an existing session.", ok: false },
      { status: 400 },
    );
  }
  const message = parseMessageField(payload.message);
  if (message instanceof Response) return message;
  const messageMetadata = parseMessageMetadataField(payload.messageMetadata);
  if (messageMetadata instanceof Response) return messageMetadata;
  if (messageMetadata !== undefined && message === undefined) {
    return Response.json(
      { error: "'messageMetadata' requires a message.", ok: false },
      { status: 400 },
    );
  }

  const context = parseClientContextField(payload.clientContext);
  if (context instanceof Response) return context;

  const callback = parseCallbackField(payload.callback);
  if (callback instanceof Response) return callback;

  const capabilities = parseCapabilitiesField(payload.capabilities);
  if (capabilities instanceof Response) return capabilities;

  const activityObserver = parseActivityObserverField(payload.activityObserver);
  if (activityObserver instanceof Response) return activityObserver;
  if (activityObserver !== undefined) {
    const observerRejection = validateActivityObserverBinding(activityObserver, callback);
    if (observerRejection !== undefined) return observerRejection;
  }

  const mode = parseModeField(payload.mode);
  if (mode instanceof Response) return mode;

  const outputSchema = parseOutputSchemaField(payload.outputSchema);
  if (outputSchema instanceof Response) return outputSchema;

  const messageFreeRejection = validateMessageFreeCreate({
    activityObserver,
    callback,
    hasClientContext: payload.clientContext !== undefined,
    hasMessageField: "message" in payload,
    message,
    mode,
    outputSchema,
  });
  if (messageFreeRejection !== undefined) return messageFreeRejection;

  const rawOperationId = payload.operationId;
  if (rawOperationId !== undefined && (typeof rawOperationId !== "string" || !rawOperationId)) {
    return Response.json(
      { error: "Expected 'operationId' to be a non-empty string.", ok: false },
      { status: 400 },
    );
  }

  let fork: SessionForkReference | undefined;
  if (payload.fork !== undefined) {
    const value = payload.fork;
    const invalid = () =>
      Response.json({ error: "Invalid session fork reference.", ok: false }, { status: 400 });
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      !("sessionId" in value) ||
      typeof value.sessionId !== "string" ||
      !value.sessionId.length ||
      value.sessionId.length > 256
    )
      return invalid();
    if ("beforeMessageId" in value) {
      if (
        typeof value.beforeMessageId !== "string" ||
        !/^seed_message_(0|[1-9][0-9]{0,3})$/.test(value.beforeMessageId) ||
        Object.keys(value).some((key) => key !== "sessionId" && key !== "beforeMessageId")
      )
        return invalid();
      fork = { sessionId: value.sessionId, beforeMessageId: value.beforeMessageId };
    } else {
      if (
        !("beforeTurnId" in value) ||
        typeof value.beforeTurnId !== "string" ||
        value.beforeTurnId.length > 64 ||
        !/^turn_(0|[1-9][0-9]*)$/.test(value.beforeTurnId) ||
        Object.keys(value).some(
          (key) => key !== "sessionId" && key !== "beforeTurnId" && key !== "checkpointId",
        )
      )
        return invalid();
      const checkpointId = "checkpointId" in value ? value.checkpointId : undefined;
      if (
        checkpointId !== undefined &&
        (typeof checkpointId !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(checkpointId))
      )
        return invalid();
      fork = {
        sessionId: value.sessionId,
        beforeTurnId: value.beforeTurnId,
        checkpointId,
      };
    }
  }

  const result: ParsedCreateBody = {
    fork,
    activityObserver,
    callback,
    capabilities,
    mode,
    context,
    outputSchema,
  };
  if (message !== undefined) result.message = message;
  if (messageMetadata !== undefined) result.messageMetadata = messageMetadata;
  if (typeof rawOperationId === "string") result.operationId = rawOperationId;
  return result;
}

interface ParsedSessionMessageBody {
  activityObserver?: ActivityObserverConfig;
  callback?: SessionCallback;
  message?: string | UserContent;
  messageMetadata?: JsonObject;
  inputResponses?: readonly ValidatedInputResponse[];
  context?: readonly string[];
  outputSchema?: JsonObject;
  turnPolicy?: TurnPolicy;
}

export function parseSessionMessageBody(
  payload: Record<string, unknown>,
): ParsedSessionMessageBody | Response {
  const tokenRejection = rejectSessionContinuationToken(payload);
  if (tokenRejection !== null) return tokenRejection;

  const message = parseMessageField(payload.message);
  if (message instanceof Response) return message;
  const messageMetadata = parseMessageMetadataField(payload.messageMetadata);
  if (messageMetadata instanceof Response) return messageMetadata;
  if (messageMetadata !== undefined && message === undefined) {
    return Response.json(
      { error: "'messageMetadata' requires a message.", ok: false },
      { status: 400 },
    );
  }
  const callback = parseCallbackField(payload.callback);
  if (callback instanceof Response) return callback;
  const activityObserver = parseActivityObserverField(payload.activityObserver);
  if (activityObserver instanceof Response) return activityObserver;
  if (activityObserver !== undefined) {
    const observerRejection = validateActivityObserverBinding(activityObserver, callback);
    if (observerRejection !== undefined) return observerRejection;
  }
  const inputResponses = parseInputResponses(payload.inputResponses);
  if (inputResponses instanceof Response) return inputResponses;
  const context = parseClientContextField(payload.clientContext);
  if (context instanceof Response) return context;
  const outputSchema = parseOutputSchemaField(payload.outputSchema);
  if (outputSchema instanceof Response) return outputSchema;
  const turnPolicy = parseTurnPolicyField(payload.turnPolicy);
  if (turnPolicy instanceof Response) return turnPolicy;

  if (message === undefined && inputResponses === undefined) {
    return Response.json(
      {
        error: "Expected a non-empty 'message' or a non-empty 'inputResponses' array.",
        ok: false,
      },
      { status: 400 },
    );
  }

  if (message !== undefined && inputResponses !== undefined) {
    return Response.json(
      { error: "'message' and 'inputResponses' are mutually exclusive.", ok: false },
      { status: 400 },
    );
  }

  return {
    activityObserver,
    callback,
    message,
    messageMetadata,
    inputResponses,
    context,
    outputSchema,
    turnPolicy,
  };
}

interface ParsedCancelTurnBody {
  taskId?: string;
  tasks?: boolean;
  turnId?: string;
}

export async function parseCancelTurnBody(req: Request): Promise<ParsedCancelTurnBody | Response> {
  const payload = await parseOptionalJsonRequest(req);
  if (payload instanceof Response) return payload;
  const tokenRejection = rejectSessionContinuationToken(payload);
  if (tokenRejection !== null) return tokenRejection;

  const turnId = payload.turnId;
  const taskId = payload.taskId;
  const tasks = payload.tasks;
  if (turnId !== undefined && (typeof turnId !== "string" || turnId.length === 0)) {
    return Response.json(
      { error: "Expected 'turnId' to be a non-empty string.", ok: false },
      { status: 400 },
    );
  }
  if (tasks !== undefined && typeof tasks !== "boolean") {
    return Response.json(
      { error: "Expected 'tasks' to be a boolean.", ok: false },
      { status: 400 },
    );
  }
  if (taskId !== undefined && (typeof taskId !== "string" || taskId.length === 0)) {
    return Response.json(
      { error: "Expected 'taskId' to be a non-empty string.", ok: false },
      { status: 400 },
    );
  }
  const result: ParsedCancelTurnBody = {};
  if (typeof taskId === "string") result.taskId = taskId;
  if (typeof tasks === "boolean") result.tasks = tasks;
  if (typeof turnId === "string") result.turnId = turnId;
  return result;
}

export async function parseJsonRequest(req: Request): Promise<Record<string, unknown> | Response> {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body.", ok: false }, { status: 400 });
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return Response.json({ error: "Expected a JSON object.", ok: false }, { status: 400 });
  }
  return payload as Record<string, unknown>;
}

export async function parseResetBody(
  req: Request,
): Promise<{ readonly reason?: string } | Response> {
  const payload = await parseOptionalJsonRequest(req);
  if (payload instanceof Response) return payload;
  const tokenRejection = rejectSessionContinuationToken(payload);
  if (tokenRejection !== null) return tokenRejection;
  const reason = payload.reason;
  if (reason !== undefined && (typeof reason !== "string" || reason.length === 0)) {
    return Response.json(
      { error: "Expected 'reason' to be a non-empty string.", ok: false },
      { status: 400 },
    );
  }
  return reason === undefined ? {} : { reason };
}

export async function parseSessionControlBody(
  req: Request,
): Promise<Record<string, unknown> | Response> {
  const payload = await parseOptionalJsonRequest(req);
  if (payload instanceof Response) return payload;
  return rejectSessionContinuationToken(payload) ?? payload;
}

export async function parseOptionalJsonRequest(
  req: Request,
): Promise<Record<string, unknown> | Response> {
  let text: string;
  try {
    text = await req.text();
  } catch {
    return Response.json({ error: "Unreadable request body.", ok: false }, { status: 400 });
  }
  if (text.trim().length === 0) return {};

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return Response.json({ error: "Invalid JSON body.", ok: false }, { status: 400 });
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return Response.json({ error: "Expected a JSON object.", ok: false }, { status: 400 });
  }
  return payload as Record<string, unknown>;
}

export function rejectSessionContinuationToken(payload: Record<string, unknown>): Response | null {
  return "continuationToken" in payload
    ? Response.json(
        { error: "Session-ID routes do not accept 'continuationToken'.", ok: false },
        { status: 400 },
      )
    : null;
}

export function requireSessionId(params: Readonly<Record<string, string>>): string | Response {
  const sessionId = params.sessionId;
  return sessionId || Response.json({ error: "Missing session id.", ok: false }, { status: 400 });
}

function parseMessageMetadataField(value: unknown): JsonObject | Response | undefined {
  if (value === undefined) return undefined;
  try {
    return parseJsonObject(value);
  } catch {
    return Response.json(
      { error: "Expected 'messageMetadata' to be a JSON-serializable object.", ok: false },
      { status: 400 },
    );
  }
}

function parseOutputSchemaField(value: unknown): JsonObject | Response | undefined {
  if (value === undefined) return undefined;

  try {
    return parseJsonObject(value);
  } catch {
    return Response.json(
      { error: "Expected 'outputSchema' to be a JSON-serializable object.", ok: false },
      { status: 400 },
    );
  }
}

function parseCallbackField(value: unknown): SessionCallback | Response | undefined {
  if (value === undefined) return undefined;
  const parsed = parseSessionCallback(value);
  if (parsed.ok) return parsed.callback;

  return Response.json({ error: parsed.message, ok: false }, { status: 400 });
}

function parseCapabilitiesField(value: unknown): SessionCapabilities | Response | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return Response.json(
      { error: "Expected 'capabilities' to be an object.", ok: false },
      { status: 400 },
    );
  }

  const keys = Object.keys(value);
  const requestInput = Reflect.get(value, "requestInput");
  if (
    keys.some((key) => key !== "requestInput") ||
    (requestInput !== undefined && typeof requestInput !== "boolean")
  ) {
    return Response.json(
      { error: "Expected 'capabilities.requestInput' to be a boolean when provided.", ok: false },
      { status: 400 },
    );
  }

  return requestInput === undefined ? {} : { requestInput };
}

function parseModeField(value: unknown): RunMode | Response | undefined {
  if (value === undefined) return undefined;
  if (value === "conversation" || value === "task") return value;
  return Response.json(
    { error: "Expected 'mode' to be either 'conversation' or 'task'.", ok: false },
    { status: 400 },
  );
}

function parseTurnPolicyField(value: unknown): TurnPolicy | Response | undefined {
  if (value === undefined) return undefined;
  if (value === "queue" || value === "steer") return value;
  return Response.json(
    { error: "Expected 'turnPolicy' to be either 'queue' or 'steer'.", ok: false },
    { status: 400 },
  );
}

function parseMessageField(value: unknown): string | UserContent | undefined | Response {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value.length > 0 ? value : undefined;

  if (!Array.isArray(value)) {
    return Response.json(
      { error: "Expected 'message' to be a string or an array of text/file parts.", ok: false },
      { status: 400 },
    );
  }

  if (value.length === 0) return undefined;

  const parts: Array<TextPart | FilePart> = [];
  for (const raw of value) {
    const parsed = parseMessagePart(raw);
    if (parsed instanceof Response) return parsed;
    parts.push(parsed);
  }
  return parts;
}

function parseMessagePart(raw: unknown): TextPart | FilePart | Response {
  if (raw === null || typeof raw !== "object") {
    return Response.json(
      { error: "Expected each message part to be an object.", ok: false },
      { status: 400 },
    );
  }

  const part = raw as Record<string, unknown>;
  if (part.type === "text") {
    if (typeof part.text !== "string" || part.text.length === 0) {
      return Response.json(
        { error: "Text parts require a non-empty 'text' string.", ok: false },
        { status: 400 },
      );
    }
    return { type: "text", text: part.text };
  }

  if (part.type === "file") {
    if (typeof part.mediaType !== "string" || part.mediaType.length === 0) {
      return Response.json(
        { error: "File parts require a non-empty 'mediaType' string.", ok: false },
        { status: 400 },
      );
    }
    if (typeof part.data !== "string") {
      return Response.json(
        { error: "File parts require a 'data' string (base64, data URL, or URL).", ok: false },
        { status: 400 },
      );
    }
    // Callers must never supply framework-internal refs (`eve-url:`,
    // `eve-sandbox:`, `eve-attachment:`): the staging pipeline trusts the
    // scheme and would reconstitute the string into a privileged sandbox read.
    if (hasInternalRefScheme(part.data)) {
      return Response.json(
        { error: "File part 'data' must not use a framework-internal ref scheme.", ok: false },
        { status: 400 },
      );
    }
    const filePart: FilePart = { type: "file", mediaType: part.mediaType, data: part.data };
    if (typeof part.filename === "string" && part.filename.length > 0) {
      filePart.filename = part.filename;
    }
    return filePart;
  }

  return Response.json(
    {
      error: `Unsupported message part type "${String(part.type)}". Use 'text' or 'file'.`,
      ok: false,
    },
    { status: 400 },
  );
}

export function checkUploadPolicy(
  body: ParsedCreateBody | ParsedSessionMessageBody,
  policy: UploadPolicy,
): Response | null {
  if (!body.message) return null;
  const violations = collectUploadPolicyViolations(body.message, policy);
  if (violations.length === 0) return null;

  const [first] = violations;
  if (!first) return null;

  const status = first.kind === "too-large" ? 413 : 415;
  return Response.json(
    {
      error: formatUploadPolicyViolation(first),
      ok: false,
      violations: violations.map((v) =>
        v.kind === "too-large"
          ? {
              byteLength: v.byteLength,
              filename: v.filename,
              kind: v.kind,
              limit: v.limit,
              mediaType: v.mediaType,
            }
          : {
              allowedMediaTypes: v.allowedMediaTypes,
              filename: v.filename,
              kind: v.kind,
              mediaType: v.mediaType,
            },
      ),
    },
    { status },
  );
}

function parseInputResponses(
  value: unknown,
): readonly ValidatedInputResponse[] | Response | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    return Response.json(
      { error: "Expected 'inputResponses' to be a non-empty array.", ok: false },
      { status: 400 },
    );
  }
  const inputResponses = value.filter(isInputResponse);
  if (inputResponses.length !== value.length) {
    return Response.json(
      {
        error: "Expected every 'inputResponses' entry to match the HITL response schema.",
        ok: false,
      },
      { status: 400 },
    );
  }
  return inputResponses;
}

const CLIENT_CONTEXT_PREFIX = "Client context:\n";

function parseClientContextField(value: unknown): string[] | Response | undefined {
  if (value === undefined) return undefined;

  if (typeof value === "string") {
    return value.length > 0 ? [toClientContextMessage(value)] : undefined;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return undefined;

    if (!value.every((entry) => typeof entry === "string" && entry.length > 0)) {
      return Response.json(
        { error: "Expected 'clientContext' array entries to be non-empty strings.", ok: false },
        { status: 400 },
      );
    }

    return value.map((entry) => toClientContextMessage(entry));
  }

  if (value === null || typeof value !== "object") {
    return Response.json(
      {
        error: "Expected 'clientContext' to be a string, string array, or JSON object.",
        ok: false,
      },
      { status: 400 },
    );
  }

  try {
    const json = parseJsonObject(value);
    return [toClientContextMessage(JSON.stringify(json))];
  } catch {
    return Response.json(
      { error: "Expected 'clientContext' to be a JSON-serializable object.", ok: false },
      { status: 400 },
    );
  }
}

function toClientContextMessage(content: string): string {
  return `${CLIENT_CONTEXT_PREFIX}${content}`;
}
