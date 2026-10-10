// Minimal Grafalith extension entry: one command, one toast, one channel.
//
// Build this file into `dist/index.js` (the manifest `main`), pack it with
// `grafalith.extension.json` as a `.grlt` zip, and install it from the
// command palette (`Install extension package`).
//
// Rules: register every intent as a command; push every disposable to
// `subscriptions` so the host cleans up on deactivate even when
// `deactivate()` below is missing; never let `activate()` throw — the
// host isolates failures per extension, but a clean activate keeps your
// status ACTIVE instead of ACTIVATION_FAILED.
import type { ExtensionContext } from "../../src/index.js";

/**
 * Activate the extension. Register commands here; push every disposable
 * to `subscriptions` so the host cleans up on deactivate.
 */
export function activate(context: ExtensionContext): void {
  const output = context.createOutputChannel?.("Hello World");
  output?.appendLine("[INFO] activating acme.hello-world");
  try {
    const disposable = context.commands?.registerCommand("acme.hello.say", () => {
      const greeting = context.workspace?.config.get("acme.hello.greeting", "Hello") ?? "Hello";
      context.window?.showNotification(`${greeting} from Hello World`, { level: "success" });
      output?.appendLine(`[INFO] said hello with greeting "${greeting}"`);
    });
    if (disposable) context.subscriptions.push(disposable);
    output?.appendLine("[INFO] extension activated successfully");
  } catch (error) {
    output?.appendLine(`[ERROR] activation failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/** Release extension state (optional; subscriptions dispose automatically). */
export function deactivate(): void {}
