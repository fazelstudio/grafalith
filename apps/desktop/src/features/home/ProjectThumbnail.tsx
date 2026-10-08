import { useEffect, useRef } from 'react';
import { getProjectStore } from '../../platform/projects/projectService';
import { themeTokens } from '../../app/theme/tokens';

const PREVIEW_WIDTH = 320;
const PREVIEW_HEIGHT = 148;
const PREVIEW_PADDING = 18;
const { fallbackFill: FALLBACK_FILL, placeholderStroke: FALLBACK_STROKE } =
  themeTokens.light.canvasOverlay;

interface SceneElement {
  type?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  opacity?: number;
  strokeColor?: string;
  backgroundColor?: { type?: string; color?: string };
  text?: string;
  fontSize?: number;
  points?: [number, number][];
  isDeleted?: boolean;
}

interface SceneBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readElements(sceneJson: string): SceneElement[] {
  const parsed: unknown = JSON.parse(sceneJson);
  if (typeof parsed !== 'object' || parsed === null) return [];
  const elements = (parsed as { elements?: unknown }).elements;
  if (!Array.isArray(elements)) return [];
  return elements.filter(
    (element): element is SceneElement =>
      typeof element === 'object' && element !== null && !(element as SceneElement).isDeleted,
  );
}

function elementBounds(element: SceneElement): SceneBounds {
  const x = finite(element.x);
  const y = finite(element.y);
  const width = Math.max(0, finite(element.width));
  const height = Math.max(0, finite(element.height));
  const rotation = finite(element.rotation);
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const points = element.points ?? [];
  const bounds: SceneBounds = {
    minX: x,
    minY: y,
    maxX: x + width,
    maxY: y + height,
  };
  for (const corner of [
    [x, y],
    [x + width, y],
    [x + width, y + height],
    [x, y + height],
  ]) {
    const [cornerX, cornerY] = corner;
    const dx = cornerX - centerX;
    const dy = cornerY - centerY;
    const rotatedX = centerX + dx * Math.cos(rotation) - dy * Math.sin(rotation);
    const rotatedY = centerY + dx * Math.sin(rotation) + dy * Math.cos(rotation);
    bounds.minX = Math.min(bounds.minX, rotatedX);
    bounds.minY = Math.min(bounds.minY, rotatedY);
    bounds.maxX = Math.max(bounds.maxX, rotatedX);
    bounds.maxY = Math.max(bounds.maxY, rotatedY);
  }
  for (const point of points) {
    const px = x + finite(point[0]);
    const py = y + finite(point[1]);
    bounds.minX = Math.min(bounds.minX, px);
    bounds.minY = Math.min(bounds.minY, py);
    bounds.maxX = Math.max(bounds.maxX, px);
    bounds.maxY = Math.max(bounds.maxY, py);
  }
  return bounds;
}

function sceneBounds(elements: SceneElement[]): SceneBounds | null {
  if (elements.length === 0) return null;
  return elements.reduce((total, element) => {
    const bounds = elementBounds(element);
    return {
      minX: Math.min(total.minX, bounds.minX),
      minY: Math.min(total.minY, bounds.minY),
      maxX: Math.max(total.maxX, bounds.maxX),
      maxY: Math.max(total.maxY, bounds.maxY),
    };
  }, elementBounds(elements[0]));
}

function colorFor(element: SceneElement, fallback: string): string {
  const color = element.backgroundColor?.color;
  return color && color !== 'transparent' ? color : fallback;
}

function drawElement(
  context: CanvasRenderingContext2D,
  element: SceneElement,
  scale: number,
  bounds: SceneBounds,
): void {
  const x = finite(element.x);
  const y = finite(element.y);
  const width = Math.max(0, finite(element.width));
  const height = Math.max(0, finite(element.height));
  const px = (x - bounds.minX) * scale + PREVIEW_PADDING;
  const py = (y - bounds.minY) * scale + PREVIEW_PADDING;
  const pw = width * scale;
  const ph = height * scale;
  const rotation = finite(element.rotation);
  const opacity = Math.max(0, Math.min(1, finite(element.opacity, 100) / 100));
  context.save();
  context.globalAlpha = opacity;
  context.translate(px + pw / 2, py + ph / 2);
  context.rotate(rotation);
  context.translate(-pw / 2, -ph / 2);
  context.fillStyle = colorFor(element, FALLBACK_FILL);
  context.strokeStyle = element.strokeColor ?? FALLBACK_STROKE;
  context.lineWidth = Math.max(1, 1.5 * Math.min(1, scale));
  context.lineJoin = 'round';
  context.lineCap = 'round';

  if (element.type === 'ellipse') {
    context.beginPath();
    context.ellipse(pw / 2, ph / 2, Math.max(1, pw / 2), Math.max(1, ph / 2), 0, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  } else if (element.type === 'line' || element.type === 'arrow' || element.type === 'freedraw') {
    const points = element.points ?? [];
    if (points.length > 0) {
      context.beginPath();
      points.forEach(([pointX, pointY], index) => {
        const localX = (finite(pointX) + x - bounds.minX) * scale + PREVIEW_PADDING - px;
        const localY = (finite(pointY) + y - bounds.minY) * scale + PREVIEW_PADDING - py;
        if (index === 0) context.moveTo(localX, localY);
        else context.lineTo(localX, localY);
      });
      context.stroke();
    }
  } else if (element.type === 'text') {
    context.fillStyle = element.strokeColor ?? FALLBACK_STROKE;
    context.font = `${Math.max(8, finite(element.fontSize, 16) * scale)}px sans-serif`;
    context.textBaseline = 'top';
    context.fillText((element.text ?? '').slice(0, 80), 0, 0, Math.max(pw, 80));
  } else {
    context.beginPath();
    context.rect(0, 0, pw, ph);
    context.fill();
    context.stroke();
  }
  context.restore();
}

function drawScene(canvas: HTMLCanvasElement, sceneJson: string): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = PREVIEW_WIDTH * dpr;
  canvas.height = PREVIEW_HEIGHT * dpr;
  canvas.style.aspectRatio = `${PREVIEW_WIDTH} / ${PREVIEW_HEIGHT}`;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  const elements = readElements(sceneJson);
  const bounds = sceneBounds(elements);
  if (!bounds) return;
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.min(
    (PREVIEW_WIDTH - PREVIEW_PADDING * 2) / width,
    (PREVIEW_HEIGHT - PREVIEW_PADDING * 2) / height,
  );
  for (const element of elements) drawElement(context, element, scale, bounds);
}

export function ProjectThumbnail({ projectId, label }: { projectId: string; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    void getProjectStore()
      .preview(projectId)
      .then(({ sceneJson }) => {
        if (!cancelled && canvasRef.current) {
          try {
            drawScene(canvasRef.current, sceneJson);
          } catch {
            canvasRef.current.getContext('2d')?.clearRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
          }
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <canvas
      ref={canvasRef}
      className="project-card__thumbnail"
      width={PREVIEW_WIDTH}
      height={PREVIEW_HEIGHT}
      aria-label={label}
    />
  );
}
