/**
 * The channel providers, one per `ChannelType` (the `ChannelProvider` contract in
 * src/shared/notify/provider.ts). The dispatcher (../index.ts) picks one by the channel's type and calls it
 * through `sendVia`, which also turns a provider that throws (it should not) into a final `internal`.
 */
import type {
  AlertMessage,
  ChannelConfig,
  ChannelProvider,
  DeliveryOutcome,
  ProviderContext,
} from "@/shared/notify";
import { discordProvider } from "./discord";
import { emailProvider } from "./email";
import { ntfyProvider } from "./ntfy";
import { slackProvider } from "./slack";
import { telegramProvider } from "./telegram";
import { webhookProvider } from "./webhook";

export const PROVIDERS: { [T in ChannelConfig["type"]]: ChannelProvider<T> } = {
  discord: discordProvider,
  slack: slackProvider,
  webhook: webhookProvider,
  ntfy: ntfyProvider,
  telegram: telegramProvider,
  email: emailProvider,
};

/** Sends `message` to `channel` with its provider; never throws. */
export async function sendVia(
  message: AlertMessage,
  channel: ChannelConfig,
  ctx: ProviderContext,
): Promise<DeliveryOutcome> {
  const provider = PROVIDERS[channel.type] as ChannelProvider;
  try {
    return await provider.send(message, channel as never, ctx);
  } catch {
    return { ok: false, status: 0, error: "internal", retryable: false };
  }
}
