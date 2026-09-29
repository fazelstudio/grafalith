/**
 * Benchmark: Snap-to-Object Performance
 *
 * Tests snapping performance on 5,000 elements to verify no FPS drops.
 * Uses SpatialGrid for candidate filtering (NOT linear scan).
 * Run with: bun run src/interaction/snap-benchmark.ts
 */
import { Scene, createRectangle } from '../scene';
import { findSnapToObject, applySnap, defaultSnapConfig } from './snap';
import type { SnapConfig } from './snap';
import type { Element } from '../scene';

const ELEMENT_COUNT = 5000;
const WORLD_SIZE = 10000;
const ITERATIONS = 100;
const DRAG_STEPS = 60; // simulating 60fps drag for 1 second

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function p99(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.99)];
}

// ── Setup ──────────────────────────────────────────────────────────────────
console.log(`\n=== Snap-to-Object Benchmark ===`);
console.log(`Elements: ${ELEMENT_COUNT}`);
console.log(`World size: ${WORLD_SIZE}x${WORLD_SIZE}`);
console.log(`Drag steps per iteration: ${DRAG_STEPS}`);
console.log(`Iterations: ${ITERATIONS}\n`);

const scene = new Scene();

// Create elements spread across the world
for (let i = 0; i < ELEMENT_COUNT; i++) {
  const x = Math.random() * WORLD_SIZE;
  const y = Math.random() * WORLD_SIZE;
  const w = 20 + Math.random() * 180;
  const h = 20 + Math.random() * 180;
  scene.upsertElement(createRectangle({
    id: `el-${i}`,
    x,
    y,
    width: w,
    height: h,
  }));
}

const allElements = scene.getAllElements();

// ── Benchmark 1: findSnapToObject with SpatialGrid ────────────────────────
console.log(`--- findSnapToObject (SpatialGrid) ---`);

const config: SnapConfig = { ...defaultSnapConfig, snapThreshold: 5 };
const timesWithGrid: number[] = [];

for (let iter = 0; iter < ITERATIONS; iter++) {
  // Simulate a moving element at random position
  const moveX = Math.random() * WORLD_SIZE;
  const moveY = Math.random() * WORLD_SIZE;
  const moveW = 50;
  const moveH = 50;
  const movingBounds = { minX: moveX, minY: moveY, maxX: moveX + moveW, maxY: moveY + moveH };

  // Use spatial grid to get candidates (the way the integration works)
  const threshold = config.snapThreshold;
  const searchBounds = {
    minX: moveX - threshold * 2,
    minY: moveY - threshold * 2,
    maxX: moveX + moveW + threshold * 2,
    maxY: moveY + moveH + threshold * 2,
  };

  const grid = scene.getSpatialGrid();
  const candidateIds = grid.queryBounds(searchBounds);
  const candidates: Element[] = [];
  for (const id of candidateIds) {
    const el = scene.getElement(id);
    if (el && !el.isDeleted) candidates.push(el);
  }

  const start = performance.now();
  findSnapToObject(movingBounds, candidates, config.snapThreshold, new Set());
  const elapsed = performance.now() - start;
  timesWithGrid.push(elapsed);
}

console.log(`SpatialGrid candidates:`);
console.log(`  Median: ${(median(timesWithGrid) * 1000).toFixed(3)} us`);
console.log(`  P99:    ${(p99(timesWithGrid) * 1000).toFixed(3)} us`);

// ── Benchmark 2: findSnapToObject with LINEAR SCAN (for comparison) ──────
console.log(`\n--- findSnapToObject (Linear Scan - WORST CASE) ---`);

const timesLinear: number[] = [];

for (let iter = 0; iter < ITERATIONS; iter++) {
  const moveX = Math.random() * WORLD_SIZE;
  const moveY = Math.random() * WORLD_SIZE;
  const moveW = 50;
  const moveH = 50;
  const movingBounds = { minX: moveX, minY: moveY, maxX: moveX + moveW, maxY: moveY + moveH };

  // Linear scan: pass ALL elements as candidates
  const start = performance.now();
  findSnapToObject(movingBounds, allElements, config.snapThreshold, new Set());
  const elapsed = performance.now() - start;
  timesLinear.push(elapsed);
}

console.log(`Linear scan (all ${ELEMENT_COUNT} elements):`);
console.log(`  Median: ${(median(timesLinear) * 1000).toFixed(3)} us`);
console.log(`  P99:    ${(p99(timesLinear) * 1000).toFixed(3)} us`);

// ── Benchmark 3: Simulated drag (60fps for 1 second) ────────────────────
console.log(`\n--- Simulated Drag (${DRAG_STEPS} frames) ---`);

const dragTimes: number[] = [];
for (let iter = 0; iter < ITERATIONS; iter++) {
  const startX = Math.random() * WORLD_SIZE;
  const startY = Math.random() * WORLD_SIZE;
  const moveW = 50;
  const moveH = 50;

  const start = performance.now();
  for (let step = 0; step < DRAG_STEPS; step++) {
    const moveX = startX + step * 2;
    const moveY = startY + step * 2;
    const movingBounds = { minX: moveX, minY: moveY, maxX: moveX + moveW, maxY: moveY + moveH };

    const threshold = config.snapThreshold;
    const searchBounds = {
      minX: moveX - threshold * 2,
      minY: moveY - threshold * 2,
      maxX: moveX + moveW + threshold * 2,
      maxY: moveY + moveH + threshold * 2,
    };

    const grid = scene.getSpatialGrid();
    const candidateIds = grid.queryBounds(searchBounds);
    const candidates: Element[] = [];
    for (const id of candidateIds) {
      const el = scene.getElement(id);
      if (el && !el.isDeleted) candidates.push(el);
    }

    applySnap(moveX, moveY, movingBounds, config, candidates, new Set());
  }
  const elapsed = performance.now() - start;
  dragTimes.push(elapsed);
}

const medianDrag = median(dragTimes);
const perFrame = medianDrag / DRAG_STEPS;
const fps60Budget = 16.67; // ms per frame at 60fps

console.log(`Median total: ${medianDrag.toFixed(3)} ms`);
console.log(`Per frame: ${perFrame.toFixed(3)} ms`);
console.log(`60fps budget: ${fps60Budget} ms`);
console.log(`Budget usage: ${((perFrame / fps60Budget) * 100).toFixed(1)}%`);

// ── Summary ───────────────────────────────────────────────────────────────
const gridSpeedup = median(timesLinear) / median(timesWithGrid);
console.log(`\n=== Summary ===`);
console.log(`SpatialGrid vs Linear scan speedup: ${gridSpeedup.toFixed(2)}x`);
if (perFrame < fps60Budget * 0.5) {
  console.log(`✓ Snap-to-object uses only ${((perFrame / fps60Budget) * 100).toFixed(1)}% of 60fps budget — no performance concern.`);
} else if (perFrame < fps60Budget) {
  console.log(`⚠ Snap-to-object uses ${((perFrame / fps60Budget) * 100).toFixed(1)}% of 60fps budget — acceptable but monitor.`);
} else {
  console.log(`✗ Snap-to-object EXCEEDS 60fps budget — performance issue!`);
}
