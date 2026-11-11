import { createFileRoute, redirect } from "@tanstack/react-router";

// The company tools now live in the owner console.
export const Route = createFileRoute("/_authenticated/companies")({
  beforeLoad: () => { throw redirect({ to: "/owner/companies" }); },
});
