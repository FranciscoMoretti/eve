import {
  readSessionCheckpoint,
  SessionCheckpointNotFoundError,
} from "#execution/read-session-checkpoint.js";
export async function handleCheckpointReadiness(
  request: Request,
  sessionId: string,
): Promise<Response> {
  const query = new URL(request.url).searchParams;
  const beforeTurnId = query.get("beforeTurnId");
  if (query.size !== 1 || !beforeTurnId || !/^turn_(0|[1-9][0-9]*)$/.test(beforeTurnId))
    return Response.json({ error: "Invalid checkpoint reference." }, { status: 400 });
  try {
    await readSessionCheckpoint({ sessionId, beforeTurnId });
    return Response.json(
      { ready: true, sessionId, beforeTurnId },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof SessionCheckpointNotFoundError)
      return Response.json(
        { code: "checkpoint_not_ready" },
        { status: 404, headers: { "cache-control": "no-store" } },
      );
    return Response.json(
      { error: "Checkpoint lookup is unavailable." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
