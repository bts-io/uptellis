/**
 * Seeds the built Worker the way production is fed: a fixture's kuma snapshot and facts, signed and POSTed
 * to `/api/ingest/*` through `SELF`. The Worker's clock is real, so every timestamp in the fixture is moved
 * forward by the same amount to end at the current time (the data is fresh, relative times are kept).
 */
import { env, SELF } from "cloudflare:test";
import { randomNonce, signRequest } from "@/shared/signing";
import { type FixtureModel, type FixtureName, loadFixture } from "../fixtures";
import { factsPayloadFrom, kumaSnapshotFrom } from "../support/fixture-payloads";

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

function shift<T>(value: T, deltaMs: number): T {
  if (typeof value === "string" && ISO.test(value)) return iso(Date.parse(value) + deltaMs) as T;
  if (Array.isArray(value)) return value.map((v) => shift(v, deltaMs)) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shift(v, deltaMs)])) as T;
  return value;
}

/** The fixture with its `now` moved to the current time. */
export function freshFixture(name: FixtureName): FixtureModel {
  const fx = loadFixture(name);
  return shift(fx, Date.now() - Date.parse(fx.now));
}

const worker = env as unknown as Env;

async function post(
  route: "kuma" | "facts",
  keyId: "collector-1" | "facts-1",
  payload: unknown,
): Promise<void> {
  const path = `/api/ingest/${route}`;
  const body = JSON.stringify(payload);
  const secret = keyId === "collector-1" ? worker.INGEST_KEY_COLLECTOR_1 : worker.INGEST_KEY_FACTS_1;
  const headers = await signRequest(secret, keyId, "POST", path, body, new Date(), randomNonce());
  const res = await SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    body,
    headers: { "content-type": "application/json", ...headers },
  });
  if (res.status !== 202) throw new Error(`seed ${route}: ${res.status} ${await res.text()}`);
}

/** Ingests the fixture's kuma snapshot and facts; returns the shifted fixture. */
export async function seed(name: FixtureName): Promise<FixtureModel> {
  const fx = freshFixture(name);
  await post("kuma", "collector-1", kumaSnapshotFrom(fx));
  await post("facts", "facts-1", factsPayloadFrom(fx));
  return fx;
}
