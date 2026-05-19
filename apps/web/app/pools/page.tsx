/**
 * /pools is the in-progress rename of the /syndicates surface. Routes
 * under /pools/* aren't fully built out yet; until they are, this stub
 * does a permanent redirect to the existing /syndicates page so the
 * homepage CTAs ("Run a pool", "Start your pool") don't 404.
 *
 * Delete when the /pools tree is properly migrated.
 */
import { redirect } from "next/navigation";

export default function PoolsRedirect(): never {
  redirect("/syndicates");
}
