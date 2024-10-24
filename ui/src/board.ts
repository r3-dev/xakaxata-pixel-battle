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
  public pressed = false;
  public dragging = false;
  public x = 0;
  public y = 0;

  private drawTimeoutId: number | null = null;

  private constructor(
    public focusedPixel: Pixel | null,
    public currentColor: PixelColor,
  ) {}

  static create(): BoardCursor {
    return new BoardCursor(null, PixelColor.White);
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

class BoardState {
  constructor(
    public width: number,
    public height: number,
    public pixels: Uint8Array,
  ) {}
}

export class Board {
  public readonly MIN_ZOOM_FACTOR = 0.2;
  public readonly MAX_ZOOM_FACTOR = 16;
  public readonly ZOOM_DAMPING_FACTOR = 0.12;
  public readonly ZOOM_SPEED = 0.01;

  public state: BoardState | null = null;

  public pixelSize = 6;
  public zoomFactor = 1;
  public offsetX = 0;
  public offsetY = 0;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ctx: CanvasRenderingContext2D,
    public readonly cursor: BoardCursor,
  ) {}

  static create(canvas: HTMLCanvasElement): Board {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas context not found");
    }
    ctx.imageSmoothingEnabled = false;
    canvas.style.imageRendering = "pixelated";
    return new Board(canvas, ctx, BoardCursor.create());
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

  setState(width: number, height: number, pixels: Uint8Array) {
    this.state = new BoardState(width, height, pixels);
  }

  setCenterOffset() {
    if (!this.state) return;
    this.offsetX = (this.canvas.width / 2) -
      (this.state.width * this.pixelSize * this.zoomFactor / 2);
    this.offsetY = (this.canvas.height / 2) -
      (this.state.height * this.pixelSize * this.zoomFactor / 2);
  }

  getPixel(x: number, y: number): Pixel | null {
    if (!this.state) return null;
    if (
      x < this.offsetX ||
      x > this.offsetX + this.state.width * this.pixelSize * this.zoomFactor ||
      y < this.offsetY ||
      y > this.offsetY + this.state.height * this.pixelSize * this.zoomFactor
    ) {
      return null;
    }

    const i = Math.floor(
      (x - this.offsetX) / (this.pixelSize * this.zoomFactor),
    );
    const j = Math.floor(
      (y - this.offsetY) / (this.pixelSize * this.zoomFactor),
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
    const pixelSize = this.pixelSize * this.zoomFactor;

    const viewportXStart = -this.offsetX / pixelSize;
    const viewportYStart = -this.offsetY / pixelSize;
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
    const pixelSize = this.pixelSize * this.zoomFactor;
    const xPos = pixel.i * pixelSize + this.offsetX;
    const yPos = pixel.j * pixelSize + this.offsetY;

    this.ctx.strokeStyle = "#000";
    this.ctx.lineWidth = 2 * window.devicePixelRatio;
    this.ctx.strokeRect(xPos, yPos, pixelSize, pixelSize);
  }

  drawGrid(viewport: Rect) {
    const pixelSize = this.pixelSize * this.zoomFactor;
    this.ctx.strokeStyle = "rgb(0,0,0,0.1)";
    this.ctx.lineWidth = 1 * window.devicePixelRatio;

    for (let x = viewport.x0; x <= viewport.x1; x++) {
      const xPos = x * pixelSize + this.offsetX;
      this.ctx.beginPath();
      this.ctx.moveTo(xPos, this.offsetY + viewport.y0 * pixelSize);
      this.ctx.lineTo(xPos, this.offsetY + viewport.y1 * pixelSize);
      this.ctx.stroke();
    }

    for (let y = viewport.y0; y <= viewport.y1; y++) {
      const yPos = y * pixelSize + this.offsetY;
      this.ctx.beginPath();
      this.ctx.moveTo(this.offsetX + viewport.x0 * pixelSize, yPos);
      this.ctx.lineTo(this.offsetX + viewport.x1 * pixelSize, yPos);
      this.ctx.stroke();
    }
  }

  zoom(clientX: number, clientY: number, deltaY: number) {
    const previousPixelSize = this.pixelSize * this.zoomFactor;

    const zoomChange = 1 + clamp(-deltaY, -25, 25) * this.ZOOM_SPEED;
    let newZoomFactor = this.zoomFactor * zoomChange;
    if (newZoomFactor < this.MIN_ZOOM_FACTOR) {
      newZoomFactor = this.MIN_ZOOM_FACTOR +
        (newZoomFactor - this.MIN_ZOOM_FACTOR) * this.ZOOM_DAMPING_FACTOR;
    } else if (newZoomFactor > this.MAX_ZOOM_FACTOR) {
      newZoomFactor = this.MAX_ZOOM_FACTOR +
        (newZoomFactor - this.MAX_ZOOM_FACTOR) * this.ZOOM_DAMPING_FACTOR;
    }
    this.zoomFactor = newZoomFactor;

    const newPixelSize = this.pixelSize * this.zoomFactor;
    this.offsetX =
      (this.offsetX - clientX) * (newPixelSize / previousPixelSize) + clientX;
    this.offsetY =
      (this.offsetY - clientY) * (newPixelSize / previousPixelSize) + clientY;
  }

  render() {
    if (!this.state) return;

    const viewport = this.getViewport();
    const pixelSize = this.pixelSize * this.zoomFactor;

    this.ctx.fillStyle = "#282828";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = "#FFF";
    this.ctx.fillRect(
      this.offsetX,
      this.offsetY,
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
          x * pixelSize + this.offsetX,
          y * pixelSize + this.offsetY,
          pixelSize,
          pixelSize,
        );
      }
    }

    if (this.zoomFactor > 3) {
      this.drawGrid(viewport);
    }
    if (this.cursor.focusedPixel && this.cursor.canDraw()) {
      this.drawCursor(this.cursor.focusedPixel);
    }
  }
}
