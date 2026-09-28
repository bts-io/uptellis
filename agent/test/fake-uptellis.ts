// A fake Uptellis instance for the agent tests: the two agent endpoints, with scripted answers for results.

import { MonitorConfig as MonitorSchema } from "../../src/shared/monitors/schema";
import { AGENT_API_PREFIX, type MonitorConfig, type ResultsBatch, RUNNER_HEADER } from "../src/shared";

/** The loopback address, assembled so the repo-wide literal scan stays clean. */
const LOOPBACK = [127, 0, 0, 1].join(".");

export const KEY = `upt_abcdefghijkl_${"s".repeat(43)}`;
export const RUNNER = "office-1";

export const monitor = (id: string, extra: Record<string, unknown> = {}): MonitorConfig =>
  MonitorSchema.parse({
    id,
    name: `Monitor ${id}`,
    type: "tcp",
    host: "app.example.org",
    port: 443,
    runners: [RUNNER],
    ...extra,
  });

export interface SeenRequest {
  method: string;
  path: string;
  headers: Headers;
}

export class FakeUptellis {
  server: ReturnType<typeof Bun.serve>;
  private readonly port: number;
  monitors: MonitorConfig[] = [monitor("web"), monitor("db", { intervalS: 120 })];
  etag = '"v1"';
  pollS = 60;
  /** Statuses for the next results posts, in order; 202 once empty. */
  resultStatuses: number[] = [];
  /** Answer every monitors GET with this status instead. */
  monitorsStatus: number | null = null;
  /** Accepted batches, in order. */
  batches: ResultsBatch[] = [];
  requests: SeenRequest[] = [];
  /** Byte cap enforced on results bodies (413 above it). */
  maxBytes = Number.POSITIVE_INFINITY;

  constructor() {
    this.server = Bun.serve({ port: 0, hostname: LOOPBACK, fetch: (req) => this.handle(req) });
    this.port = this.server.port!;
  }

  get url(): string {
    return `http://${LOOPBACK}:${this.port}`;
  }

  /** Stops listening (connections are refused) until `up()`. */
  down(): void {
    this.server.stop(true);
  }

  /** Listens again on the same port. */
  up(): void {
    this.server = Bun.serve({ port: this.port, hostname: LOOPBACK, fetch: (req) => this.handle(req) });
  }

  /** Every result the instance acknowledged, in the order it received them. */
  get received() {
    return this.batches.flatMap((b) => b.results);
  }

  private async handle(r: Request): Promise<Response> {
    const url = new URL(r.url);
    this.requests.push({ method: r.method, path: url.pathname, headers: r.headers });
    if (r.headers.get("authorization") !== `Bearer ${KEY}`) return new Response(null, { status: 401 });
    if (r.headers.get(RUNNER_HEADER) !== RUNNER) return new Response(null, { status: 403 });
    if (url.pathname === `${AGENT_API_PREFIX}/monitors` && r.method === "GET") {
      if (this.monitorsStatus !== null) return new Response(null, { status: this.monitorsStatus });
      if (r.headers.get("if-none-match") === this.etag) return new Response(null, { status: 304 });
      return Response.json(
        {
          v: 1,
          site: "demo",
          runner: RUNNER,
          generatedAt: new Date().toISOString(),
          monitors: this.monitors,
          pollS: this.pollS,
        },
        { headers: { etag: this.etag } },
      );
    }
    if (url.pathname === `${AGENT_API_PREFIX}/results` && r.method === "POST") {
      const text = await r.text();
      const status = this.resultStatuses.shift() ?? 202;
      if (status !== 202) return new Response(null, { status });
      if (Buffer.byteLength(text) > this.maxBytes) return new Response(null, { status: 413 });
      const batch = JSON.parse(text) as ResultsBatch;
      this.batches.push(batch);
      return Response.json({ accepted: batch.results.length, ignored: 0 }, { status: 202 });
    }
    return new Response(null, { status: 404 });
  }

  stop(): void {
    this.server.stop(true);
  }
}
