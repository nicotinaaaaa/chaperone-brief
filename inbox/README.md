# inbox/

Staging area for raw content before it's ingested into the site.

Drop a freshly written brief or review here — with or without frontmatter —
and run the matching ingest script against it:

```bash
node scripts/new-brief.mjs inbox/science-brief-2026-09-27.md
node scripts/new-brief.mjs inbox/some-directory-of-briefs/   # batch mode — every .md in the directory
node scripts/new-review.mjs inbox/some-review.md
```

Reviews that start as a `.docx` go through an extra step first —
`scripts/docx-to-md.mjs` converts it to a markdown stub in `inbox/` (title
from the first heading if there is one, date from the file's modified time,
images extracted to `inbox/<slug>-figures/`) and leaves `summary`,
`subfield`, and `sources` as visible `TODO` markers for you to fill in by
hand, plus a report of anything that needs manual attention (tables,
reference lists, missing headings) before it's ready for `new-review.mjs`:

```bash
node scripts/docx-to-md.mjs inbox/some-review.docx
```

This is also where `./scripts/publish.sh` expects to find the file it's given.

Nothing in this directory is published as-is or committed — everything except
this README is gitignored. The ingest scripts read from here and write the
validated, normalized result into `src/content/<type>/`; the raw file is left
in place afterward (the scripts never delete their input).
