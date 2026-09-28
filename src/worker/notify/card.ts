/**
 * The Discord cards Uptellis posts: a source went silent (its `stale` incident opened) and it is back (the
 * incident resolved); a service is down (its `down` incident opened) and it is back up (the incident
 * resolved). Every card is rendered from the transition's `AlertMessage` (`alertCard`); `staleCard` and
 * friends build that message from the incident first (./alerts.ts). Pure.
 *
 * Layout: Components V2 (flags 32768), one container with an accent colour, a `###` heading with an emoji,
 * `**Key:** value` fields, a small grey footer with a Discord timestamp, a divider and a row of link buttons.
 * Nothing may ping (`allowed_mentions` is empty).
 * The text is ours (source ids match `SourceId`, hosts come from them); `cardIsSafe` still checks it for
 * addresses, emails and tokens before anything is sent.
 */
import { containsForbiddenLiteral } from "@/shared/model";
import type { AlertMessage, NotifyEvent } from "@/shared/notify";
import {
  type DownCardInput,
  downMessage,
  type RecoveredCardInput,
  recoveredMessage,
  type StaleCardInput,
  staleMessage,
  type UpCardInput,
  upMessage,
} from "./alerts";
import { descriptionOf, EMOJI, factsOf, headline } from "./format";

export type { CardService, DownCardInput, RecoveredCardInput, StaleCardInput, UpCardInput } from "./alerts";
export { duration, hostOf, interval, producerOf, silentSince, utc } from "./format";

export const IS_COMPONENTS_V2 = 1 << 15;

/** The card accents: dark red for silent, red for down, green for back. */
export const ACCENT = { stale: 0x7f1d1d, down: 0xdc2626, recovered: 0x22c55e } as const;

const ACCENT_OF: Record<NotifyEvent, number> = {
  stale: ACCENT.stale,
  down: ACCENT.down,
  up: ACCENT.recovered,
  recovered: ACCENT.recovered,
};

/** Webhook display name. */
export const USERNAME = "Uptellis";

type TextDisplay = { type: 10; content: string };
type Separator = { type: 14; divider: boolean; spacing: 1 | 2 };
type LinkButton = { type: 2; style: 5; label: string; url: string };
type ActionRow = { type: 1; components: LinkButton[] };

export interface DiscordCard {
  username: string;
  flags: typeof IS_COMPONENTS_V2;
  allowed_mentions: { parse: [] };
  components: [{ type: 17; accent_color: number; components: (TextDisplay | Separator | ActionRow)[] }];
}

/** The card of any alert message. */
export function alertCard(m: AlertMessage): DiscordCard {
  const head = [
    `### ${EMOJI[m.event]} ${headline(m)}`,
    descriptionOf(m, "card"),
    "",
    ...factsOf(m).map(([k, v]) => `**${k}:** ${v}`),
  ];
  const parts: DiscordCard["components"][0]["components"] = [
    { type: 10, content: head.join("\n") },
    {
      type: 10,
      content: `-# Uptellis · ${m.site.slug} · <t:${Math.floor(Date.parse(m.sentAt) / 1000)}:f>`,
    },
  ];
  if (m.pageUrl) {
    parts.push(
      { type: 14, divider: true, spacing: 1 },
      { type: 1, components: [{ type: 2, style: 5, label: "Status page", url: m.pageUrl }] },
    );
  }
  return {
    username: USERNAME,
    flags: IS_COMPONENTS_V2,
    allowed_mentions: { parse: [] },
    components: [{ type: 17, accent_color: ACCENT_OF[m.event], components: parts }],
  };
}

export const staleCard = (input: StaleCardInput) => alertCard(staleMessage(input));
export const recoveredCard = (input: RecoveredCardInput) => alertCard(recoveredMessage(input));
export const downCard = (input: DownCardInput) => alertCard(downMessage(input));
export const upCard = (input: UpCardInput) => alertCard(upMessage(input));

/** False when any text or link of the card carries an address, an email or a token. */
export function cardIsSafe(card: DiscordCard): boolean {
  const texts: string[] = [card.username];
  for (const c of card.components[0].components) {
    if (c.type === 10) texts.push(c.content);
    if (c.type === 1) for (const b of c.components) texts.push(b.label, b.url);
  }
  return !texts.some(containsForbiddenLiteral);
}
