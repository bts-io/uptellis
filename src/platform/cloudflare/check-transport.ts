/**
 * The `CheckTransport` for Workers (the builtin runner on Cloudflare): `fetch` and `tcp` only. Workers
 * have no ICMP and do not expose the peer certificate, so `ping` and `tls` are absent and the runner skips
 * those monitor types (`RUNNER_TYPES.cloudflare`).
 *
 * `tcp` opens a socket with `connect()` from `cloudflare:sockets`, resolves once `socket.opened` settles and
 * closes it again; nothing is sent. A timeout rejects with an Error named `TimeoutError`. Workers report a
 * refused connection only in the error message, which runCheck maps to `connection refused` without ever
 * showing the message itself.
 */
import { connect } from "cloudflare:sockets";
import { timeoutError } from "@/checks/attempt";
import type { CheckTransport, TcpProbe } from "@/shared/monitors/check";

export function createCloudflareCheckTransport(): CheckTransport {
  return {
    fetch: (input, init) => fetch(input, init),

    async tcp(host, port, timeoutMs): Promise<TcpProbe> {
      const started = Date.now();
      const socket = connect({ hostname: host.replace(/^\[|\]$/g, ""), port });
      let timer: ReturnType<typeof setTimeout> | null = null;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(timeoutError()), timeoutMs);
      });
      try {
        await Promise.race([socket.opened, timeout]);
        return { latencyMs: Date.now() - started };
      } finally {
        clearTimeout(timer);
        // `closed` rejects too when the connection failed; nothing waits on it.
        socket.closed.catch(() => {});
        await socket.close().catch(() => {});
      }
    },
  };
}
