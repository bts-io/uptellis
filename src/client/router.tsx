import { createRouter } from "@tanstack/react-router";
import { ErrorPage, NotFoundPage } from "./lib/fallback";
import { routeTree } from "./routeTree.gen";

/** One router per request on the server, one per tab in the browser. */
export function getRouter() {
  return createRouter({
    routeTree,
    defaultPreload: "intent",
    scrollRestoration: true,
    defaultErrorComponent: ErrorPage,
    defaultNotFoundComponent: NotFoundPage,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
