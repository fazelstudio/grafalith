// Core bootstrap check: Phase 1 services must all initialize.
//
// `main.tsx` awaits `bootstrapCore()` BEFORE importing `App`, so a broken
// registry/bus/store fails here — behind a fatal dialog plus a console
// error — instead of half-rendering the shell. Each service loads through
// its own dynamic import so one failure blocks only itself in the report.
export interface CoreServiceCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly error?: string;
}

async function load(name: string, init: () => Promise<void>): Promise<CoreServiceCheck> {
  try {
    await init();
    return { name, ok: true };
  } catch (error) {
    return { name, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Initialize every Phase 1 core service, collecting per-service results.
 * The app never proceeds past this when any check fails.
 */
export async function bootstrapCore(): Promise<CoreServiceCheck[]> {
  return [
    await load('command registry', async () => {
      const module = await import('../../registries/commands');
      void module.commandRegistry.all();
    }),
    await load('app command registry', async () => {
      const module = await import('../../registries/appCommands');
      void module.appCommandRegistry.all();
    }),
    await load('event system', async () => {
      const module = await import('../events/appEvents');
      void module.getAppEvents();
    }),
    await load('context keys', async () => {
      const module = await import('../context/contextKeys');
      void module.getContextKeys();
    }),
    await load('settings registry', async () => {
      const module = await import('../../features/settings/settingsDescriptors');
      void module.settingRegistry.all();
      void module.settingSectionRegistry.all();
    }),
    await load('extension host', async () => {
      const module = await import('../extensions/extensionHost');
      void module.getExtensionHost();
    }),
    await load('output channels', async () => {
      const module = await import('../extensions/outputChannel');
      void module.getOutputChannels().system();
    }),
    await load('startup queue', async () => {
      const module = await import('./startupQueue');
      void module.createStartupQueue();
    }),
  ];
}

/**
 * Synchronous variant over injectable services for unit tests.
 */
export function bootstrapCoreSync(
  services: readonly { name: string; init: () => void }[],
): CoreServiceCheck[] {
  return services.map((service) => {
    try {
      service.init();
      return { name: service.name, ok: true };
    } catch (error) {
      return {
        name: service.name,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

/** Whether every Phase 1 service initialized. */
export function coreReady(checks: readonly CoreServiceCheck[]): boolean {
  return checks.every((service) => service.ok);
}
