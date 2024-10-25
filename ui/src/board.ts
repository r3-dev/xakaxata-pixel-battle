export const enum PixelColor {
  White = 0,
  Green = 1,
  Yellow = 2,
  Red = 3,
  Orange = 4,
  Purple = 5,
  Blue = 6,
  Teal = 7,
  Pink = 8,
  Black = 9,
}

export const PIXEL_COLORS = Object.freeze({
  [PixelColor.White]: "#FFFFFF",
  [PixelColor.Green]: "#74B63E",
  [PixelColor.Yellow]: "#FFCE33",
  [PixelColor.Red]: "#CC421D",
  [PixelColor.Orange]: "#FF8533",
  [PixelColor.Purple]: "#87308C",
  [PixelColor.Blue]: "#1D70A2",
  [PixelColor.Teal]: "#079D9D",
  [PixelColor.Pink]: "#F05689",
  [PixelColor.Black]: "#000000",
});

const clamp = (value: number, min: number, max: number) => {
  return Math.min(Math.max(value, min), max);
};

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Pixel {
  i: number;
  j: number;
  index: number;
}

class BoardCursor {
  static readonly KEY = "board-cursor";

  public x = 0;
  public y = 0;
  public pressed = false;
  public dragging = false;

  private drawTimeoutId: number | null = null;

  private constructor(
    public currentColor: PixelColor,
    public hoveredPixel: Pixel | null,
  ) {}

  static create(): BoardCursor {
    return new BoardCursor(PixelColor.White, null);
  }

  static load(): BoardCursor | null {
    const cursor = localStorage.getItem(BoardCursor.KEY);
    if (!cursor) return null;
    const [currentColor] = JSON.parse(cursor);
    return new BoardCursor(currentColor, null);
  }

  save() {
    localStorage.setItem(BoardCursor.KEY, JSON.stringify([this.currentColor]));
  }

  canDraw() {
    return this.drawTimeoutId === null;
  }

  setDrawTimeout(seconds: number) {
    if (this.drawTimeoutId) {
      clearTimeout(this.drawTimeoutId);
      this.drawTimeoutId = null;
    }
    if (seconds !== 0) {
      this.drawTimeoutId = setTimeout(() => {
        this.drawTimeoutId = null;
      }, seconds * 1000);
    }
  }
}

class BoardPosition {
  static readonly KEY = "board-position";

  private constructor(
    public zoomFactor: number,
    public offsetX: number,
    public offsetY: number,
  ) {}

  static create(): BoardPosition {
    return BoardPosition.load() || new BoardPosition(1, 0, 0);
  }

  static load(): BoardPosition | null {
    const position = localStorage.getItem(BoardPosition.KEY);
    if (!position) return null;
    const [zoomFactor, offsetX, offsetY] = JSON.parse(position);
    return new BoardPosition(zoomFactor, offsetX, offsetY);
  }

  save() {
    localStorage.setItem(
      BoardPosition.KEY,
      JSON.stringify([this.zoomFactor, this.offsetX, this.offsetY]),
    );
  }
}

export class BoardState {
  static readonly KEY = "board";
  static readonly CHUNK_SIZE = 256;

  private constructor(
    public readonly width: number,
    public readonly height: number,
    public pixels: Uint8Array,
  ) {}

  static create(buffer: Uint8Array): BoardState {
    const [width, height] = Array.from(
      buffer.slice(0, 2),
    ).map((x) => x * BoardState.CHUNK_SIZE);
    const pixels = buffer.slice(2);
    return new BoardState(width, height, pixels);
  }

  static load(): BoardState | null {
    const base64 = localStorage.getItem(BoardState.KEY);
    if (!base64) return null;
    const buffer = new TextEncoder().encode(atob(base64));
    return BoardState.create(buffer);
  }

  save() {
    const buffer = new Uint8Array(2 + this.pixels.length);
    buffer[0] = this.width / BoardState.CHUNK_SIZE;
    buffer[1] = this.height / BoardState.CHUNK_SIZE;
    buffer.set(this.pixels, 2);
    const base64 = btoa(new TextDecoder().decode(buffer));
    localStorage.setItem(BoardState.KEY, base64);
  }

  getPixelChunk(pixelIndex: number): number {
    return Math.floor(pixelIndex / BoardState.CHUNK_SIZE);
  }

  getPixelChunkIndex(pixelIndex: number): number {
    return pixelIndex - this.getPixelChunk(pixelIndex) * BoardState.CHUNK_SIZE;
  }

  migrate(migrations: Uint8Array) {
    for (let i = 0; i < migrations.length; i += 3) {
      const [chunk, chunkIndex, colorIndex] = migrations.slice(i, i + 3);
      const pixelIndex = chunk * BoardState.CHUNK_SIZE + chunkIndex;
      this.pixels[pixelIndex] = colorIndex;
    }
  }
}

export class Board {
  public readonly MIN_ZOOM_FACTOR = 0.2;
  public readonly MAX_ZOOM_FACTOR = 16;
  public readonly ZOOM_SPEED = 0.01;

  public pixelSize = 6;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ctx: CanvasRenderingContext2D,
    public readonly cursor: BoardCursor,
    public readonly pos: BoardPosition,
    public state: BoardState | null,
  ) {}

  static create(canvas: HTMLCanvasElement): Board {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas context not found");
    }
    ctx.imageSmoothingEnabled = false;
    canvas.style.imageRendering = "pixelated";
    return new Board(
      canvas,
      ctx,
      BoardCursor.load() || BoardCursor.create(),
      BoardPosition.create(),
      BoardState.load(),
    );
  }

  save() {
    if (this.state) {
      this.state.save();
    }
    this.pos.save();
    this.cursor.save();
  }

  resize(width: number, height: number, pixelRatio: number) {
    this.canvas.width = width * pixelRatio;
    this.canvas.height = height * pixelRatio;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  setPixelColor(pixelIndex: number, color: PixelColor) {
    if (!this.state) return;
    this.state.pixels[pixelIndex] = color;
  }

  setCenterOffset() {
    if (!this.state) return;
    this.pos.offsetX = (this.canvas.width / 2) -
      (this.state.width * this.pixelSize * this.pos.zoomFactor / 2);
    this.pos.offsetY = (this.canvas.height / 2) -
      (this.state.height * this.pixelSize * this.pos.zoomFactor / 2);
  }

  getPixel(clientX: number, clientY: number): Pixel | null {
    if (!this.state) return null;
    if (
      clientX < this.pos.offsetX ||
      clientX >
        this.pos.offsetX +
          this.state.width * this.pixelSize * this.pos.zoomFactor ||
      clientY < this.pos.offsetY ||
      clientY >
        this.pos.offsetY +
          this.state.height * this.pixelSize * this.pos.zoomFactor
    ) {
      return null;
    }

    const i = Math.floor(
      (clientX - this.pos.offsetX) / (this.pixelSize * this.pos.zoomFactor),
    );
    const j = Math.floor(
      (clientY - this.pos.offsetY) / (this.pixelSize * this.pos.zoomFactor),
    );
    const index = j * this.state.width + i;

    return {
      i: i,
      j: j,
      index,
    };
  }

  getViewport(): Rect {
    if (!this.state) {
      throw new Error("Board state not set");
    }
    const pixelSize = this.pixelSize * this.pos.zoomFactor;

    const viewportXStart = -this.pos.offsetX / pixelSize;
    const viewportYStart = -this.pos.offsetY / pixelSize;
    const viewportXEnd = viewportXStart + this.canvas.width / pixelSize;
    const viewportYEnd = viewportYStart + this.canvas.height / pixelSize;

    return {
      x0: Math.max(0, Math.floor(viewportXStart)),
      y0: Math.max(0, Math.floor(viewportYStart)),
      x1: Math.min(this.state.width, Math.ceil(viewportXEnd)),
      y1: Math.min(this.state.height, Math.ceil(viewportYEnd)),
    };
  }

  drawCursor(pixel: Pixel) {
    const pixelSize = this.pixelSize * this.pos.zoomFactor;
    const xPos = pixel.i * pixelSize + this.pos.offsetX;
    const yPos = pixel.j * pixelSize + this.pos.offsetY;

    this.ctx.strokeStyle = "#000";
    this.ctx.lineWidth = 2 * window.devicePixelRatio;
    this.ctx.strokeRect(xPos, yPos, pixelSize, pixelSize);
  }

  drawGrid(viewport: Rect) {
    const pixelSize = this.pixelSize * this.pos.zoomFactor;
    this.ctx.strokeStyle = "rgb(0,0,0,0.1)";
    this.ctx.lineWidth = 1 * window.devicePixelRatio;

    for (let x = viewport.x0; x <= viewport.x1; x++) {
      const xPos = x * pixelSize + this.pos.offsetX;
      this.ctx.beginPath();
      this.ctx.moveTo(xPos, this.pos.offsetY + viewport.y0 * pixelSize);
      this.ctx.lineTo(xPos, this.pos.offsetY + viewport.y1 * pixelSize);
      this.ctx.stroke();
    }

    for (let y = viewport.y0; y <= viewport.y1; y++) {
      const yPos = y * pixelSize + this.pos.offsetY;
      this.ctx.beginPath();
      this.ctx.moveTo(this.pos.offsetX + viewport.x0 * pixelSize, yPos);
      this.ctx.lineTo(this.pos.offsetX + viewport.x1 * pixelSize, yPos);
      this.ctx.stroke();
    }
  }

  zoom(clientX: number, clientY: number, deltaY: number) {
    const previousPixelSize = this.pixelSize * this.pos.zoomFactor;
    this.pos.zoomFactor = clamp(
      this.pos.zoomFactor *
        (1 + clamp(-deltaY, -25, 25) * this.ZOOM_SPEED),
      this.MIN_ZOOM_FACTOR,
      this.MAX_ZOOM_FACTOR,
    );

    const newPixelSize = this.pixelSize * this.pos.zoomFactor;
    this.pos.offsetX =
      (this.pos.offsetX - clientX) * (newPixelSize / previousPixelSize) +
      clientX;
    this.pos.offsetY =
      (this.pos.offsetY - clientY) * (newPixelSize / previousPixelSize) +
      clientY;
  }

  drawBoard(viewport: Rect) {
    if (!this.state) return;

    const pixelSize = this.pixelSize * this.pos.zoomFactor;

    this.ctx.fillStyle = "#282828";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = "#FFF";
    this.ctx.fillRect(
      this.pos.offsetX,
      this.pos.offsetY,
      this.state.width * pixelSize,
      this.state.height * pixelSize,
    );

    for (let y = viewport.y0; y < viewport.y1; y++) {
      for (let x = viewport.x0; x < viewport.x1; x++) {
        const i = y * this.state.width + x;
        const color = this.state.pixels[i];
        if (color === PixelColor.White) continue;

        this.ctx.fillStyle = PIXEL_COLORS[color as PixelColor];
        this.ctx.fillRect(
          x * pixelSize + this.pos.offsetX,
          y * pixelSize + this.pos.offsetY,
          pixelSize,
          pixelSize,
        );
      }
    }
  }
}
