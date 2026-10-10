/**
 * Host environment info (`grafalith.env.*`).
 *
 * Tells an extension which app, platform, and locale it runs in so
 * platform-specific behavior (shortcuts, paths, labels) branches in one
 * place instead of sniffing globals.
 */
export interface EnvInfo {
  readonly appVersion: string;
  readonly platform: "windows" | "macos" | "linux" | "web";
  readonly locale: string;
  readonly isMac: boolean;
  readonly isWindows: boolean;
  readonly isLinux: boolean;
  /** Whether the host runs in development mode (hot-reload armed). */
  readonly isDev: boolean;
}

/**
 * Resolve environment flags from explicit inputs (no global sniffing so
 * tests inject deterministically).
 *
 * @param input - App version, platform id, locale, and dev flag.
 * @returns Normalized flags (`isMac`/`isWindows`/`isLinux` derived once).
 */
export function resolveEnv(input: {
  appVersion: string;
  platform: EnvInfo["platform"];
  locale: string;
  isDev?: boolean;
}): EnvInfo {
  return {
    appVersion: input.appVersion,
    platform: input.platform,
    locale: input.locale,
    isMac: input.platform === "macos",
    isWindows: input.platform === "windows",
    isLinux: input.platform === "linux",
    isDev: input.isDev ?? false,
  };
}
