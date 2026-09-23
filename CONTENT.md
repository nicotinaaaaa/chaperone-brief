# Content reference

Frontmatter fields, copy-pasteable templates, the figure/table caption
convention, and the ingest scripts' flags — everything needed to write a
brief or review by hand or from an automated task.

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
node scripts/new-brief.mjs inbox/some-directory/ [--force]   # batch mode

node scripts/new-review.mjs inbox/some-review.md \
  [--slug custom-slug] [--docx inbox/some-review.docx] \
  [--figures inbox/some-review-figures/] [--force]
```

| flag | scripts | does |
| --- | --- | --- |
| `--force` | both | overwrite an existing file in `src/content/` (refuses without it) |
| `--slug custom-slug` | review | override the filename-derived slug |
| `--docx <path>` | review | copy the file to `public/downloads/<slug>.docx`, set `docxPath`; the file must exist or the script fails before writing anything |
| `--figures <dir>` | review | copy the directory to `public/figures/<slug>/` and rewrite the markdown's relative image paths to match; every relative image the markdown references must already be in that directory, or the script fails before writing anything |

Every script:
- Validates existing frontmatter, or derives whatever's missing (title from
  the first `#` heading, summary from a "Top takeaways" section or the first
  paragraph, a brief's coverage window from a "Coverage window:" or "Period
  covered:" line, in either strict `YYYY-MM-DD` or human-readable form like
  "August 16–30, 2026" or "6–20 September 2026") and prints exactly what it
  guessed.
- Fails loudly (non-zero exit, nothing written for that file) on a schema
  violation, naming the exact field.
- Never overwrites an existing file without `--force`.

**Batch mode** (`new-brief.mjs` only, for now): pass a directory instead of a
file and it ingests every `.md` in it, printing a summary table (filename,
title, date, item count, what got guessed) at the end. One malformed file
fails and is reported — with the same detail as single-file mode — but
doesn't stop the rest of the batch; the whole run exits non-zero if anything
failed, so it's still safe to script around.

### Converting a `.docx` review

```bash
node scripts/docx-to-md.mjs inbox/some-review.docx [--force]
```

Installs [pandoc](https://pandoc.org) user-space to `~/.local` if it isn't
already on `PATH` (no sudo), then converts to markdown and writes a **draft
stub**, not a publishable file:

- `title` — from the first `#` heading if the source has one; otherwise a
  `TODO —` placeholder built from the filename, since guessing a title from
  body text (bold pseudo-headings, category labels, etc.) is exactly the
  kind of thing that can be confidently wrong rather than absent.
- `date` — from the `.docx` file's modified time.
- `summary`, `tags`, `subfield`, `sources` — left as visible `TODO —` markers
  (as YAML comments/placeholder strings, not silently omitted) for you to
  fill in.
- `draft: true`, so it can't accidentally ship via `new-review.mjs` before
  the TODOs are addressed.
- Images — extracted to `inbox/<slug>-figures/image-N.<ext>`, sequentially
  renamed, and referenced from the markdown as `![TODO alt text](image-N.ext)`
  regardless of whether pandoc originally emitted markdown or raw HTML `<img>`
  (pandoc falls back to HTML for any image Word gave explicit dimensions) —
  so the output is always in the form `new-review.mjs --figures` expects.
- A report naming what needs manual attention: no real heading structure
  (common — these source docs often use bold text as pseudo-headings, which
  means no sticky table of contents until fixed), tables (alignment/merged
  cells often degrade in conversion), and a references/bibliography section
  (citation formatting is where conversion degrades most).

Writes only into `inbox/` — never touches `public/figures/` and never
auto-publishes. Review the stub, fill in the TODOs, restructure headings if
needed, then run `new-review.mjs` as usual.

`scripts/publish.sh` (once it exists) wraps this: ingest → build → commit →
push, and is what a scheduled task runs non-interactively.
