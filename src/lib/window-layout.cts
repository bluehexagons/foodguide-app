import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Rectangle } from 'electron';

export interface WindowLayout {
  bounds: Rectangle;
  maximized: boolean;
  zoomFactor: number;
}

export const defaultSize = { width: 1000, height: 600 };

export function fitWindow(bounds: Rectangle, area: Rectangle): Rectangle {
  const width = Math.min(bounds.width, area.width);
  const height = Math.min(bounds.height, area.height);
  return {
    x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)),
    width,
    height,
  };
}

export function centerWindow(size: Pick<Rectangle, 'width' | 'height'>, area: Rectangle) {
  return fitWindow(
    {
      x: area.x + Math.round((area.width - size.width) / 2),
      y: area.y + Math.round((area.height - size.height) / 2),
      ...size,
    },
    area,
  );
}

export function readWindowLayout(file: string): WindowLayout | undefined {
  try {
    const layout = JSON.parse(readFileSync(file, 'utf8')) as Partial<WindowLayout>;
    const bounds = layout?.bounds;
    const zoom = layout?.zoomFactor;
    if (
      bounds &&
      [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isSafeInteger) &&
      bounds.width > 0 &&
      bounds.height > 0 &&
      typeof layout.maximized === 'boolean' &&
      typeof zoom === 'number' &&
      zoom >= 0.25 &&
      zoom <= 5
    ) {
      return { bounds, maximized: layout.maximized, zoomFactor: zoom };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('Unable to read the desktop window layout:', error);
    }
  }
  return undefined;
}

export function saveWindowLayout(file: string, layout: WindowLayout) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const temporaryFile = `${file}.tmp`;
    writeFileSync(temporaryFile, JSON.stringify(layout));
    renameSync(temporaryFile, file);
  } catch (error) {
    console.warn('Unable to save the desktop window layout:', error);
  }
}
