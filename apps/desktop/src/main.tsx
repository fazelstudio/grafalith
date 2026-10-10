import React from "react";
import ReactDOM from "react-dom/client";
import { applyBootPreferences } from "./app/boot";
import "./app/theme/tokens.css";

applyBootPreferences();

/**
 * Phase 1 first: core services initialize before `App` (and its whole
 * static import graph) loads. A failure renders the fatal dialog instead
 * of the app — the window never proceeds half-broken.
 */
async function start(): Promise<void> {
  const { bootstrapCore, coreReady } = await import("./platform/boot/coreBootstrap");
  const checks = await bootstrapCore();
  if (!coreReady(checks)) {
    const { renderFatalBoot } = await import("./app/shell/FatalBootDialog");
    renderFatalBoot(checks.filter((service) => !service.ok));
    return;
  }
  const { default: App } = await import("./App");
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void start();
