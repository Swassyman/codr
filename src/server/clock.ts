/**
 * The server is the only source of truth for time. Everything that makes a
 * deadline decision takes a Clock, so tests can drive time explicitly.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export class FakeClock implements Clock {
  private current: number;

  constructor(start: Date | string | number = Date.now()) {
    this.current = new Date(start).getTime();
  }

  now() {
    return new Date(this.current);
  }

  set(time: Date | string | number) {
    this.current = new Date(time).getTime();
  }

  advance(ms: number) {
    this.current += ms;
  }
}
