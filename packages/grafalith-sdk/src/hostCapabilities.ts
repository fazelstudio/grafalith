/**
 * Clipboard surface (`grafalith.clipboard.*`). Requires the `clipboard`
 * manifest permission on the host; the memory adapter always allows.
 */
export interface ClipboardApi {
  /** Read text from the clipboard. */
  read(): Promise<string>;
  /** Write text to the clipboard. */
  write(text: string): Promise<void>;
}

/** In-memory clipboard for tests and headless hosts. */
export function createMemoryClipboard(initial = ""): ClipboardApi & { content: string } {
  return {
    content: initial,
    async read(this: { content: string }): Promise<string> {
      return this.content;
    },
    async write(this: { content: string }, text: string): Promise<void> {
      this.content = text;
    },
  };
}

/**
 * Sandboxed filesystem surface (`grafalith.fs.*`). Requires
 * `filesystem:read` (reads) and `filesystem:write` (writes); the host
 * denies undeclared access with a typed error instead of half-running.
 */
export interface FilesystemApi {
  /** Read one file as text. */
  readFile(path: string): Promise<string>;
  /** Write one file (creates parents on the host). */
  writeFile(path: string, content: string): Promise<void>;
}

/** In-memory filesystem for tests and headless hosts. */
export function createMemoryFilesystem(): FilesystemApi & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async readFile(path: string): Promise<string> {
      const content = files.get(path);
      if (content === undefined) throw new Error(`file not found: ${path}`);
      return content;
    },
    async writeFile(path: string, content: string): Promise<void> {
      files.set(path, content);
    },
  };
}
