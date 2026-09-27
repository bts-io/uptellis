import { cx } from "./cx";
import type { VerdictProps } from "./props";
import { TEXT, VERDICT_TONE } from "./tone";

/** Overall verdict line ("ALL SYSTEMS OPERATIONAL"), coloured by state; a polite live region. */
export function Verdict({ verdict }: VerdictProps) {
  return (
    <p
      role="status"
      data-state={verdict.state}
      className={cx(
        "m-0 font-mono text-sm font-bold uppercase tracking-[0.08em]",
        TEXT[VERDICT_TONE[verdict.state]],
      )}
    >
      {verdict.label}
    </p>
  );
}
