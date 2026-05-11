/**
 * Zod schemas for the syndicate-signup surface.
 *
 * Kept in one file so the form + the route + the tests all see the
 * exact same shape. If the form posts something the schema rejects,
 * we return 400 with the zod issue array — the form decodes that to
 * inline field errors.
 */

import { z } from "zod";

import { SLUG_MAX_LEN, SLUG_MIN_LEN } from "./slug";
import { isValidSlugShape } from "./reserved-slugs";

/** Single-select for v1 — future tournaments are disabled in the UI. */
export const TOURNAMENT_IDS = ["fifa-wc-2026"] as const;
export const SIZE_BANDS = ["2-10", "11-30", "31-100", "100-plus"] as const;

export const slugSchema = z
  .string()
  .min(SLUG_MIN_LEN, "Slug must be at least 3 characters")
  .max(SLUG_MAX_LEN, "Slug must be at most 40 characters")
  .transform((s) => s.toLowerCase())
  .refine((s) => isValidSlugShape(s), {
    message: "Slug must be kebab-case (a-z, 0-9, single hyphens)",
  });

/**
 * Owner email — deliberately permissive. We do a confirm-email
 * round-trip later in the funnel; rejecting "x@y.z" because TLD
 * parsing was strict was the #1 friction signal in last year's beta.
 */
export const emailSchema = z
  .string()
  .min(3)
  .max(200)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Enter a valid email address");

/**
 * Owner phone — E.164: `+` followed by 8-15 digits. Country picker on
 * the form ensures the leading `+<cc>` is well-formed.
 */
export const phoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, "Enter a valid phone number in international format");

export const createSyndicateInputSchema = z.object({
  name: z.string().trim().min(3, "Name must be at least 3 characters").max(60),
  slug: slugSchema,
  tournament_id: z.enum(TOURNAMENT_IDS),
  size_band: z.enum(SIZE_BANDS),
  owner_email: emailSchema,
  owner_phone: phoneSchema,
  owner_handle: z.string().trim().max(60).optional().nullable(),
  topic: z.string().trim().max(280).optional().nullable(),
  marketing_consent: z.boolean(),
  terms_accepted: z.literal(true, {
    errorMap: () => ({ message: "You must agree to the terms to continue." }),
  }),
});

export type CreateSyndicateInput = z.infer<typeof createSyndicateInputSchema>;
