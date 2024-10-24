import { Board, PixelColor } from "./board";
import { CHUNK_SIZE, SocketManager, SocketMessage } from "./socket";
import { ActivePixelCoords, OnlineUsers, Palette } from "./ui";

class LocaleStorageValue<T> {
  constructor(private key: string, private defaultValue: T) {}

  get(): T {
    const value = localStorage.getItem(this.key);
    if (value === null) return this.defaultValue;
    return JSON.parse(value);
  }

  set(value: T) {
    localStorage.setItem(this.key, JSON.stringify(value));
  }
}

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
  activeColor: PixelColor.White,
  setActiveColor,
});
document.body.appendChild(palette);

const socket = SocketManager.create(
  (location.protocol === "https:" ? "wss://" : "ws://") +
    location.host + "/ws",
  {
    [SocketMessage.State]: (message) => {
      const [width, height] = Array.from(
        new Uint8Array(message.slice(0, 2)),
      ).map((x) => x * 256);
      const pixels = new Uint8Array(message.slice(2));

      const needToCenterOffset = board.state === null;
      board.setState(width, height, pixels);
      if (needToCenterOffset) {
        board.setCenterOffset();
      }
    },
    [SocketMessage.StateMigration]: (message) => {
      const migrations = new Uint8Array(message);
      for (let i = 0; i < migrations.length; i += 3) {
        const [chunk, chunkIndex, colorId] = migrations.slice(i, i + 3);
        const pixelIndex = chunk * CHUNK_SIZE + chunkIndex;
        board.setPixelColor(pixelIndex, colorId);
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
  },
);
socket.ws.onmessage = socket.handleMessage.bind(socket);

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
      pixel && (board.cursor.focusedPixel === null ||
        board.cursor.focusedPixel.index !== pixel.index)
    ) {
      activePixelCoords.textContent = `${pixel.i + 1}:${pixel.j + 1}`;
    }
    board.cursor.focusedPixel = pixel;

    board.cursor.x = clientX;
    board.cursor.y = clientY;
    return;
  }

  document.body.style.cursor = "grabbing";

  board.offsetX = board.offsetX + (clientX - board.cursor.x);
  board.offsetY = board.offsetY + (clientY - board.cursor.y);

  board.cursor.focusedPixel = null;
  board.cursor.dragging = true;
  board.cursor.x = clientX;
  board.cursor.y = clientY;
}, { passive: false });

canvas.addEventListener("pointerleave", () => {
  board.cursor.focusedPixel = null;
  board.cursor.pressed = false;
  board.cursor.dragging = false;
});

canvas.addEventListener("pointerup", (event) => {
  event.preventDefault();
  document.body.style.cursor = "default";

  if (board.cursor.dragging || !board.cursor.canDraw()) {
    board.cursor.pressed = false;
    board.cursor.dragging = false;
    return;
  }

  const clientX = event.clientX * window.devicePixelRatio;
  const clientY = event.clientY * window.devicePixelRatio;
  const pixel = board.getPixel(clientX, clientY);
  if (!pixel) return;

  board.setPixelColor(pixel.index, board.cursor.currentColor);
  socket.sendDrawPixelMessage(pixel.index, board.cursor.currentColor);

  board.cursor.pressed = false;
  board.cursor.dragging = false;
}, { passive: false });

const render = () => {
  board.render();
  requestAnimationFrame(render);
};
requestAnimationFrame(render);
