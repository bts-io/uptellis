import { useMemo } from "react";
import { useDecrypt } from "@/client/effects";
import { bannerLayers, renderAnsiShadow } from "./ansi-shadow";
import { cx } from "./cx";
import type { BannerProps } from "./props";

const LAYER = "m-0 whitespace-pre font-mono font-normal leading-[1.02] tracking-normal [grid-area:1/1]";

/**
 * Block-letter wordmark in ANSI Shadow: the solid `█` layer and the box-drawing shadow layer (at 62%) are
 * stacked `<pre>`s filled with the brand gradient; while decrypting, a third layer shows the scrambled
 * characters. The accessible name is the plain text.
 */
export function Banner({ text, compact = false, decrypt = false, className }: BannerProps) {
  const art = useMemo(() => renderAnsiShadow(text), [text]);
  const frame = useDecrypt(art, { enabled: decrypt });
  const { block, shadow, noise } = bannerLayers(art, frame);
  return (
    <div
      role="img"
      aria-label={text}
      className={cx("grid w-max", compact ? "text-[11px]" : "text-[11px] md:text-[15px]", className)}
    >
      <pre aria-hidden="true" className={cx(LAYER, "text-gradient-brand opacity-62")}>
        {shadow}
      </pre>
      <pre aria-hidden="true" className={cx(LAYER, "text-gradient-brand")}>
        {block}
      </pre>
      {noise !== null && (
        <pre aria-hidden="true" className={cx(LAYER, "text-frame opacity-70")}>
          {noise}
        </pre>
      )}
    </div>
  );
}
