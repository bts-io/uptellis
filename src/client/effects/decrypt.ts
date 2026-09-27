import { useEffect, useState } from "react";
import { prefersReducedMotion, useReducedMotion } from "./reduced-motion";
import { claimSessionOnce } from "./session-once";

/** Characters a not-yet-settled position cycles through. All single UTF-16 units, so frames keep their length. */
export const DECRYPT_CHARSET =
  "!#$%&()*+-/0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_{|}~abcdefghijklmnopqrstuvwxyz█▓▒░╔╗╚╝═║";

const FRAME_MS = 45;

/**
 * When each character of `text` settles, in ms: left to right across the widest line (62% of the time) plus
 * random jitter (38%), so the text sweeps in with a ragged edge. Spaces and newlines never scramble (-1).
 */
export function settleTimes(text: string, durationMs: number, rand: () => number): number[] {
  const lines = text.split("\n");
  const width = Math.max(1, ...lines.map((l) => l.length));
  const out: number[] = [];
  lines.forEach((line, y) => {
    for (let x = 0; x < line.length; x++) {
      out.push(line[x] === " " ? -1 : (x / width) * durationMs * 0.62 + rand() * durationMs * 0.38);
    }
    if (y < lines.length - 1) out.push(-1);
  });
  return out;
}

/** The text at time `t`: settled characters in place, the rest replaced by random charset characters. */
export function decryptFrame(text: string, settle: number[], t: number, rand: () => number): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const at = settle[i] ?? -1;
    out += at < 0 || t >= at ? text[i] : DECRYPT_CHARSET[Math.floor(rand() * DECRYPT_CHARSET.length)];
  }
  return out;
}

/**
 * Scrambles `text` into place over `durationMs` (default 1.2 s) and returns the current frame. Runs once per
 * browser session per text; returns `text` unchanged on the server, on the first client render, under
 * reduced motion, when disabled and after the run.
 */
export function useDecrypt(text: string, opts: { durationMs?: number; enabled?: boolean } = {}): string {
  const { durationMs = 1200, enabled = true } = opts;
  const reduced = useReducedMotion();
  // The text this session's single run was claimed for (kept in state so StrictMode's rerun keeps it).
  const [armedFor, setArmedFor] = useState<string | null>(null);
  const [frame, setFrame] = useState(text);
  const armed = armedFor === text;

  useEffect(() => {
    if (enabled && !prefersReducedMotion() && claimSessionOnce(`decrypt:${text}`)) setArmedFor(text);
  }, [enabled, text]);

  useEffect(() => {
    if (!armed || reduced || !enabled) {
      setFrame(text);
      return;
    }
    const settle = settleTimes(text, durationMs, Math.random);
    const start = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const step = () => {
      const t = performance.now() - start;
      if (t >= durationMs) {
        setFrame(text);
        return;
      }
      setFrame(decryptFrame(text, settle, t, Math.random));
      timer = setTimeout(step, FRAME_MS);
    };
    step();
    return () => {
      clearTimeout(timer);
      setFrame(text);
    };
  }, [armed, reduced, enabled, text, durationMs]);

  return frame;
}
