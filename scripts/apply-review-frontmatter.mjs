#!/usr/bin/env node
// One-time backfill: fills in summary/subfield/tags/sources for the 7
// archival review stubs from the drafts already reviewed and approved in
// chat. Sources come from scripts/parse-references.mjs --json; 'trial-bundle'
// entries are dropped (registry records, not primary citations — they stay
// visible in the review's own trailing registry section instead), and the
// two manual overrides below are the one place a mechanical parse produced
// a wrong (not just missing) field, corrected by hand and noted as such.
// title is cleared, not filled in — now that the review's own heading has
// been promoted to a real H1, new-review.mjs's existing deriveTitleFromH1
// picks it up the same way it already does for briefs. draft stays true.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import matter from 'gray-matter';

const MANIFEST = {
	'ferroptosis-persister-cells-review.md': {
		summary:
			'Drug-tolerant persister cancer cells that survive targeted and cytotoxic therapy become selectively dependent on the GPX4/FSP1/DHODH/GCH1 ferroptosis-surveillance network, making ferroptosis induction a mechanistically grounded strategy for clearing minimal residual disease and preventing relapse.',
		subfield: 'oncology',
		tags: ['ferroptosis', 'drug-tolerant-persister-cells', 'GPX4', 'cancer-drug-resistance'],
	},
	'gdf15-gfral-cancer-cachexia-review.md': {
		summary:
			'The GDF-15–GFRAL–RET signalling axis drives cancer cachexia through both anorectic and anorexia-independent (sympathetic/lipolytic) pathways; the first randomised trial of a neutralising antibody, ponsegromab, produced clinically meaningful weight gain, though functional and survival benefit remain unresolved.',
		subfield: 'oncology',
		tags: ['GDF-15', 'GFRAL', 'cancer-cachexia', 'metabolic-disease'],
		sourceOverrides: {
			4: {
				title: 'The GDF15–GFRAL pathway in health and metabolic disease: friend or foe?',
				journal: 'Annu Rev Physiol',
			},
		},
	},
	'glymphatic-clearance-review.md': {
		summary:
			"The sleep-gated glymphatic system was long thought to increase brain clearance of amyloid-β during sleep, but a 2024 study measuring clearance directly found the opposite — a genuine, unresolved controversy at the center of an active human-trial pipeline in Alzheimer's disease.",
		subfield: 'neuroscience',
		tags: ['glymphatic-system', 'sleep', 'amyloid-beta', 'alzheimers-disease'],
	},
	'hiv-latent-reservoir-review.md': {
		summary:
			'The HIV-1 latent reservoir is now understood to be small, overwhelmingly defective, and maintained chiefly by proliferation of infected memory T cells rather than ongoing replication; of four cure strategies in development, only CCR5Δ32/Δ32 stem-cell transplantation has achieved durable cure.',
		subfield: 'virology',
		tags: ['HIV', 'latent-reservoir', 'broadly-neutralising-antibodies', 'HIV-cure'],
	},
	'intercellular-mitochondrial-transfer-review.md': {
		summary:
			'Mitochondria move between unrelated cells via tunnelling nanotubes, gap junctions, and free particles — a physiological repair mechanism now shown to also drive cancer chemoresistance and immune evasion, and one being deliberately harnessed for mitochondrial transplantation and adoptive T-cell therapy.',
		subfield: 'cell biology',
		tags: ['mitochondrial-transfer', 'tunnelling-nanotubes', 'tumour-microenvironment', 'cell-therapy'],
	},
	'phage-therapy-mdr-review.md': {
		summary:
			'Bacteriophage therapy for multidrug-resistant infections has strong observational and compassionate-use evidence but has so far failed to win a single randomised controlled trial, a gap this review attributes largely to trial design rather than lack of biological effect.',
		subfield: 'microbiology',
		tags: ['bacteriophage-therapy', 'antimicrobial-resistance', 'ESKAPE-pathogens'],
	},
	'trained-immunity-bcg-review.md': {
		summary:
			"BCG vaccination reprograms innate immune cells and their bone-marrow progenitors through durable epigenetic and metabolic changes, conferring heterologous protection against unrelated pathogens — the same mechanism underlies BCG's use in bladder cancer immunotherapy and its potential to worsen chronic inflammatory disease.",
		subfield: 'immunology',
		tags: ['trained-immunity', 'BCG-vaccine', 'innate-immune-memory', 'epigenetic-reprogramming'],
	},
};

function buildSource(p) {
	const source = {};
	if (p.title) source.title = p.title;
	if (p.url) source.url = p.url;
	if (p.authors) source.authors = p.authors;
	if (p.year) source.year = Number(p.year);
	if (p.journal) source.journal = p.journal;
	if (p.doi) source.doi = p.doi;
	if (p.pmid) source.pmid = Number(p.pmid);
	return source;
}

let totalDropped = 0;
let totalKept = 0;

for (const [filename, config] of Object.entries(MANIFEST)) {
	const filePath = path.resolve('inbox', filename);
	const raw = fs.readFileSync(filePath, 'utf-8');
	const parsed = matter(raw);

	const refResult = spawnSync('node', ['scripts/parse-references.mjs', filePath, '--json'], { encoding: 'utf-8' });
	if (refResult.status !== 0) {
		console.error(`✗ ${filename}: reference parsing failed:\n${refResult.stderr}`);
		process.exit(1);
	}
	const refs = JSON.parse(refResult.stdout);

	const sources = [];
	for (const r of refs) {
		if (r.kind === 'trial-bundle') {
			totalDropped++;
			continue;
		}
		const overridden = { ...r, ...(config.sourceOverrides?.[r.num] ?? {}) };
		sources.push(buildSource(overridden));
		totalKept++;
	}

	const data = { ...parsed.data };
	delete data.title; // let deriveTitleFromH1 pick up the now-real H1
	data.summary = config.summary;
	data.subfield = config.subfield;
	data.tags = config.tags;
	data.sources = sources;
	data.draft = true;

	fs.writeFileSync(filePath, matter.stringify(parsed.content, data));
	console.log(`✓ ${filename}: ${sources.length} source(s) written`);
}

console.log(`\n${totalKept} source(s) kept, ${totalDropped} bundle(s) dropped.`);
