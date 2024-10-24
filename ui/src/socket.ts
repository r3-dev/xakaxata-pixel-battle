export const CHUNK_SIZE = 256;

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

export class SocketManager {
  private constructor(
    public ws: WebSocket,
    private handlers: SocketMessageHandlers,
  ) {}

  static create(url: string, handlers: SocketMessageHandlers): SocketManager {
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    return new SocketManager(ws, handlers);
  }

  handleMessage(event: MessageEvent<ArrayBuffer>) {
    const type: SocketMessage | undefined =
      SOCKET_MESSAGES[new Uint8Array(event.data.slice(0, 1))[0]];
    if (type === undefined) {
      console.warn("Unknown message type", type);
      return;
    }

    const data = event.data.slice(1);
    try {
      this.handlers[type as SocketMessage](data);
    } catch (error) {
      console.error("Error handling message", error);
    }
  }

  sendDrawPixelMessage(pixelIndex: number, color: number) {
    const chunk = Math.floor(pixelIndex / CHUNK_SIZE);
    this.ws.send(
      new Uint8Array([
        SocketMessage.StateMigration,
        chunk,
        pixelIndex - chunk * CHUNK_SIZE,
        color,
      ]),
    );
  }
}
