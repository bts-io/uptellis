import { useAgeTicker } from "@/client/effects";
import { fmtAge } from "./format";
import type { AgeProps } from "./props";

/** Relative time that ticks on the client ("34s ago"); the server renders the value at `now`. */
export function Age({ since, now, suffix = true }: AgeProps) {
  const s = useAgeTicker(since, now);
  return (
    <time dateTime={since}>
      {fmtAge(s)}
      {suffix ? " ago" : ""}
    </time>
  );
}
