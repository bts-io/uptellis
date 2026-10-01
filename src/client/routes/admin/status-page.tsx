import { createFileRoute, getRouteApi, useBlocker, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { StatusPageScreen } from "../../lib/admin/statuspage/StatusPageScreen";
import { ConfirmDialog } from "../../lib/admin/ui";

const admin = getRouteApi("/admin");

/**
 * Status page: the structure editor (title, who can see it, theme, sections, public names) and the live
 * preview of the public page, published in one save. Leaving with unsaved changes asks first (in the
 * app through a dialog, on a reload or a closed tab through the browser's own prompt).
 */
export const Route = createFileRoute("/admin/status-page")({
  component: StatusPage,
});

function StatusPage() {
  const { site, state, view } = admin.useLoaderData();
  const router = useRouter();
  const [dirty, setDirty] = useState(false);
  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  });

  return (
    <>
      <StatusPageScreen
        site={site}
        state={state}
        view={view}
        onReload={() => void router.invalidate()}
        onDirtyChange={setDirty}
      />
      <ConfirmDialog
        open={blocker.status === "blocked"}
        title="Leave without publishing?"
        confirm="Leave"
        onClose={() => blocker.reset?.()}
        onConfirm={() => blocker.proceed?.()}
      >
        Your changes to the status page are not published yet. Leaving drops them.
      </ConfirmDialog>
    </>
  );
}
