/**
 * /pools/playbook — legacy URL.
 *
 * The canonical playbook now lives at /pools/playbook (terminology
 * pivoted from "syndicates" to "pools"). Redirect old links here so
 * bookmarks and shared URLs keep working.
 */

import { redirect } from "next/navigation";

export default function SyndicatesPlaybookRedirect(): never {
  redirect("/pools/playbook");
}
