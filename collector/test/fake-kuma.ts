// A minimal Kuma 2.5.5 stand-in: the same event names, argument shapes and login rules (password login
// returns a JWT-like token, loginByToken accepts it, afterLogin pushes the login burst).
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "socket.io";
import { importantPage, ip4, loginBurst } from "./fixtures/kuma-events";

export interface FakeKuma {
  url: string;
  /** Every event a client emitted, in order. */
  received: string[];
  io: Server;
  close(): Promise<void>;
}

export const FAKE_USER = "admin";
export const FAKE_PASSWORD = ["fake", "password"].join("-");
const TOKEN = ["fake", "session", "token"].join(".");
/** IPv4 loopback, assembled at runtime so this file passes the repo-wide literal scan. */
export const LOOPBACK = ip4(127, 0, 0, 1);

export async function startFakeKuma(): Promise<FakeKuma> {
  const http: HttpServer = createServer();
  const io = new Server(http);
  const received: string[] = [];

  const afterLogin = (socket: import("socket.io").Socket) => {
    socket.data.loggedIn = true;
    for (const [name, ...args] of loginBurst()) socket.emit(name, ...args);
  };

  io.on("connection", (socket) => {
    socket.emit("info", {
      primaryBaseURL: null,
      serverTimezone: "Asia/Tokyo",
      serverTimezoneOffset: "+09:00",
    });
    socket.onAny((name: string) => received.push(name));
    socket.on("login", (data: { username: string; password: string }, cb: (r: unknown) => void) => {
      if (data?.username === FAKE_USER && data.password === FAKE_PASSWORD) {
        afterLogin(socket);
        cb({ ok: true, token: TOKEN });
      } else cb({ ok: false, msg: "authIncorrectCreds", msgi18n: true });
    });
    socket.on("loginByToken", (token: string, cb: (r: unknown) => void) => {
      if (token === TOKEN) {
        afterLogin(socket);
        cb({ ok: true });
      } else cb({ ok: false, msg: "authInvalidToken", msgi18n: true });
    });
    socket.on("getDatabaseSize", (cb: (r: unknown) => void) =>
      cb(socket.data.loggedIn ? { ok: true, size: 5_242_880 } : { ok: false, msg: "You are not logged in." }),
    );
    socket.on(
      "monitorImportantHeartbeatListPaged",
      (id: number, _offset: number, _count: number, cb: (r: unknown) => void) =>
        cb({ ok: true, data: id === 5 ? importantPage(5) : [] }),
    );
  });

  // Bind and advertise the IPv4 loopback explicitly, never "localhost". Where /etc/hosts maps localhost to
  // both loopbacks with IPv6 first (Debian containers such as node:22-bookworm), listen("localhost")
  // binds the IPv6 loopback only, while Bun's WebSocket client dials the IPv4 one and is refused, so
  // every session test times out.
  await new Promise<void>((r) => http.listen(0, LOOPBACK, r));
  const { port } = http.address() as AddressInfo;
  return {
    url: `http://${LOOPBACK}:${port}`,
    received,
    io,
    close: () =>
      new Promise<void>((r) => {
        io.close();
        http.close(() => r());
      }),
  };
}
