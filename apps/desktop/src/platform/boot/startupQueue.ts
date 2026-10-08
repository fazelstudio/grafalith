/** Load priority. Lower runs first; project work never waits for extensions. */
export type StartupPriority = 'critical' | 'high' | 'normal' | 'low';

const PRIORITY_ORDER: Readonly<Record<StartupPriority, number>> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

/** One queued startup task. Tag groups related tasks for pause/resume. */
export interface StartupTask {
  id: string;
  priority: StartupPriority;
  tag: 'boot' | 'project' | 'extension' | 'maintenance';
  run: () => void | Promise<void>;
}

export interface StartupQueueResult {
  completed: string[];
  failed: { id: string; message: string }[];
}

/**
 * Prioritized startup queue.
 *
 * Policy: home boots with critical chrome (theme, locale, window) plus the
 * project list; extensions load in the background on normal priority. Entering
 * the editor enqueues the project open on high priority, which never waits
 * for extensions. While the project opens, the extension tag pauses; it resumes
 * after the project reports ready. This keeps editor entry instant while
 * extensions still converge without blocking the UI.
 */
export function createStartupQueue() {
  const tasks: StartupTask[] = [];
  const pausedTags = new Set<StartupTask['tag']>();

  function enqueue(task: StartupTask): void {
    if (tasks.some((entry) => entry.id === task.id)) {
      throw new Error(`duplicate startup task "${task.id}"`);
    }
    tasks.push(task);
  }

  function pause(tag: StartupTask['tag']): void {
    pausedTags.add(tag);
  }

  function resume(tag: StartupTask['tag']): void {
    pausedTags.delete(tag);
  }

  function pending(): readonly StartupTask[] {
    return [...tasks].sort(
      (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority],
    );
  }

  async function drain(filter?: (task: StartupTask) => boolean): Promise<StartupQueueResult> {
    const completed: string[] = [];
    const failed: { id: string; message: string }[] = [];
    const queue = pending().filter((task) => (filter ? filter(task) : true));
    for (const task of queue) {
      if (pausedTags.has(task.tag)) continue;
      const index = tasks.findIndex((entry) => entry.id === task.id);
      if (index !== -1) tasks.splice(index, 1);
      try {
        await task.run();
        completed.push(task.id);
      } catch (error) {
        failed.push({ id: task.id, message: error instanceof Error ? error.message : String(error) });
      }
    }
    return { completed, failed };
  }

  return { enqueue, pause, resume, pending, drain };
}

export type StartupQueue = ReturnType<typeof createStartupQueue>;
