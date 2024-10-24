import { PIXEL_COLORS } from "./board";

interface PaletteProps {
  activeColor: number;
  setActiveColor: (colorIndex: number) => void;
}

export const Palette = (props: PaletteProps): HTMLElement => {
  const paletteContainer = document.createElement("div");
  paletteContainer.className =
    "flex fixed bottom-2 flex justify-center z-20 w-full px-2 pointer-events-none";
  const paletteElement = document.createElement("div");
  paletteElement.className =
    "flex rounded-xl bg-white shadow-md border border-black/10 p-2 gap-1 overflow-x-auto pointer-events-auto";

  for (const [index, color] of Object.entries(PIXEL_COLORS)) {
    const colorIndex = parseInt(index);
    const colorButton = document.createElement("button");
    colorButton.className =
      "w-8 h-8 shrink-0 rounded-lg border border-black/15 hover:opacity-90 opacity-50 data-[active]:opacity-100 data-[active]:border-black/25 data-[active]:border-2 data-[active]:hover:opacity-100";
    colorButton.style.backgroundColor = color;
    if (colorIndex === props.activeColor) {
      colorButton.setAttribute("data-active", "");
    }
    colorButton.addEventListener("click", () => {
      props.setActiveColor(colorIndex);
    });
    paletteElement.appendChild(colorButton);
  }

  paletteContainer.appendChild(paletteElement);
  return paletteContainer;
};

const UserIcon = (): SVGSVGElement => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("fill", "currentColor");
  path.setAttribute(
    "d",
    "M12 12q-1.65 0-2.82-1.17T8 8t1.18-2.82T12 4t2.83 1.18T16 8t-1.17 2.83T12 12m-8 6v-.8q0-.85.44-1.56t1.16-1.09q1.55-.77 3.15-1.16T12 13t3.25.39 3.15 1.16q.73.38 1.16 1.09T20 17.2v.8q0 .83-.59 1.41T18 20H6q-.82 0-1.41-.59T4 18",
  );
  svg.appendChild(path);
  return svg;
};

export const OnlineUsers = (count: number): HTMLElement => {
  const container = document.createElement("div");
  container.className =
    "flex fixed top-2 right-2 rounded bg-white shadow-md border border-black/10 px-1.5 gap-1 z-20 flex items-center";

  const userIcon = UserIcon();
  userIcon.classList.add("w-4", "h-4", "text-zinc-500");
  container.appendChild(userIcon);

  const text = document.createElement("span");
  text.className = "text-xs font-medium leading-6";
  text.textContent = count.toString();
  container.appendChild(text);

  return container;
};

export const ActivePixelCoords = (x: number, y: number): HTMLElement => {
  const span = document.createElement("span");
  span.className =
    "rounded text-xs font-medium bg-white fixed left-2 top-2 px-1.5 h-6 shadow-md leading-6 border-black/10 border z-20";
  span.textContent = `${x}:${y}`;
  return span;
};
