import type { FastifyBaseLogger } from 'fastify';
import { compareVersions, runtimePackage, type PistonRuntime } from './piston';

export interface RunnerSetupState {
  state: 'disabled' | 'waiting' | 'checking' | 'installing' | 'ready' | 'error';
  wanted: string[];
  installed: string[];
  installing: string | null;
  error: string | null;
}

interface PistonPackage {
  language: string;
  language_version: string;
  installed: boolean;
}

/** "python,gcc=10.2.0" → [{ name: 'python' }, { name: 'gcc', version: '10.2.0' }] */
export function parsePackageSpec(spec: string) {
  return spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, version] = entry.split('=').map((s) => s.trim());
      return { name: name!, version: version || null };
    });
}

/** A package counts as installed when some runtime is provided by it (Deno's "typescript" is not the typescript package). */
export function isPackageInstalled(name: string, runtimes: PistonRuntime[]) {
  return runtimes.some((rt) => runtimePackage(rt) === name);
}

/**
 * Installs the configured Piston language packages on first boot. Packages
 * persist in the runner volume, so later boots work without internet.
 */
export class PistonSetup {
  readonly status: RunnerSetupState;
  private readonly wanted: { name: string; version: string | null }[];

  constructor(
    private readonly baseUrl: string,
    spec: string,
    private readonly log: FastifyBaseLogger,
    enabled: boolean,
  ) {
    this.wanted = parsePackageSpec(spec);
    this.status = {
      state: enabled ? 'waiting' : 'disabled',
      wanted: this.wanted.map((p) => p.name),
      installed: [],
      installing: null,
      error: null,
    };
  }

  private url(path: string) {
    return `${this.baseUrl.replace(/\/$/, '')}/api/v2${path}`;
  }

  private async runtimes(): Promise<PistonRuntime[]> {
    const res = await fetch(this.url('/runtimes'), { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`runner responded ${res.status}`);
    return (await res.json()) as PistonRuntime[];
  }

  async run(signal?: AbortSignal) {
    if (this.status.state === 'disabled') return;
    let runtimes: PistonRuntime[] | null = null;
    // The runner container may still be starting; wait up to ~5 minutes.
    for (let i = 0; i < 150 && !signal?.aborted; i++) {
      try {
        runtimes = await this.runtimes();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    if (!runtimes) {
      this.status.state = 'error';
      this.status.error = 'The code runner did not respond.';
      this.log.error('runner setup: runner unreachable');
      return;
    }

    this.status.state = 'checking';
    const missing = this.wanted.filter((p) => !isPackageInstalled(p.name, runtimes!));
    this.status.installed = this.wanted.filter((p) => !missing.includes(p)).map((p) => p.name);
    if (missing.length === 0) {
      this.status.state = 'ready';
      return;
    }

    let index: PistonPackage[];
    try {
      const res = await fetch(this.url('/packages'), { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`runner responded ${res.status}`);
      index = (await res.json()) as PistonPackage[];
    } catch (err) {
      this.status.state = 'error';
      this.status.error = `Could not read the package index (internet needed for first install): ${(err as Error).message}`;
      this.log.warn({ err }, 'runner setup: package index unavailable');
      return;
    }

    this.status.state = 'installing';
    for (const pkg of missing) {
      if (signal?.aborted) return;
      const versions = index.filter((p) => p.language === pkg.name).map((p) => p.language_version);
      versions.sort((a, b) => compareVersions(b, a));
      const version = pkg.version ?? versions[0];
      if (!version || !versions.includes(version)) {
        this.log.warn({ pkg }, 'runner setup: package not in index');
        continue;
      }
      this.status.installing = `${pkg.name} ${version}`;
      this.log.info({ pkg: pkg.name, version }, 'runner setup: installing package');
      try {
        const res = await fetch(this.url('/packages'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ language: pkg.name, version }),
          signal: AbortSignal.timeout(15 * 60_000),
        });
        if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
        this.status.installed.push(pkg.name);
      } catch (err) {
        this.log.error({ err, pkg: pkg.name }, 'runner setup: install failed');
        this.status.error = `Installing ${pkg.name} failed: ${(err as Error).message}`;
      }
    }
    this.status.installing = null;
    this.status.state = this.status.error ? 'error' : 'ready';
  }
}
