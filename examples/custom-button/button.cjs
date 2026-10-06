// Custom UI button scenario in JS: the same toolbar flow as the Rust
// example, driven through the real wasm-pack `nodejs` artifact.
//
// Run after `bun run build:wasm:node`:  node examples/custom-button/button.mjs
const { JsEngine } = require("../../pkg/node/nary.js");

const engine = new JsEngine();
const batch = (ops) => JSON.parse(engine.apply_batch(JSON.stringify(ops)));

// 1. Custom "Rectangle" button.
const clicked = batch([{ op: "setTool", tool: "rectangle" }]);
console.assert(clicked.results[0].data.accepted === true, "tool accepted");
console.log("rectangle button accepted");

// 2. Pointer gesture commits one rectangle; toolbar state polled.
const drawn = batch([
  { op: "pointerDown", x: 10, y: 10, button: "left" },
  { op: "pointerMove", x: 110, y: 60 },
  { op: "pointerUp", x: 110, y: 60, button: "left" },
  { op: "sessionState" },
]);
const state = drawn.results[3].data;
console.assert(engine.element_count() === 1, "one element drawn");
console.log(`drawn: selection=${JSON.stringify(state.selection)} canUndo=${state.canUndo}`);

// 3. Custom "Delete" button + undo.
batch([{ op: "deleteSelected" }]);
console.assert(engine.element_count() === 0, "deleted");
batch([{ op: "undo" }]);
console.assert(engine.element_count() === 1, "undone");
console.log("delete + undo round-trip ok");

// 4. One crossing renders the frame hosts paint.
const frame = batch([{ op: "renderModel", canvasWidth: 800, canvasHeight: 600 }]);
console.assert(frame.results[0].data.base.length === 1, "one draw entry");
console.log("renderModel carries 1 entry — custom UI scenario complete");
