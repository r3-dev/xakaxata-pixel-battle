export const enum SocketMessage {
  State = 0,
  StateMigration = 1,
  StatePlayer = 2,
  StatePlayers = 3,
}

const SOCKET_MESSAGES = Object.freeze([
  SocketMessage.State,
  SocketMessage.StateMigration,
  SocketMessage.StatePlayer,
  SocketMessage.StatePlayers,
]);

export type SocketMessageHandlers = Record<
  SocketMessage,
  (message: ArrayBuffer) => void
>;

export function handleWebSocketMessage(
  event: MessageEvent<ArrayBuffer>,
  handlers: SocketMessageHandlers,
) {
  const type: SocketMessage | undefined =
    SOCKET_MESSAGES[new Uint8Array(event.data.slice(0, 1))[0]];
  if (type === undefined) {
    console.warn("Unknown message type", type);
    return;
  }

  const data = event.data.slice(1);
  try {
    handlers[type as SocketMessage](data);
  } catch (error) {
    console.error("Error handling message", error);
  }
}
