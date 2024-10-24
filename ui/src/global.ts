const SOCKET_MESSAGES = Object.freeze(
  [
    "STATE",
    "STATE_MIGRATION",
    "STATE_PLAYER",
    "STATE_PLAYERS",
  ] as const,
);
type SocketMessage = (typeof SOCKET_MESSAGES)[number];

const BOARD_CHUNK_SIZE = 256;

let timeoutId: ReturnType<typeof setTimeout> | null = null;

const SockerHandlers: Record<
  SocketMessage,
  (data: ArrayBuffer) => Promise<void> | void
> = {
  STATE: (data) => {
    const [width, height] = new Uint8Array(data.slice(0, 2));
    const pixels = new Uint8Array(data.slice(2));

    board.setState(width * BOARD_CHUNK_SIZE, height * BOARD_CHUNK_SIZE, pixels);
  },
  STATE_MIGRATION: (data) => {
    const migrations = new Uint8Array(data);
    for (let i = 0; i < migrations.length; i += 3) {
      const [chunk, chunkIndex, colorId] = migrations.slice(i, i + 3);
      const index = chunk * BOARD_CHUNK_SIZE + chunkIndex;
      board.setPixelColor(index, colorId);
    }
  },
  STATE_PLAYER: (data) => {
    const [seconds] = new Uint8Array(data);
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    if (seconds !== 0) {
      board.canDraw = false;
      timeoutId = setTimeout(() => {
        board.canDraw = true;
      }, seconds * 1000);
    }
  },
  STATE_PLAYERS: (data) => {
    const [usersCount] = new Uint8Array(data);
    console.log(usersCount);
  },
};

const createWebSockerURI = () => {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return protocol + "//" + location.host + location.pathname + "ws";
};

const ws = new WebSocket(createWebSockerURI());

ws.onmessage = async (event: MessageEvent<Blob>) => {
  const message = await event.data.arrayBuffer();
  const type: SocketMessage | undefined =
    SOCKET_MESSAGES[new Uint8Array(message.slice(0, 1))[0]];
  if (!type) {
    console.warn("Unknown message type");
    return;
  }

  const data = message.slice(1);
  try {
    return await SockerHandlers[type as SocketMessage](data);
  } catch (error) {
    console.error("Error handling message", error);
  }
};

const COLOR_MAP = Object.freeze([
  "#FFFFFF", // white
  "#74B63E", // green
  "#FFCE33", // yellow
  "#CC421D", // red
  "#FF8533", // orange
  "#87308C", // purple
  "#1D70A2", // blue
  "#079D9D", // teal
  "#F05689", // pink
  "#000000", // black
]);

interface ViewportRect {
  xStart: number;
  yStart: number;
  xEnd: number;
  yEnd: number;
}

interface Pixel {
  i: number;
  j: number;
  index: number;
}

class Board {
  private pixels: Uint8Array | null = null;
  private width: number | null = null;
  private height: number | null = null;

  public pixelSize = 8;
  public zoomFactor = 1;
  public offsetX = 0;
  public offsetY = 0;

  public activePixel: Pixel | null = null;
  public currentColor = 2;
  public canDraw = true;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ctx: CanvasRenderingContext2D,
  ) {}

  static create(canvas: HTMLCanvasElement): Board {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas context not found");
    }
    ctx.imageSmoothingEnabled = false;
    return new Board(canvas, ctx);
  }

  resize(width: number, height: number, pixelRatio: number) {
    this.canvas.width = width * pixelRatio;
    this.canvas.height = height * pixelRatio;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  setPixelColor(pixelIndex: number, color: number) {
    if (!this.pixels) return;
    this.pixels[pixelIndex] = color;
  }

  setState(width: number, height: number, pixels: Uint8Array) {
    this.width = width;
    this.height = height;
    this.pixels = pixels;
  }

  setOffset(x: number, y: number) {
    this.offsetX = x;
    this.offsetY = y;
  }

  getPixel(x: number, y: number): Pixel | null {
    if (!this.width || !this.height) {
      return null;
    }
    if (
      x < this.offsetX ||
      x > this.offsetX + this.width * this.pixelSize * this.zoomFactor ||
      y < this.offsetY ||
      y > this.offsetY + this.height * this.pixelSize * this.zoomFactor
    ) {
      return null;
    }

    const i = Math.floor(
      (x - this.offsetX) / (this.pixelSize * this.zoomFactor),
    );
    const j = Math.floor(
      (y - this.offsetY) / (this.pixelSize * this.zoomFactor),
    );
    const index = j * this.width + i;

    return {
      i: i,
      j: j,
      index,
    };
  }

  getViewport(): ViewportRect {
    if (!this.width || !this.height) {
      throw new Error("Board dimensions not set");
    }
    const pixelSize = this.pixelSize * this.zoomFactor;

    const viewportXStart = -this.offsetX / pixelSize;
    const viewportYStart = -this.offsetY / pixelSize;
    const viewportXEnd = viewportXStart + this.canvas.width / pixelSize;
    const viewportYEnd = viewportYStart + this.canvas.height / pixelSize;

    const xStart = Math.max(0, Math.floor(viewportXStart));
    const yStart = Math.max(0, Math.floor(viewportYStart));
    const xEnd = Math.min(this.width, Math.ceil(viewportXEnd));
    const yEnd = Math.min(this.height, Math.ceil(viewportYEnd));

    return { xStart, yStart, xEnd, yEnd };
  }

  drawCursor(pixel: Pixel) {
    if (!this.canDraw) return;
    const pixelSize = this.pixelSize * this.zoomFactor;
    const xPos = pixel.i * pixelSize + this.offsetX;
    const yPos = pixel.j * pixelSize + this.offsetY;

    this.ctx.strokeStyle = "#000";
    this.ctx.lineWidth = 2 * window.devicePixelRatio;
    this.ctx.strokeRect(xPos, yPos, pixelSize, pixelSize);
  }

  drawGrid(viewport: ViewportRect) {
    const pixelSize = this.pixelSize * this.zoomFactor;
    this.ctx.strokeStyle = "#e0e0e0";
    this.ctx.lineWidth = 0.8 * window.devicePixelRatio;
    const { xStart, yStart, xEnd, yEnd } = viewport;

    for (let x = xStart; x <= xEnd; x++) {
      const xPos = x * pixelSize + this.offsetX;
      this.ctx.beginPath();
      this.ctx.moveTo(xPos, this.offsetY + yStart * pixelSize);
      this.ctx.lineTo(xPos, this.offsetY + yEnd * pixelSize);
      this.ctx.stroke();
    }

    for (let y = yStart; y <= yEnd; y++) {
      const yPos = y * pixelSize + this.offsetY;
      this.ctx.beginPath();
      this.ctx.moveTo(this.offsetX + xStart * pixelSize, yPos);
      this.ctx.lineTo(this.offsetX + xEnd * pixelSize, yPos);
      this.ctx.stroke();
    }
  }

  render() {
    if (!this.pixels || !this.width || !this.height) {
      return;
    }

    const viewport = this.getViewport();
    const pixelSize = this.pixelSize * this.zoomFactor;

    this.ctx.fillStyle = "#282828";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = "#FFF";
    this.ctx.fillRect(
      this.offsetX,
      this.offsetY,
      this.width * pixelSize,
      this.height * pixelSize,
    );

    for (let y = viewport.yStart; y < viewport.yEnd; y++) {
      for (let x = viewport.xStart; x < viewport.xEnd; x++) {
        const i = y * this.width + x;
        const color = this.pixels[i];
        if (color === 0) continue;

        const xPos = x * pixelSize + this.offsetX;
        const yPos = y * pixelSize + this.offsetY;

        this.ctx.fillStyle = COLOR_MAP[color];
        this.ctx.fillRect(xPos, yPos, pixelSize, pixelSize);
      }
    }

    if (this.zoomFactor > 3) {
      this.drawGrid(viewport);
    }
    if (this.activePixel) {
      this.drawCursor(this.activePixel);
    }
  }
}

const canvas = document.getElementById("board") as HTMLCanvasElement;
const board = Board.create(canvas);

board.offsetX = (window.innerWidth / 2) * window.devicePixelRatio;
board.offsetY = (window.innerHeight / 2) * window.devicePixelRatio;

const MIN_ZOOM_FACTOR = 0.2;
const MAX_ZOOM_FACTOR = 16;
const ZOOM_DAMPING_FACTOR = 0.12;
const ZOOM_SPEED = 0.01;

const zoom = (clientX: number, clientY: number, deltaY: number) => {
  const previousPixelSize = board.pixelSize * board.zoomFactor;

  const zoomChange = 1 + -deltaY * ZOOM_SPEED;
  let newZoomFactor = board.zoomFactor * zoomChange;
  if (newZoomFactor < MIN_ZOOM_FACTOR) {
    newZoomFactor = MIN_ZOOM_FACTOR +
      (newZoomFactor - MIN_ZOOM_FACTOR) * ZOOM_DAMPING_FACTOR;
  } else if (newZoomFactor > MAX_ZOOM_FACTOR) {
    newZoomFactor = MAX_ZOOM_FACTOR +
      (newZoomFactor - MAX_ZOOM_FACTOR) * ZOOM_DAMPING_FACTOR;
  }
  board.zoomFactor = newZoomFactor;

  const newPixelSize = board.pixelSize * board.zoomFactor;
  board.offsetX =
    (board.offsetX - clientX) * (newPixelSize / previousPixelSize) + clientX;
  board.offsetY =
    (board.offsetY - clientY) * (newPixelSize / previousPixelSize) + clientY;
};

canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    zoom(
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

let isPoinerDown = false;
let isDragging = false;
let pointerDownX = 0;
let pointerDownY = 0;

window.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  isPoinerDown = true;
  pointerDownX = event.clientX * window.devicePixelRatio;
  pointerDownY = event.clientY * window.devicePixelRatio;
});

window.addEventListener("pointermove", (event) => {
  event.preventDefault();
  const clientX = event.clientX * window.devicePixelRatio;
  const clientY = event.clientY * window.devicePixelRatio;

  if (isPoinerDown) {
    document.body.style.cursor = "grabbing";
    board.activePixel = null;
    isDragging = true;

    board.offsetX = board.offsetX + (clientX - pointerDownX);
    board.offsetY = board.offsetY + (clientY - pointerDownY);

    pointerDownX = clientX;
    pointerDownY = clientY;
    return;
  }

  board.activePixel = board.getPixel(clientX, clientY);
}, { passive: false });

window.addEventListener("pointerleave", () => {
  board.activePixel = null;
  isPoinerDown = false;
  isDragging = false;
});

window.addEventListener("pointerup", (event) => {
  event.preventDefault();
  document.body.style.cursor = "default";
  if (isDragging || !board.canDraw) {
    isPoinerDown = false;
    isDragging = false;
    return;
  }

  const clientX = event.clientX * window.devicePixelRatio;
  const clientY = event.clientY * window.devicePixelRatio;
  const pixel = board.getPixel(clientX, clientY);
  if (!pixel) return;

  board.setPixelColor(pixel.index, board.currentColor);
  const chunk = Math.floor(pixel.index / BOARD_CHUNK_SIZE);
  ws.send(
    new Uint8Array([
      SOCKET_MESSAGES.indexOf("STATE_MIGRATION"),
      chunk,
      pixel.index - chunk * BOARD_CHUNK_SIZE,
      board.currentColor,
    ]),
  );

  isPoinerDown = false;
  isDragging = false;
});

const render = () => {
  board.render();
  requestAnimationFrame(render);
};
requestAnimationFrame(render);
