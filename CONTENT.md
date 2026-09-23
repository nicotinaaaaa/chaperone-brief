# Content reference

Frontmatter fields, copy-pasteable templates, the figure/table caption
convention, and the ingest scripts' flags — everything needed to write a
brief, review, or news item by hand or from an automated task.

For how to run the site locally, how the ingest pipeline fits together, and
deployment, see [README.md](README.md).

Schemas are defined once, in [`src/content/schemas.ts`](src/content/schemas.ts),
and enforced both by the ingest scripts and by `npm run build` — a file with
a missing or malformed field fails the build and names the exact field.

---

## Briefs

Path: `src/content/briefs/science-brief-YYYY-MM-DD.md`

| field | required | notes |
| --- | --- | --- |
| `title` | yes | |
| `date` | yes | publication date |
| `windowStart` / `windowEnd` | yes | coverage period |
| `summary` | yes | 1–2 sentences; used on cards, the meta description, and RSS |
| `tags` | no | defaults to `[]` |
| `itemCount` | no | always recomputed by `new-brief.mjs` from `###` headings — don't hand-set it |
| `draft` | no | defaults to `false`; drafts are visible in `npm run dev` and excluded from every production build |

Template:

```markdown
---
title: "Science & Biotech Brief — DD Month YYYY"
date: YYYY-MM-DD
windowStart: YYYY-MM-DD
windowEnd: YYYY-MM-DD
summary: "One or two sentences naming the two or three biggest stories."
tags: ["oncology", "gene-therapy"]
---

## 1. Section name

### A story headline

Body text.
```

Don't include your own `# Title` line or a `## Table of contents` section —
`new-brief.mjs` strips a leading heading that duplicates the frontmatter
title, and strips an embedded table of contents, since the site generates
its own sticky one from the real headings. See [Ingest scripts](#ingest-scripts)
below for what gets derived automatically if you omit a field.

---

## Reviews

Path: `src/content/reviews/slug.md`

| field | required | notes |
| --- | --- | --- |
| `title` | yes | |
| `date` | yes | |
| `summary` | yes | |
| `tags` | no | defaults to `[]` |
| `subfield` | no | e.g. `"immunology"` — powers `/reviews/subfield/[subfield]` |
| `readingTime` | no | minutes; computed from word count if absent |
| `sources` | no | array of citations — see shape below |
| `docxPath` | no | set automatically by `--docx`; don't hand-set it |
| `draft` | no | defaults to `false` |

Each entry in `sources` is:

| field | required | notes |
| --- | --- | --- |
| `title` | yes | |
| `url` | yes | must be a valid URL |
| `authors` | no | free text, e.g. `"Chen L, Okafor N, Vasquez M"` |
| `year` | no | |
| `journal` | no | |
| `doi` | no | bare DOI, not a full URL (e.g. `10.1038/s41577-025-01234-5`) |
| `pmid` | no | numeric PubMed ID |

Template:

```markdown
---
title: "Review title"
date: YYYY-MM-DD
summary: "One or two sentences."
tags: ["immunology"]
subfield: "immunology"
sources:
  - title: "Cited paper title"
    url: "https://doi.org/10.xxxx/xxxxx"
    authors: "Last F, Last F"
    year: 2025
    journal: "Journal Name"
    doi: "10.xxxx/xxxxx"
    pmid: 12345678
---

## Background

Body text.

![Alt text describing the figure](figure1.png)

**Figure 1.** What the figure shows. Source: Author et al. (2025), *Journal
Name*, licence.
```

Like briefs, don't include your own `# Title` line — `new-review.mjs` strips
it the same way.

---

## News

Path: `src/content/news/YYYY-MM-DD-slug.md`

| field | required | notes |
| --- | --- | --- |
| `title` | yes | |
| `date` | yes | |
| `summary` | yes | |
| `link` | yes | the URL the item points to — never guessed, must already be in the frontmatter |
| `source` | yes | publication name, e.g. `"Nature"` — never guessed |
| `tags` | no | defaults to `[]` |

Template:

```markdown
---
title: "Headline"
date: YYYY-MM-DD
summary: "A couple of sentences."
link: "https://example.com/the-article"
source: "Nature"
tags: ["genomics"]
---

Optional short body — most news items don't need one; the summary carries it.
```

---

## Figure and table captions

A paragraph directly after an image or a table, starting with a bolded
`**Figure 1.**` or `**Table 1.**`, is read as that figure's caption
(`src/lib/rehype-captions.ts`). Everything after the bold label is the
caption body; the **final sentence** is read as the source attribution and
styled smaller and muted — so put licensing/attribution as its own trailing
sentence, not folded into the middle of the description.

```markdown
![Alt text describing the figure](figure1.png)

**Figure 1.** What the figure shows, in a sentence or two. Source: Author et
al. (2025), *Journal Name*, licence.
```

```markdown
| Column | Column |
| --- | --- |
| a | b |

**Table 1.** What the table shows. Source: Author, Year.
```

The bold-prefix form is authoritative. An italic-only paragraph in the same
position is a fallback for content that doesn't follow this convention, but
don't rely on it — always use the bold prefix.

---

## Ingest scripts

Raw content goes in [`inbox/`](inbox/README.md) (gitignored — nothing there
is published as-is), then an ingest script validates it into
`src/content/<type>/`.

```bash
node scripts/new-brief.mjs inbox/science-brief-2026-09-27.md [--force]

node scripts/new-review.mjs inbox/some-review.md \
  [--slug custom-slug] [--docx inbox/some-review.docx] \
  [--figures inbox/some-review-figures/] [--force]

node scripts/new-news.mjs inbox/some-news-item.md [--slug custom-slug] [--force]
```

| flag | scripts | does |
| --- | --- | --- |
| `--force` | all | overwrite an existing file in `src/content/` (refuses without it) |
| `--slug custom-slug` | review, news | override the filename-derived slug |
| `--docx <path>` | review | copy the file to `public/downloads/<slug>.docx`, set `docxPath`; the file must exist or the script fails before writing anything |
| `--figures <dir>` | review | copy the directory to `public/figures/<slug>/` and rewrite the markdown's relative image paths to match; every relative image the markdown references must already be in that directory, or the script fails before writing anything |

Every script:
- Validates existing frontmatter, or derives whatever's missing (title from
  the first `#` heading, summary from a "Top takeaways" section or the first
  paragraph, a brief's coverage window from a "Coverage window:" line) and
  prints exactly what it guessed.
- Refuses to guess fields that could genuinely be wrong instead of missing —
  a news item's `link` and `source` must already be in the frontmatter.
- Fails loudly (non-zero exit, nothing written) on a schema violation, naming
  the exact field.
- Never overwrites an existing file without `--force`.

`scripts/publish.sh` (once it exists) wraps this: ingest → build → commit →
push, and is what a scheduled task runs non-interactively.
