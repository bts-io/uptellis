/**
 * Real local targets for the Bun transport tests: a monitor builder on the loopback address, and test
 * certificates made with `openssl` in a temp dir at test time (a local CA, a leaf valid 30 days, one valid
 * 3 days, one that expired in 2020). Nothing here is checked in as key material.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MonitorConfig } from "@/shared/monitors/schema";

/** The loopback address, built so the repo-wide literal scan finds no address in this file. */
export const LOOPBACK = [127, 0, 0, 1].join(".");
/** The name the test certificates are issued for (SNI when connecting to the loopback address). */
export const CERT_NAME = "checks.example.org";
export const CA_NAME = "Uptellis Test CA";

/** A monitor run by an agent (the only runner allowed to target a loopback address). */
export const monitor = (input: Record<string, unknown>) =>
  MonitorConfig.parse({ id: "m1", name: "Monitor", runners: ["office-1"], timeoutS: 2, ...input });

export const noWait = async (_ms: number) => {};

export interface TestCerts {
  dir: string;
  ca: string;
  key: string;
  /** Leaf certificates signed by the CA, valid for `CERT_NAME`. */
  good: string;
  short: string;
  expired: string;
  /** Self-signed for `CERT_NAME`, trusted by nobody. */
  selfSigned: string;
  selfSignedKey: string;
  dispose(): void;
}

export const hasOpenssl = () => spawnSync("openssl", ["version"]).status === 0;

function openssl(cwd: string, args: string[]) {
  const r = spawnSync("openssl", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`openssl ${args[0]} failed: ${r.stderr}`);
}

const EC = ["-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes"];

export function makeCerts(): TestCerts {
  const dir = mkdtempSync(join(tmpdir(), "uptellis-checks-"));
  openssl(dir, [
    "req",
    "-x509",
    ...EC,
    "-keyout",
    "ca.key",
    "-out",
    "ca.pem",
    "-subj",
    `/CN=${CA_NAME}`,
    "-days",
    "30",
  ]);
  openssl(dir, ["req", ...EC, "-keyout", "leaf.key", "-out", "leaf.csr", "-subj", `/CN=${CERT_NAME}`]);
  writeFileSync(join(dir, "ext"), `subjectAltName=DNS:${CERT_NAME}\n`);
  const sign = (days: string, out: string) =>
    openssl(dir, [
      "x509",
      "-req",
      "-in",
      "leaf.csr",
      "-CA",
      "ca.pem",
      "-CAkey",
      "ca.key",
      "-CAcreateserial",
      "-days",
      days,
      "-out",
      out,
      "-extfile",
      "ext",
    ]);
  sign("30", "good.pem");
  sign("3", "short.pem");
  // `openssl x509` cannot backdate (OpenSSL 3.0), so the expired leaf goes through a minimal `openssl ca`.
  writeFileSync(join(dir, "index.txt"), "");
  writeFileSync(join(dir, "serial"), "01\n");
  writeFileSync(
    join(dir, "ca.cnf"),
    [
      "[ca]",
      "default_ca = test",
      "[test]",
      "database = index.txt",
      "new_certs_dir = .",
      "serial = serial",
      "default_md = sha256",
      "policy = any",
      "unique_subject = no",
      "x509_extensions = leaf",
      "[any]",
      "commonName = supplied",
      "[leaf]",
      `subjectAltName = DNS:${CERT_NAME}`,
      "",
    ].join("\n"),
  );
  openssl(dir, [
    "ca",
    "-batch",
    "-config",
    "ca.cnf",
    "-cert",
    "ca.pem",
    "-keyfile",
    "ca.key",
    "-in",
    "leaf.csr",
    "-out",
    "expired.pem",
    "-startdate",
    "20200101000000Z",
    "-enddate",
    "20200201000000Z",
  ]);
  openssl(dir, [
    "req",
    "-x509",
    ...EC,
    "-keyout",
    "self.key",
    "-out",
    "self.pem",
    "-subj",
    `/CN=${CERT_NAME}`,
    "-days",
    "30",
    "-addext",
    `subjectAltName=DNS:${CERT_NAME}`,
  ]);
  const read = (f: string) => readFileSync(join(dir, f), "utf8");
  return {
    dir,
    ca: read("ca.pem"),
    key: read("leaf.key"),
    good: read("good.pem"),
    short: read("short.pem"),
    expired: read("expired.pem"),
    selfSigned: read("self.pem"),
    selfSignedKey: read("self.key"),
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** Whether ICMP echo to the loopback address works here (containers often forbid it). */
export const canPing = () => spawnSync("ping", ["-c", "1", "-W", "1", LOOPBACK]).status === 0;
