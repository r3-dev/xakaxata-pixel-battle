import { Board, BoardState, PixelColor } from "./board";
import {
  createDrawPixelMessage,
  handleWebSocketMessage,
  SocketMessage,
  type SocketMessageHandlers,
} from "./socket";
import { ActivePixelCoords, OnlineUsers, Palette } from "./ui";

const canvas = document.createElement("canvas");
canvas.className = "relative overflow-hidden touch-none";
document.body.appendChild(canvas);

const board = Board.create(canvas);

let usersCount = 1;
let onlineUsers = OnlineUsers(usersCount);
document.body.appendChild(onlineUsers);
const activePixelCoords = ActivePixelCoords(0, 0);
document.body.appendChild(activePixelCoords);

const setActiveColor = (color: PixelColor) => {
  board.cursor.currentColor = color;
  const newPalette = Palette({ activeColor: color, setActiveColor });
  palette.replaceWith(newPalette);
  palette = newPalette;
};
let palette = Palette({
  activeColor: board.cursor.currentColor,
  setActiveColor,
});
document.body.appendChild(palette);

const socketHandlers: SocketMessageHandlers = {
  [SocketMessage.State]: (message) => {
    const newState = BoardState.create(new Uint8Array(message));
    const needToCenterOffset = board.state === null;
    board.state = newState;
    if (needToCenterOffset) {
      board.setCenterOffset();
    }
  },
  [SocketMessage.StateMigration]: (message) => {
    if (board.state) {
      board.state.migrate(new Uint8Array(message));
    }
  },
  [SocketMessage.StatePlayer]: (message) => {
    const [seconds] = new Uint8Array(message);
    board.cursor.setDrawTimeout(seconds);
  },
  [SocketMessage.StatePlayers]: (message) => {
    const [count] = new Uint16Array(message);
    if (count === usersCount) return;
    usersCount = count;
    const newOnlineUsers = OnlineUsers(usersCount);
    onlineUsers.replaceWith(newOnlineUsers);
    onlineUsers = newOnlineUsers;
  },
};

const ws = new WebSocket(
  (location.protocol === "https:" ? "wss://" : "ws://") +
    location.host + "/ws",
);
ws.binaryType = "arraybuffer";
ws.onmessage = (event) => handleWebSocketMessage(event, socketHandlers);

document.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    board.zoom(
      event.clientX * window.devicePixelRatio,
      event.clientY * window.devicePixelRatio,
      event.deltaY,
    );
  },
  { passive: false },
);

board.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio);
window.addEventListener("resize", () => {
  board.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio);
});

canvas.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  board.cursor.pressed = true;
  board.cursor.x = event.clientX * window.devicePixelRatio;
  board.cursor.y = event.clientY * window.devicePixelRatio;
}, { passive: false });

canvas.addEventListener("pointermove", (event) => {
  event.preventDefault();
  const clientX = event.clientX * window.devicePixelRatio;
  const clientY = event.clientY * window.devicePixelRatio;

  if (!board.cursor.pressed) {
    const pixel = board.getPixel(clientX, clientY);
    if (
      pixel && (board.cursor.hoveredPixel === null ||
        board.cursor.hoveredPixel.index !== pixel.index)
    ) {
      activePixelCoords.textContent = `${pixel.i + 1}:${pixel.j + 1}`;
    }
    board.cursor.hoveredPixel = pixel;

    board.cursor.x = clientX;
    board.cursor.y = clientY;
    return;
  }

  document.body.style.cursor = "grabbing";

  board.pos.offsetX += clientX - board.cursor.x;
  board.pos.offsetY += clientY - board.cursor.y;

  board.cursor.hoveredPixel = null;
  board.cursor.dragging = true;
  board.cursor.x = clientX;
  board.cursor.y = clientY;
}, { passive: false });

function resetCursorState() {
  document.body.style.cursor = "default";
  board.cursor.hoveredPixel = null;
  board.cursor.pressed = false;
  board.cursor.dragging = false;
}

canvas.addEventListener("pointerleave", resetCursorState);
canvas.addEventListener("pointerup", (event) => {
  event.preventDefault();
  if (
    board.cursor.dragging || !board.cursor.canDraw() || board.state === null
  ) {
    resetCursorState();
    return;
  }

  const clientX = event.clientX * window.devicePixelRatio;
  const clientY = event.clientY * window.devicePixelRatio;
  const pixel = board.getPixel(clientX, clientY);
  if (!pixel) return;

  board.state.pixels[pixel.index] = board.cursor.currentColor;
  ws.send(createDrawPixelMessage(
    board.state.getPixelChunk(pixel.index),
    board.state.getPixelChunkIndex(pixel.index),
    board.cursor.currentColor,
  ));

  resetCursorState();
}, { passive: false });

window.addEventListener("beforeunload", () => board.save());

const render = () => {
  const viewport = board.getViewport();
  board.drawBoard(viewport);
  if (board.pos.zoomFactor > 3) {
    board.drawGrid(viewport);
  }
  if (board.cursor.hoveredPixel && board.cursor.canDraw()) {
    board.drawCursor(board.cursor.hoveredPixel);
  }
  requestAnimationFrame(render);
};
requestAnimationFrame(render);
