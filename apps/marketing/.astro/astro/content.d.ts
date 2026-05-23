declare module 'astro:content' {
	interface Render {
		'.mdx': Promise<{
			Content: import('astro').MarkdownInstance<{}>['Content'];
			headings: import('astro').MarkdownHeading[];
			remarkPluginFrontmatter: Record<string, any>;
			components: import('astro').MDXInstance<{}>['components'];
		}>;
	}
}

declare module 'astro:content' {
	interface RenderResult {
		Content: import('astro/runtime/server/index.js').AstroComponentFactory;
		headings: import('astro').MarkdownHeading[];
		remarkPluginFrontmatter: Record<string, any>;
	}
	interface Render {
		'.md': Promise<RenderResult>;
	}

	export interface RenderedContent {
		html: string;
		metadata?: {
			imagePaths: Array<string>;
			[key: string]: unknown;
		};
	}
}

declare module 'astro:content' {
	type Flatten<T> = T extends { [K: string]: infer U } ? U : never;

	export type CollectionKey = keyof AnyEntryMap;
	export type CollectionEntry<C extends CollectionKey> = Flatten<AnyEntryMap[C]>;

	export type ContentCollectionKey = keyof ContentEntryMap;
	export type DataCollectionKey = keyof DataEntryMap;

	type AllValuesOf<T> = T extends any ? T[keyof T] : never;
	type ValidContentEntrySlug<C extends keyof ContentEntryMap> = AllValuesOf<
		ContentEntryMap[C]
	>['slug'];

	/** @deprecated Use `getEntry` instead. */
	export function getEntryBySlug<
		C extends keyof ContentEntryMap,
		E extends ValidContentEntrySlug<C> | (string & {}),
	>(
		collection: C,
		// Note that this has to accept a regular string too, for SSR
		entrySlug: E,
	): E extends ValidContentEntrySlug<C>
		? Promise<CollectionEntry<C>>
		: Promise<CollectionEntry<C> | undefined>;

	/** @deprecated Use `getEntry` instead. */
	export function getDataEntryById<C extends keyof DataEntryMap, E extends keyof DataEntryMap[C]>(
		collection: C,
		entryId: E,
	): Promise<CollectionEntry<C>>;

	export function getCollection<C extends keyof AnyEntryMap, E extends CollectionEntry<C>>(
		collection: C,
		filter?: (entry: CollectionEntry<C>) => entry is E,
	): Promise<E[]>;
	export function getCollection<C extends keyof AnyEntryMap>(
		collection: C,
		filter?: (entry: CollectionEntry<C>) => unknown,
	): Promise<CollectionEntry<C>[]>;

	export function getEntry<
		C extends keyof ContentEntryMap,
		E extends ValidContentEntrySlug<C> | (string & {}),
	>(entry: {
		collection: C;
		slug: E;
	}): E extends ValidContentEntrySlug<C>
		? Promise<CollectionEntry<C>>
		: Promise<CollectionEntry<C> | undefined>;
	export function getEntry<
		C extends keyof DataEntryMap,
		E extends keyof DataEntryMap[C] | (string & {}),
	>(entry: {
		collection: C;
		id: E;
	}): E extends keyof DataEntryMap[C]
		? Promise<DataEntryMap[C][E]>
		: Promise<CollectionEntry<C> | undefined>;
	export function getEntry<
		C extends keyof ContentEntryMap,
		E extends ValidContentEntrySlug<C> | (string & {}),
	>(
		collection: C,
		slug: E,
	): E extends ValidContentEntrySlug<C>
		? Promise<CollectionEntry<C>>
		: Promise<CollectionEntry<C> | undefined>;
	export function getEntry<
		C extends keyof DataEntryMap,
		E extends keyof DataEntryMap[C] | (string & {}),
	>(
		collection: C,
		id: E,
	): E extends keyof DataEntryMap[C]
		? Promise<DataEntryMap[C][E]>
		: Promise<CollectionEntry<C> | undefined>;

	/** Resolve an array of entry references from the same collection */
	export function getEntries<C extends keyof ContentEntryMap>(
		entries: {
			collection: C;
			slug: ValidContentEntrySlug<C>;
		}[],
	): Promise<CollectionEntry<C>[]>;
	export function getEntries<C extends keyof DataEntryMap>(
		entries: {
			collection: C;
			id: keyof DataEntryMap[C];
		}[],
	): Promise<CollectionEntry<C>[]>;

	export function render<C extends keyof AnyEntryMap>(
		entry: AnyEntryMap[C][string],
	): Promise<RenderResult>;

	export function reference<C extends keyof AnyEntryMap>(
		collection: C,
	): import('astro/zod').ZodEffects<
		import('astro/zod').ZodString,
		C extends keyof ContentEntryMap
			? {
					collection: C;
					slug: ValidContentEntrySlug<C>;
				}
			: {
					collection: C;
					id: keyof DataEntryMap[C];
				}
	>;
	// Allow generic `string` to avoid excessive type errors in the config
	// if `dev` is not running to update as you edit.
	// Invalid collection names will be caught at build time.
	export function reference<C extends string>(
		collection: C,
	): import('astro/zod').ZodEffects<import('astro/zod').ZodString, never>;

	type ReturnTypeOrOriginal<T> = T extends (...args: any[]) => infer R ? R : T;
	type InferEntrySchema<C extends keyof AnyEntryMap> = import('astro/zod').infer<
		ReturnTypeOrOriginal<Required<ContentConfig['collections'][C]>['schema']>
	>;

	type ContentEntryMap = {
		"blog": {
"2026-05-11-from-zero-to-launch.mdx": {
	id: "2026-05-11-from-zero-to-launch.mdx";
  slug: "2026-05-11-from-zero-to-launch";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".mdx"] };
"2026-05-11-the-bracket-game-explained.mdx": {
	id: "2026-05-11-the-bracket-game-explained.mdx";
  slug: "2026-05-11-the-bracket-game-explained";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".mdx"] };
"2026-05-11-watch-along-renderer-tech.mdx": {
	id: "2026-05-11-watch-along-renderer-tech.mdx";
  slug: "2026-05-11-watch-along-renderer-tech";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".mdx"] };
"2026-05-12-night-shift.mdx": {
	id: "2026-05-12-night-shift.mdx";
  slug: "2026-05-12-night-shift";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".mdx"] };
"2026-05-12-podium-share-cards.mdx": {
	id: "2026-05-12-podium-share-cards.mdx";
  slug: "2026-05-12-podium-share-cards";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".mdx"] };
"2026-05-12-pot-of-gold-or-pot-of-shit.mdx": {
	id: "2026-05-12-pot-of-gold-or-pot-of-shit.mdx";
  slug: "2026-05-12-pot-of-gold-or-pot-of-shit";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".mdx"] };
"2026-05-12-save-dont-lock.mdx": {
	id: "2026-05-12-save-dont-lock.mdx";
  slug: "2026-05-12-save-dont-lock";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".mdx"] };
"2026-05-12-tournament-as-molecule.mdx": {
	id: "2026-05-12-tournament-as-molecule.mdx";
  slug: "2026-05-12-tournament-as-molecule";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".mdx"] };
"2026-05-13-calling-3d-devs.mdx": {
	id: "2026-05-13-calling-3d-devs.mdx";
  slug: "2026-05-13-calling-3d-devs";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".mdx"] };
"2026-05-14-calling-designers.mdx": {
	id: "2026-05-14-calling-designers.mdx";
  slug: "2026-05-14-calling-designers";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".mdx"] };
"2026-05-15-calling-translators.mdx": {
	id: "2026-05-15-calling-translators.mdx";
  slug: "2026-05-15-calling-translators";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".mdx"] };
"2026-05-16-calling-smart-contract-devs.mdx": {
	id: "2026-05-16-calling-smart-contract-devs.mdx";
  slug: "2026-05-16-calling-smart-contract-devs";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".mdx"] };
"2026-05-17-calling-data-producers.mdx": {
	id: "2026-05-17-calling-data-producers.mdx";
  slug: "2026-05-17-calling-data-producers";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".mdx"] };
"2026-05-18-media-blockchain-prize-draws.mdx": {
	id: "2026-05-18-media-blockchain-prize-draws.mdx";
  slug: "2026-05-18-media-blockchain-prize-draws";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".mdx"] };
"2026-05-18-media-broadcast-integration.mdx": {
	id: "2026-05-18-media-broadcast-integration.mdx";
  slug: "2026-05-18-media-broadcast-integration";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".mdx"] };
"2026-05-18-media-million-pound-perfect-bracket.mdx": {
	id: "2026-05-18-media-million-pound-perfect-bracket.mdx";
  slug: "2026-05-18-media-million-pound-perfect-bracket";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".mdx"] };
"2026-05-18-media-sweepstakes-compliance.mdx": {
	id: "2026-05-18-media-sweepstakes-compliance.mdx";
  slug: "2026-05-18-media-sweepstakes-compliance";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".mdx"] };
"2026-05-24-translators-call.mdx": {
	id: "2026-05-24-translators-call.mdx";
  slug: "2026-05-24-translators-call";
  body: string;
  collection: "blog";
  data: InferEntrySchema<"blog">
} & { render(): Render[".mdx"] };
};
"engineering": {
"2026-05-12-agentic-orchestration.mdx": {
	id: "2026-05-12-agentic-orchestration.mdx";
  slug: "2026-05-12-agentic-orchestration";
  body: string;
  collection: "engineering";
  data: InferEntrySchema<"engineering">
} & { render(): Render[".mdx"] };
"2026-05-13-stack-at-a-glance.mdx": {
	id: "2026-05-13-stack-at-a-glance.mdx";
  slug: "2026-05-13-stack-at-a-glance";
  body: string;
  collection: "engineering";
  data: InferEntrySchema<"engineering">
} & { render(): Render[".mdx"] };
"2026-05-14-build-on-tournamental.mdx": {
	id: "2026-05-14-build-on-tournamental.mdx";
  slug: "2026-05-14-build-on-tournamental";
  body: string;
  collection: "engineering";
  data: InferEntrySchema<"engineering">
} & { render(): Render[".mdx"] };
};
"press": {
"2026-05-12-everything-open-source.mdx": {
	id: "2026-05-12-everything-open-source.mdx";
  slug: "2026-05-12-everything-open-source";
  body: string;
  collection: "press";
  data: InferEntrySchema<"press">
} & { render(): Render[".mdx"] };
"2026-05-13-ai-builder-launch.mdx": {
	id: "2026-05-13-ai-builder-launch.mdx";
  slug: "2026-05-13-ai-builder-launch";
  body: string;
  collection: "press";
  data: InferEntrySchema<"press">
} & { render(): Render[".mdx"] };
"2026-05-13-launch-techcrunch.mdx": {
	id: "2026-05-13-launch-techcrunch.mdx";
  slug: "2026-05-13-launch-techcrunch";
  body: string;
  collection: "press";
  data: InferEntrySchema<"press">
} & { render(): Render[".mdx"] };
"2026-05-13-open-business-drips.mdx": {
	id: "2026-05-13-open-business-drips.mdx";
  slug: "2026-05-13-open-business-drips";
  body: string;
  collection: "press";
  data: InferEntrySchema<"press">
} & { render(): Render[".mdx"] };
};

	};

	type DataEntryMap = {
		
	};

	type AnyEntryMap = ContentEntryMap & DataEntryMap;

	export type ContentConfig = typeof import("../../src/content/config.js");
}
