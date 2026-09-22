import { readSessionSandboxIdentity } from "#execution/read-session-sandbox-identity.js";

/** The channel must authorize the session before calling this internal evidence endpoint. */
export async function handleSandboxIdentityRead(
  request: Request,
  sessionId: string,
): Promise<Response> {
  const headers = { "cache-control": "no-store" };
  if (new URL(request.url).search) {
    return Response.json({ error: "Invalid sandbox identity request." }, { status: 400, headers });
  }
  try {
    const local = await readSessionSandboxIdentity(sessionId);
    return Response.json({ version: 1, snapshotVersion: 2, sessionId, local }, { headers });
  } catch {
    return Response.json(
      { error: "Sandbox identity evidence is unavailable." },
      { status: 503, headers },
    );
  }
}
