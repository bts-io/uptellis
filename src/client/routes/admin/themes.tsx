import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { ThemePreviews } from "../../lib/admin/ThemePreviews";

const admin = getRouteApi("/admin");

export const Route = createFileRoute("/admin/themes")({
  component: () => <ThemePreviews current={admin.useLoaderData().state.config.theme} />,
});
