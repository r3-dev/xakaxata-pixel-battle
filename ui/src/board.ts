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

export const PIXEL_COLORS = new Map<PixelColor, [number, number, number]>([
	[PixelColor.White, [255, 255, 255]],
	[PixelColor.Green, [116, 182, 62]],
	[PixelColor.Yellow, [255, 206, 51]],
	[PixelColor.Red, [204, 66, 29]],
	[PixelColor.Orange, [255, 133, 51]],
	[PixelColor.Purple, [135, 48, 140]],
	[PixelColor.Blue, [29, 112, 162]],
	[PixelColor.Teal, [7, 157, 157]],
	[PixelColor.Pink, [240, 86, 137]],
	[PixelColor.Black, [0, 0, 0]],
]);

const getRGBHash = (r: number, g: number, b: number): number => {
	return (r << 16) | (g << 8) | b;
};

const COLOR_INDEX_BY_RGB_HASH = new Map<number, PixelColor>(
	PIXEL_COLORS.entries().map(([colorIndex, [r, g, b]]) => {
		return [getRGBHash(r, g, b), colorIndex];
	})
);

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
		public hoveredPixel: Pixel | null
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
		public offsetY: number
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
			JSON.stringify([this.zoomFactor, this.offsetX, this.offsetY])
		);
	}
}

export class BoardState {
	static readonly KEY = "board";
	static readonly CHUNK_SIZE = 256;

	public readonly width: number;
	public readonly height: number;
	public readonly imageData: ImageData;

	constructor(buffer: Uint8Array) {
		const data = new Uint8ClampedArray((buffer.length - 2) * 4);
		for (let i = 2, l = buffer.length; i < l; i++) {
			const colorIndex = buffer[i] as PixelColor;
			const [r, g, b] = PIXEL_COLORS.get(colorIndex)!;
			const j = (i - 2) * 4;
			data[j] = r;
			data[j + 1] = g;
			data[j + 2] = b;
			data[j + 3] = 255;
		}

		const [width, height] = Array.from(buffer.slice(0, 2)).map(
			(x) => x * BoardState.CHUNK_SIZE
		);
		this.width = width;
		this.height = height;
		this.imageData = new ImageData(data, width, height, {
			colorSpace: "srgb",
		});
	}

	static load(): BoardState | null {
		const base64 = localStorage.getItem(BoardState.KEY);
		if (!base64) return null;
		const buffer = new TextEncoder().encode(atob(base64));
		return new BoardState(buffer);
	}

	setPixelColor(pixelIndex: number, color: PixelColor) {
		const [r, g, b] = PIXEL_COLORS.get(color)!;
		const j = pixelIndex * 4;
		this.imageData.data[j] = r;
		this.imageData.data[j + 1] = g;
		this.imageData.data[j + 2] = b;
		this.imageData.data[j + 3] = 255;
	}

	save() {
		const buffer = new Uint8Array(this.width * this.height + 2);
		buffer[0] = this.width / BoardState.CHUNK_SIZE;
		buffer[1] = this.height / BoardState.CHUNK_SIZE;

		for (let i = 0, l = this.imageData.data.length; i < l; i += 4) {
			const r = this.imageData.data[i];
			const g = this.imageData.data[i + 1];
			const b = this.imageData.data[i + 2];
			const colorIndex = COLOR_INDEX_BY_RGB_HASH.get(getRGBHash(r, g, b))!;
			buffer[i / 4 + 2] = colorIndex as PixelColor;
		}

		const base64 = btoa(new TextDecoder().decode(buffer));
		localStorage.setItem(BoardState.KEY, base64);
	}

	getPixelPosition(pixelIndex: number): {
		x: number;
		y: number;
	} {
		return {
			x: pixelIndex % this.width,
			y: Math.floor(pixelIndex / this.width),
		};
	}
}

export class Board {
	public readonly MIN_ZOOM_FACTOR = 0.2;
	public readonly MAX_ZOOM_FACTOR = 16;
	public readonly ZOOM_SPEED = 0.01;
	public readonly BASE_PIXEL_SIZE = 6;

	private readonly canvas: HTMLCanvasElement;
	private readonly ctx: CanvasRenderingContext2D;
	public readonly cursor: BoardCursor;
	public readonly pos: BoardPosition;
	public state: BoardState | null;

	public pixelSize: number;

	constructor(canvas: HTMLCanvasElement) {
		const ctx = canvas.getContext("2d");
		if (!ctx) {
			throw new Error("Canvas context not found");
		}
		ctx.imageSmoothingEnabled = false;
		canvas.style.imageRendering = "pixelated";

		this.canvas = canvas;
		this.ctx = ctx;
		this.cursor = BoardCursor.load() || BoardCursor.create();
		this.pos = BoardPosition.create();
		this.state = BoardState.load();

		this.pixelSize = this.BASE_PIXEL_SIZE * this.pos.zoomFactor;
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
		this.state.imageData.data[pixelIndex] = color;
	}

	setCenterOffset() {
		if (!this.state) return;
		const boardWidth = this.state.imageData.width * this.pixelSize;
		const boardHeight = this.state.imageData.height * this.pixelSize;
		const canvasWidth = this.canvas.width / this.pos.zoomFactor;
		const canvasHeight = this.canvas.height / this.pos.zoomFactor;
		this.pos.offsetX = (canvasWidth - boardWidth) / 2;
		this.pos.offsetY = (canvasHeight - boardHeight) / 2;
	}

	getPixel(clientX: number, clientY: number): Pixel | null {
		if (!this.state) return null;

		const { offsetX, offsetY } = this.pos;
		const width = this.state.imageData.width;
		const height = this.state.imageData.height;

		if (
			clientX < offsetX ||
			clientX > offsetX + width * this.pixelSize ||
			clientY < offsetY ||
			clientY > offsetY + height * this.pixelSize
		) {
			return null;
		}

		const i = Math.floor((clientX - offsetX) / this.pixelSize);
		const j = Math.floor((clientY - offsetY) / this.pixelSize);
		const index = j * width + i;

		return { i, j, index };
	}

	getViewport(): Rect | null {
		if (!this.state) return null;

		const viewportXStart = -this.pos.offsetX / this.pixelSize;
		const viewportYStart = -this.pos.offsetY / this.pixelSize;
		const viewportXEnd = viewportXStart + this.canvas.width / this.pixelSize;
		const viewportYEnd = viewportYStart + this.canvas.height / this.pixelSize;

		const viewport: Rect = {
			x0: Math.max(0, Math.floor(viewportXStart)),
			y0: Math.max(0, Math.floor(viewportYStart)),
			x1: Math.min(this.state.imageData.width, Math.ceil(viewportXEnd)),
			y1: Math.min(this.state.imageData.height, Math.ceil(viewportYEnd)),
		};

		if (
			viewport.x0 >= this.state.width ||
			viewport.y0 >= this.state.height ||
			viewport.x1 <= 0 ||
			viewport.y1 <= 0
		) {
			return null;
		}

		return viewport;
	}

	drawCursor(pixel: Pixel) {
		const xPos = pixel.i * this.pixelSize + this.pos.offsetX;
		const yPos = pixel.j * this.pixelSize + this.pos.offsetY;

		this.ctx.strokeStyle = "#000";
		this.ctx.lineWidth = 2 * window.devicePixelRatio;
		this.ctx.strokeRect(xPos, yPos, this.pixelSize, this.pixelSize);
	}

	drawGrid(viewport: Rect) {
		this.ctx.strokeStyle = "rgb(0,0,0,0.1)";
		this.ctx.lineWidth = 1 * window.devicePixelRatio;

		for (let x = viewport.x0; x <= viewport.x1; x++) {
			const xPos = x * this.pixelSize + this.pos.offsetX;
			this.ctx.beginPath();
			this.ctx.moveTo(xPos, this.pos.offsetY + viewport.y0 * this.pixelSize);
			this.ctx.lineTo(xPos, this.pos.offsetY + viewport.y1 * this.pixelSize);
			this.ctx.stroke();
		}

		for (let y = viewport.y0; y <= viewport.y1; y++) {
			const yPos = y * this.pixelSize + this.pos.offsetY;
			this.ctx.beginPath();
			this.ctx.moveTo(this.pos.offsetX + viewport.x0 * this.pixelSize, yPos);
			this.ctx.lineTo(this.pos.offsetX + viewport.x1 * this.pixelSize, yPos);
			this.ctx.stroke();
		}
	}

	zoom(clientX: number, clientY: number, deltaY: number) {
		const previousZoomFactor = this.pos.zoomFactor;
		const zoomChange = clamp(-deltaY, -25, 25) * this.ZOOM_SPEED;
		this.pos.zoomFactor = clamp(
			this.pos.zoomFactor * (1 + zoomChange),
			this.MIN_ZOOM_FACTOR,
			this.MAX_ZOOM_FACTOR
		);

		if (this.pos.zoomFactor === previousZoomFactor) return;
		const scaleRatio = this.pos.zoomFactor / previousZoomFactor;
		this.pos.offsetX = (this.pos.offsetX - clientX) * scaleRatio + clientX;
		this.pos.offsetY = (this.pos.offsetY - clientY) * scaleRatio + clientY;
		this.pixelSize = this.BASE_PIXEL_SIZE * this.pos.zoomFactor;
	}

	drawBackground() {
		this.ctx.fillStyle = "#282828";
		this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
	}

	async drawBoard(viewport: Rect) {
		if (!this.state) return;

		this.ctx.imageSmoothingEnabled = false;
		this.ctx.drawImage(
			await createImageBitmap(
				this.state.imageData,
				viewport.x0,
				viewport.y0,
				viewport.x1 - viewport.x0,
				viewport.y1 - viewport.y0,
				{
					resizeQuality: "pixelated",
					colorSpaceConversion: "none",
				}
			),
			viewport.x0 * this.pixelSize + this.pos.offsetX,
			viewport.y0 * this.pixelSize + this.pos.offsetY,
			(viewport.x1 - viewport.x0) * this.pixelSize,
			(viewport.y1 - viewport.y0) * this.pixelSize
		);
	}
}
