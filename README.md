# Chaperone

A static site for science and biotech writing: weekly briefs, longer reviews,
and short news links. Built with [Astro](https://astro.build), Tailwind CSS,
and Markdown content collections — no database, no server, no CMS.

## Running locally

```bash
npm install
npm run dev      # http://localhost:4321 — drafts are visible here
npm run build    # production build to dist/ — drafts are excluded
npm run preview  # serve the production build locally
npx astro check  # TypeScript / content-schema diagnostics
```

## Adding content

Raw content lands in [`inbox/`](inbox/README.md) (gitignored — nothing there
is published as-is), then gets processed by an ingest script into
`src/content/<type>/`, where it's validated against a strict schema.

```bash
node scripts/new-brief.mjs inbox/science-brief-2026-09-27.md
node scripts/new-review.mjs inbox/some-review.md
node scripts/new-news.mjs inbox/some-news-item.md
```

Each script:
- Validates existing frontmatter, or derives whatever's missing (title from
  the first `#` heading, summary from a "Top takeaways" section or the first
  paragraph, a brief's coverage window from a "Coverage window:" line, and so
  on) and tells you exactly what it guessed.
- For briefs specifically: strips an embedded "## Table of contents" section
  (heading through the next `##` or horizontal rule) if one exists, since the
  site renders its own sticky table of contents from the real headings — logs
  exactly what it removed, and is a no-op if there's nothing to strip.
- Refuses to guess fields that could genuinely be wrong instead of missing —
  a news item's `link` and `source` must already be in the frontmatter.
- Fails loudly (non-zero exit, nothing written) on a schema violation, naming
  the exact field.
- Never overwrites an existing file in `src/content/` without `--force`.

`new-review.mjs` and `new-news.mjs` also accept `--slug custom-slug` to
override the filename-derived slug. `new-review.mjs` additionally takes:

```bash
node scripts/new-review.mjs inbox/some-review.md \
  --docx inbox/some-review.docx \
  --figures inbox/some-review-figures/
```

- `--docx <path>`: copied to `public/downloads/<slug>.docx`; sets `docxPath`
  so the review page shows a download link. Validated to exist before
  anything is written.
- `--figures <dir>`: copies the directory's contents to
  `public/figures/<slug>/` and rewrites the markdown's relative image paths
  to match. Every relative image the markdown references must already be in
  that directory, or the script fails before writing anything — it never
  guesses at a missing figure.

### Figure and table captions

A paragraph directly after an image or a table, starting with a bolded
`**Figure 1.**` or `**Table 1.**`, is treated as that figure's caption — see
[`src/lib/rehype-captions.ts`](src/lib/rehype-captions.ts). The label starts
it, and the final sentence is read as the source attribution and styled
smaller and muted:

```markdown
![A diagram of X](figure1.png)

**Figure 1.** What the figure shows, in a sentence or two. Source: Author et
al. (2025), *Journal Name*, licence.
```

An italic-only paragraph in the same position is a fallback for content that
doesn't follow this convention, but the bold-prefix form is authoritative.

Once `scripts/publish.sh` exists (a later phase), it wraps this: ingest →
build → commit → push, and is what a scheduled task runs non-interactively.

### Frontmatter reference

**briefs** (`src/content/briefs/science-brief-YYYY-MM-DD.md`)

| field | required | notes |
| --- | --- | --- |
| `title` | yes | |
| `date` | yes | publication date |
| `windowStart` / `windowEnd` | yes | coverage period |
| `summary` | yes | 1–2 sentences; used on cards, meta description, RSS |
| `tags` | no | defaults to `[]` |
| `itemCount` | no | always recomputed by the ingest script from `###` headings |
| `draft` | no | defaults to `false`; drafts never appear in a production build |

**reviews** (`src/content/reviews/slug.md`)

| field | required | notes |
| --- | --- | --- |
| `title` | yes | |
| `date` | yes | |
| `summary` | yes | |
| `tags` | no | defaults to `[]` |
| `subfield` | no | e.g. `"immunology"` — powers `/reviews/subfield/[subfield]` |
| `readingTime` | no | minutes; computed from word count if absent |
| `sources` | no | array of `{ title, url, authors?, year?, journal?, doi?, pmid? }` — rendered as a numbered reference list |
| `docxPath` | no | set by `--docx`; shows a "Download as Word document" link |
| `draft` | no | defaults to `false` |

**news** (`src/content/news/YYYY-MM-DD-slug.md`)

| field | required | notes |
| --- | --- | --- |
| `title` | yes | |
| `date` | yes | |
| `summary` | yes | |
| `link` | yes | the URL the item points to — never guessed |
| `source` | yes | publication name, e.g. `"Nature"` — never guessed |
| `tags` | no | defaults to `[]` |

Schemas are defined once, in [`src/content/schemas.ts`](src/content/schemas.ts),
and shared between the Astro build and the ingest scripts.

## Feeds and SEO

- `/rss.xml` — full content for every brief and review (not just a summary),
  plus every news item. Reviews have their figure `<img>` tags stripped from
  the feed (figure licensing is restricted to this site); captions and their
  source attribution stay.
- `/sitemap-index.xml` / `/sitemap-0.xml` — generated by `@astrojs/sitemap`
  from whatever actually got built, so drafts are never included.
- Every page carries canonical, Open Graph, and Twitter-card meta tags
  (`src/layouts/BaseLayout.astro`). The OG image is one static file,
  `public/og-image.png` (1200×630) — there's no per-page or dynamic image
  generation.
- **`astro.config.mjs`'s `site` is still a placeholder**
  (`https://chaperone.example`, the IANA-reserved non-resolving TLD) — it
  feeds the canonical URLs, RSS links, and sitemap. This is enforced, not
  just documented: `npm run build` refuses to build while `site` contains
  `"example"` or is unset (`astro.config.mjs` checks for the literal `build`
  command and throws before Astro even loads the rest of the config). `npm
  run dev` only warns, so local work isn't blocked.

  In phase 4a, `site` gets set to whatever `*.netlify.app` URL Netlify
  assigns on first deploy — no domain purchase needed for that. If a custom
  domain gets added later, updating to it is two changes, not one: this one
  line in `astro.config.mjs`, plus pointing the domain's DNS at Netlify (in
  Netlify's own domain settings, not part of this repo).

## Project structure

```
src/
  content/
    schemas.ts       # zod schemas, shared by content.config.ts and the ingest scripts
    briefs/ reviews/ news/
  content.config.ts  # collection definitions (Astro's content-collections config)
  components/        # ToC, cards, header, theme toggle
  layouts/
  pages/
  styles/
scripts/
  new-brief.mjs new-review.mjs new-news.mjs
  lib/ingest-helpers.mjs
inbox/                # staging area for raw content — see inbox/README.md
```

## Deployment

Not yet configured — coming in a later phase, along with `scripts/publish.sh`.
This section will document the Netlify setup and the non-interactive publish
flow once both exist.
