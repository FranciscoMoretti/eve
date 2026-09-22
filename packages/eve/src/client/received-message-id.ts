import type { EveAgentReducerEvent } from "#client/reducer.js";
type MessageReceivedEvent = Extract<EveAgentReducerEvent, { readonly type: "message.received" }>;

export function receivedMessageEventId(event: MessageReceivedEvent): string {
  const eventId: string | undefined = event.meta.id;
  return eventId ?? `${event.data.turnId}:${event.data.sequence}`;
}
