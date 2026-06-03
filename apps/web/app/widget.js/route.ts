/**
 * Apex `/widget.js` alias for the embed widget.
 *
 * Canonical source lives at `apps/web/app/embed/widget.js/route.ts`.
 * This file re-exports the GET handler + runtime config so partners can
 * embed via either:
 *
 *   <script src="https://play.tournamental.com/widget.js" async></script>
 *   <script src="https://play.tournamental.com/embed/widget.js" async></script>
 *
 * The short form matches the industry convention (Intercom, Calendly,
 * Drift, etc. all serve at the apex of the embed host). All our owned
 * snippets advertise the short form going forward; the `/embed/widget.js`
 * URL stays valid as the canonical source so legacy partner pages keep
 * working without an update.
 */

export { /* @next-codemod-error `GET` export is re-exported. Check if this component uses `params` or `searchParams`*/
GET, runtime, dynamic } from "../embed/widget.js/route";
