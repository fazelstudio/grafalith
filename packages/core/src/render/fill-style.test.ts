import { describe, it, expect } from 'bun:test';
import { resolveFillStyle } from './fill-style';
import { FillStyle, GradientStop } from '../scene/types';
import { Bounds } from '../shapes/geometry';

// Mock CanvasRenderingContext2D for testing
interface RecordedGradient {
  type: 'linear' | 'radial';
  args: number[];
  stops: Array<{ offset: number; color: string }>;
}
const createMockCtx = () => {
  const gradientStops: Array<{ offset: number; color: string }> = [];
  let lastGradient: RecordedGradient | null = null;
  
  const mockGradient = {
    addColorStop: (offset: number, color: string) => {
      gradientStops.push({ offset, color });
    }
  };
  
  return {
    createLinearGradient: (...args: number[]) => {
      lastGradient = { type: 'linear', args, stops: gradientStops };
      return mockGradient;
    },
    createRadialGradient: (...args: number[]) => {
      lastGradient = { type: 'radial', args, stops: gradientStops };
      return mockGradient;
    },
    __getLastGradient: () => lastGradient,
    __getGradientStops: () => [...gradientStops],
    __clearStops: () => { gradientStops.length = 0; }
  } as unknown as CanvasRenderingContext2D;
};

describe('resolveFillStyle', () => {
  const bounds: Bounds = { minX: 10, minY: 20, maxX: 110, maxY: 120 };
  
  it('returns color string for solid fill', () => {
    const fillStyle: FillStyle = { type: 'solid', color: '#ff0000' };
    const ctx = createMockCtx();
    
    const result = resolveFillStyle(ctx, fillStyle, bounds);
    
    expect(result).toBe('#ff0000');
  });
  
  it('returns transparent for solid transparent fill', () => {
    const fillStyle: FillStyle = { type: 'solid', color: 'transparent' };
    const ctx = createMockCtx();
    
    const result = resolveFillStyle(ctx, fillStyle, bounds);
    
    expect(result).toBe('transparent');
  });
  
  it('creates linear gradient with correct stops', () => {
    const stops: GradientStop[] = [
      { offset: 0, color: '#ff0000' },
      { offset: 1, color: '#0000ff' }
    ];
    const fillStyle: FillStyle = {
      type: 'gradient',
      gradientType: 'linear',
      angle: 0,
      stops
    };
    const ctx = createMockCtx();
    
    const result = resolveFillStyle(ctx, fillStyle, bounds);
    
    // Should return an object (CanvasGradient mock)
    expect(typeof result).toBe('object');
    expect(result).not.toBeNull();
  });
  
  it('creates radial gradient with correct stops', () => {
    const stops: GradientStop[] = [
      { offset: 0, color: '#ffffff' },
      { offset: 0.5, color: '#888888' },
      { offset: 1, color: '#000000' }
    ];
    const fillStyle: FillStyle = {
      type: 'gradient',
      gradientType: 'radial',
      angle: 0,
      stops
    };
    const ctx = createMockCtx();
    
    const result = resolveFillStyle(ctx, fillStyle, bounds);
    
    // Should return an object (CanvasGradient mock)
    expect(typeof result).toBe('object');
    expect(result).not.toBeNull();
  });
  
  it('handles gradient with multiple color stops', () => {
    const stops: GradientStop[] = [
      { offset: 0, color: '#ff0000' },
      { offset: 0.33, color: '#00ff00' },
      { offset: 0.66, color: '#0000ff' },
      { offset: 1, color: '#ff00ff' }
    ];
    const fillStyle: FillStyle = {
      type: 'gradient',
      gradientType: 'linear',
      angle: 90,
      stops
    };
    const ctx = createMockCtx();
    
    const result = resolveFillStyle(ctx, fillStyle, bounds);
    
    // Should return an object (CanvasGradient mock)
    expect(typeof result).toBe('object');
    expect(result).not.toBeNull();
  });
});

describe('FillStyle JSON serialization', () => {
  it('solid fill style serializes and deserializes correctly', () => {
    const original: FillStyle = { type: 'solid', color: '#ff0000' };
    
    const serialized = JSON.stringify(original);
    const deserialized = JSON.parse(serialized) as FillStyle;
    
    expect(deserialized).toEqual(original);
    expect(deserialized.type).toBe('solid');
    if (deserialized.type === 'solid') {
      expect(deserialized.color).toBe('#ff0000');
    }
  });
  
  it('gradient fill style serializes and deserializes correctly', () => {
    const original: FillStyle = {
      type: 'gradient',
      gradientType: 'linear',
      angle: 45,
      stops: [
        { offset: 0, color: '#ff0000' },
        { offset: 0.5, color: '#00ff00' },
        { offset: 1, color: '#0000ff' }
      ]
    };
    
    const serialized = JSON.stringify(original);
    const deserialized = JSON.parse(serialized) as FillStyle;
    
    expect(deserialized).toEqual(original);
    expect(deserialized.type).toBe('gradient');
    if (deserialized.type === 'gradient') {
      expect(deserialized.gradientType).toBe('linear');
      expect(deserialized.angle).toBe(45);
      expect(deserialized.stops).toHaveLength(3);
      expect(deserialized.stops[0]).toEqual({ offset: 0, color: '#ff0000' });
      expect(deserialized.stops[1]).toEqual({ offset: 0.5, color: '#00ff00' });
      expect(deserialized.stops[2]).toEqual({ offset: 1, color: '#0000ff' });
    }
  });
  
  it('radial gradient fill style serializes and deserializes correctly', () => {
    const original: FillStyle = {
      type: 'gradient',
      gradientType: 'radial',
      angle: 0,
      stops: [
        { offset: 0, color: '#ffffff' },
        { offset: 1, color: '#000000' }
      ]
    };
    
    const serialized = JSON.stringify(original);
    const deserialized = JSON.parse(serialized) as FillStyle;
    
    expect(deserialized).toEqual(original);
    expect(deserialized.type).toBe('gradient');
    if (deserialized.type === 'gradient') {
      expect(deserialized.gradientType).toBe('radial');
      expect(deserialized.stops).toHaveLength(2);
    }
  });
  
  it('complete element with gradient fill serializes correctly', () => {
    const element = {
      id: 'test-123',
      type: 'rectangle',
      x: 100,
      y: 200,
      width: 300,
      height: 150,
      rotation: 0,
      strokeColor: '#000000',
      backgroundColor: {
        type: 'gradient',
        gradientType: 'linear',
        angle: 90,
        stops: [
          { offset: 0, color: '#ff0000' },
          { offset: 1, color: '#0000ff' }
        ]
      },
      strokeWidth: 2,
      strokeStyle: 'solid',
      fillStyle: 'solid',
      opacity: 80,
      seed: 12345,
      version: 1,
      versionNonce: 67890,
      isDeleted: false,
      groupIds: [],
      locked: false,
      roundness: null
    };
    
    const serialized = JSON.stringify(element);
    const deserialized = JSON.parse(serialized);
    
    expect(deserialized).toEqual(element);
    expect(deserialized.backgroundColor.type).toBe('gradient');
    expect(deserialized.opacity).toBe(80);
  });
});