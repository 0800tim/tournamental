# Fonts

These fonts are *not* committed. Run `pnpm --filter @vtorn/social-cards run fetch:fonts`
during install (or before `pnpm test`) to pull them.

Required:

- `Inter-Regular.ttf` — Inter SIL OFL 1.1, https://github.com/rsms/inter/releases
- `Inter-Bold.ttf`
- `Inter-Black.ttf`
- `NotoNaskhArabic-Regular.ttf` — Noto SIL OFL 1.1, https://fonts.google.com/noto/specimen/Noto+Naskh+Arabic
- `NotoSansJP-Bold.ttf` — Noto SIL OFL 1.1, https://fonts.google.com/noto/specimen/Noto+Sans+JP

The unit tests don't require these files: they exercise the JSDL builders
purely. Only the rasterisation tests (and the marketing build) need them.
