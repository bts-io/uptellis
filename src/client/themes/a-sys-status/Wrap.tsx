import type { ReactNode } from "react";
import { cx } from "./format";

/** The page column: 1360px wide, 40px gutters (16px on phones). */
export function Wrap({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("mx-auto max-w-[1360px] px-10 max-[760px]:px-4", className)}>{children}</div>;
}
