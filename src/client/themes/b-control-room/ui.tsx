import type { HTMLAttributes, ReactNode } from "react";
import type { Level } from "@/shared/view";
import { cx } from "./format";

/**
 * A glass tile. `down` tints it red (a failing monitor, an open incident); `stale` drops the glass for a flat
 * hatched surface and desaturates the content.
 */
export function Tile({
  as: As = "section",
  down,
  stale,
  className,
  children,
  ...rest
}: {
  as?: "section" | "article" | "div";
  down?: boolean;
  stale?: boolean;
  className?: string;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "className" | "children">) {
  return (
    <As
      {...rest}
      className={cx(
        "relative min-w-0 rounded-[14px] border shadow-[inset_0_1px_0_var(--b-hair2),0_1px_2px_var(--b-shadow)]",
        down
          ? "border-down/45 bg-[linear-gradient(180deg,var(--b-tile-down-top),var(--b-tile-down-bottom))]"
          : "border-hair bg-[linear-gradient(180deg,var(--b-tile-top),var(--b-tile-bottom))]",
        stale
          ? "bg-panel after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:bg-[repeating-linear-gradient(135deg,var(--b-hatch)_0_6px,transparent_6px_14px)] *:saturate-[.4]"
          : "backdrop-blur-md",
        className,
      )}
    >
      {children}
    </As>
  );
}

/** Tile header row: a micro title on the left, a chip or count on the right. */
export function TileHead({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cx("flex items-center justify-between gap-2.5 px-4 pt-3.5", className)}>{children}</div>
  );
}

/** Small caps mono label. */
export function Micro({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={cx(
        "font-mono text-[11px] font-medium tracking-[.08em] whitespace-nowrap text-muted uppercase",
        className,
      )}
    >
      {children}
    </span>
  );
}

const CHIP: Record<Level | "maint", string> = {
  ok: "border-up/30 bg-up/7 text-up",
  warn: "border-degraded/30 bg-degraded/7 text-degraded",
  crit: "border-down/35 bg-down/8 text-down",
  maint: "border-maint/30 bg-maint/7 text-maint",
  info: "border-hair text-muted",
};

/** Rounded uppercase tag; the level picks its colour (neutral by default). */
export function Chip({
  level = "info",
  className,
  children,
}: {
  level?: Level | "maint";
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex h-5 shrink-0 items-center gap-[5px] rounded-md border px-[7px] font-mono text-[10.5px] tracking-[.06em] whitespace-nowrap uppercase",
        CHIP[level],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Key/value row with a dashed rule between rows. */
export function Kv({ k, className, children }: { k: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div
      className={cx(
        "flex items-center justify-between gap-2.5 border-t border-dashed border-(--b-hair2) py-1.5 font-mono text-xs whitespace-nowrap first:border-t-0",
        className,
      )}
    >
      <span className="text-muted">{k}</span>
      <span className="flex min-w-0 items-center gap-2 truncate">{children}</span>
    </div>
  );
}

/** The page column: 1392px wide, 24px gutters (16px on phones). */
export function Wrap({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("mx-auto w-full max-w-[1392px] px-4 lg:px-6", className)}>{children}</div>;
}
