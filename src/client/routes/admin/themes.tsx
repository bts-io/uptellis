import { createFileRoute, redirect } from "@tanstack/react-router";
import { LEGACY_ADMIN_REDIRECTS } from "../../lib/admin/nav";

/** An old admin URL: the page moved (see `LEGACY_ADMIN_REDIRECTS`). */
export const Route = createFileRoute("/admin/themes")({
  beforeLoad: () => {
    throw redirect({ to: LEGACY_ADMIN_REDIRECTS["/admin/themes"], replace: true });
  },
});
