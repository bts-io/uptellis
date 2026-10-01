/**
 * An outline glyph per channel type (24px grid, stroke only, current text colour), decorative: always paired
 * with the type's name. Generic shapes, not the services' logos.
 */
import type { ChannelType } from "@/shared/notify";

const PATHS: Record<ChannelType, string> = {
  email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  discord: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M9 11h.01M15 11h.01"/>',
  slack: '<path d="M9 3 7 21M17 3l-2 18M4 8h17M3 16h17"/>',
  telegram: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  sms: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
  webhook:
    '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  ntfy: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
};

export function ChannelIcon({ type, size = 20 }: { type: ChannelType; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      dangerouslySetInnerHTML={{ __html: PATHS[type] }}
    />
  );
}
