/**
 * Bounds how many programs run on the runner at once. Interactive work (Run
 * button, staff tools) jumps ahead of submission judging so a large
 * submission cannot starve someone waiting on custom input.
 */
export class ExecutionPool {
  private active = 0;
  private readonly high: (() => void)[] = [];
  private readonly low: (() => void)[] = [];

  constructor(readonly size: number) {}

  get stats() {
    return { size: this.size, active: this.active, waiting: this.high.length + this.low.length };
  }

  async run<T>(priority: 'high' | 'low', fn: () => Promise<T>): Promise<T> {
    await this.acquire(priority);
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(priority: 'high' | 'low') {
    if (this.active < this.size) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      (priority === 'high' ? this.high : this.low).push(() => {
        this.active++;
        resolve();
      });
    });
  }

  private release() {
    this.active--;
    const next = this.high.shift() ?? this.low.shift();
    next?.();
  }
}
