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
override the filename-derived slug.

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
| `readingTime` | no | minutes; computed from word count if absent |
| `sources` | no | array of `{ title, url }` |
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
