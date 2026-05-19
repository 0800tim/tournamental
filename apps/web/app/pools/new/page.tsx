import { redirect } from "next/navigation";

export default function PoolsNewRedirect(): never {
  redirect("/syndicates/new");
}
