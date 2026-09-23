#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fail, slugify, deriveTitleFromH1, toDateOnly } from './lib/ingest-helpers.mjs';

const LOCAL_BIN = path.join(os.homedir(), '.local', 'bin');
const LOCAL_ROOT = path.join(os.homedir(), '.local');

function pandocWorks(pandocPath) {
	const check = spawnSync(pandocPath, ['--version'], { encoding: 'utf-8' });
	return check.status === 0;
}

function installPandoc() {
	console.log('pandoc not found — installing user-space to ~/.local (no sudo)...');

	const release = spawnSync(
		'curl',
		['-fsSL', 'https://api.github.com/repos/jgm/pandoc/releases/latest'],
		{ encoding: 'utf-8' },
	);
	if (release.status !== 0) {
		fail('Could not reach GitHub to look up the latest pandoc release. Install pandoc manually: https://pandoc.org/installing.html');
	}
	const releaseData = JSON.parse(release.stdout);
	const version = releaseData.tag_name;

	const platform = process.platform;
	const arch = process.arch;
	let assetName;
	let installDirName;
	let archiveKind;

	if (platform === 'darwin') {
		const archName = arch === 'arm64' ? 'arm64' : 'x86_64';
		assetName = `pandoc-${version}-${archName}-macOS.zip`;
		installDirName = `pandoc-${version}-${archName}`;
		archiveKind = 'zip';
	} else if (platform === 'linux') {
		const archName = arch === 'arm64' ? 'arm64' : 'amd64';
		assetName = `pandoc-${version}-linux-${archName}.tar.gz`;
		installDirName = `pandoc-${version}-linux-${archName}`;
		archiveKind = 'tar';
	} else {
		fail(
			`No automatic pandoc install for platform=${platform} arch=${arch}. Install pandoc manually: https://pandoc.org/installing.html`,
		);
	}

	const asset = releaseData.assets.find((a) => a.name === assetName);
	if (!asset) {
		fail(
			`Could not find a "${assetName}" asset on pandoc release ${version}. ` +
				`Install pandoc manually: https://pandoc.org/installing.html`,
		);
	}

	const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandoc-install-'));
	const archivePath = path.join(scratchDir, assetName);
	const download = spawnSync('curl', ['-fsSL', '-o', archivePath, asset.browser_download_url], {
		stdio: 'inherit',
	});
	if (download.status !== 0) {
		fail(`Failed to download ${asset.browser_download_url}`);
	}

	fs.mkdirSync(LOCAL_ROOT, { recursive: true });
	if (archiveKind === 'zip') {
		const unzip = spawnSync('unzip', ['-oq', archivePath, '-d', LOCAL_ROOT]);
		if (unzip.status !== 0) fail(`Failed to extract ${archivePath}`);
	} else {
		fs.mkdirSync(path.join(LOCAL_ROOT, installDirName), { recursive: true });
		const untar = spawnSync('tar', ['-xzf', archivePath, '-C', path.join(LOCAL_ROOT, installDirName), '--strip-components=1']);
		if (untar.status !== 0) fail(`Failed to extract ${archivePath}`);
	}
	fs.rmSync(scratchDir, { recursive: true, force: true });

	// Find the extracted `pandoc` binary rather than assuming an exact
	// subpath — release archive layouts have shifted before.
	const installDir = path.join(LOCAL_ROOT, installDirName);
	const found = findFile(installDir, 'pandoc');
	if (!found) {
		fail(`Extracted pandoc but couldn't find the "pandoc" binary under ${installDir}`);
	}
	fs.chmodSync(found, 0o755);
	fs.mkdirSync(LOCAL_BIN, { recursive: true });
	fs.rmSync(path.join(LOCAL_BIN, 'pandoc'), { force: true });
	fs.symlinkSync(found, path.join(LOCAL_BIN, 'pandoc'));

	console.log(`✓ Installed pandoc ${version} -> ${found}`);
	console.log(`  Symlinked at ${path.join(LOCAL_BIN, 'pandoc')}`);
	return path.join(LOCAL_BIN, 'pandoc');
}

function findFile(dir, name) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
		if (entry.isFile() && entry.name === name) {
			return path.join(entry.parentPath ?? entry.path, entry.name);
		}
	}
	return null;
}

function ensurePandoc() {
	if (pandocWorks('pandoc')) return 'pandoc';
	const localCopy = path.join(LOCAL_BIN, 'pandoc');
	if (fs.existsSync(localCopy) && pandocWorks(localCopy)) return localCopy;
	return installPandoc();
}

// ---------------------------------------------------------------------

const args = process.argv.slice(2);
const force = args.includes('--force');
const inputPath = args.find((a) => !a.startsWith('--'));

if (!inputPath) {
	fail('Usage: node scripts/docx-to-md.mjs <path-to-.docx> [--force]');
}

const resolvedInput = path.resolve(inputPath);
if (!fs.existsSync(resolvedInput)) {
	fail(`File not found: ${resolvedInput}`);
}
if (path.extname(resolvedInput).toLowerCase() !== '.docx') {
	fail(`Not a .docx file: ${resolvedInput}`);
}

const pandocPath = ensurePandoc();

const slug = slugify(path.basename(resolvedInput, path.extname(resolvedInput)));
const inboxDir = path.resolve('inbox');
const destMdPath = path.join(inboxDir, `${slug}.md`);
const figuresDirName = `${slug}-figures`;
const destFiguresDir = path.join(inboxDir, figuresDirName);

if (fs.existsSync(destMdPath) && !force) {
	fail(`${destMdPath} already exists. Re-run with --force to overwrite.`);
}
if (fs.existsSync(destFiguresDir) && !force) {
	fail(`${destFiguresDir} already exists. Re-run with --force to overwrite.`);
}

const tempExtractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docx-to-md-'));

const conversion = spawnSync(
	pandocPath,
	[resolvedInput, '-f', 'docx', '-t', 'gfm', '--wrap=preserve', `--extract-media=${tempExtractDir}`, '-o', '-'],
	{ encoding: 'utf-8', maxBuffer: 100 * 1024 * 1024 },
);

if (conversion.status !== 0) {
	fail(`pandoc failed converting ${resolvedInput}:\n${conversion.stderr}`);
}

const pandocWarnings = conversion.stderr.trim();
let markdown = conversion.stdout;

// --- Normalise image references: pandoc emits plain markdown ![]() for
// unsized images, but falls back to raw HTML <img> (no alt text, inline
// width/height) for anything Word gave explicit dimensions. new-review.mjs's
// --figures rewriter only understands markdown syntax, so both forms are
// converted to it here, and every extracted file gets a clean sequential
// name instead of pandoc's content-hash filenames.
const IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)]+)\)|<img\b[^>]*\ssrc="([^"]+)"[^>]*\/?>/g;
let imageIndex = 0;
const imagesExtracted = [];
const imagesMissing = [];

markdown = markdown.replace(IMAGE_PATTERN, (match, mdAlt, mdSrc, htmlSrc) => {
	const src = mdSrc ?? htmlSrc;
	const alt = (mdAlt ?? '').trim();
	const resolvedSrc = path.isAbsolute(src) ? src : path.join(tempExtractDir, src);

	if (!fs.existsSync(resolvedSrc)) {
		imagesMissing.push(src);
		return match;
	}

	imageIndex += 1;
	const ext = path.extname(resolvedSrc) || '.png';
	const cleanName = `image-${imageIndex}${ext}`;
	fs.mkdirSync(destFiguresDir, { recursive: true });
	fs.copyFileSync(resolvedSrc, path.join(destFiguresDir, cleanName));
	imagesExtracted.push({ from: path.basename(src), to: cleanName });
	return `![${alt || 'TODO alt text'}](${cleanName})`;
});

fs.rmSync(tempExtractDir, { recursive: true, force: true });

// --- Derive what we safely can; TODO-stub the rest ---
const derivedTitle = deriveTitleFromH1(markdown);
const titleNote = derivedTitle
	? null
	: 'no "# " heading found in the converted document — the source likely uses bold-styled pseudo-headings rather than real Word heading styles, so the title could not be read from a heading the way it is for briefs';
const fallbackTitle = path.basename(resolvedInput, path.extname(resolvedInput)).replace(/[_-]+/g, ' ').trim();
const title = derivedTitle ?? `TODO — ${fallbackTitle}`;

const date = toDateOnly(fs.statSync(resolvedInput).mtime);

const tableCount = (markdown.match(/^\|[-:\s|]+\|\s*$/gm) || []).length;
// Matches a references/bibliography section however the source styled it —
// a real heading, bold pseudo-heading, or (as one of these docx exports
// used) a bare word alone on its own line with no styling at all.
const hasReferencesSection = /^\s*(\*\*|#{1,6}\s*)?(references|bibliography|works cited)\s*:?\s*\**\s*$/im.test(
	markdown,
);
const hasRealHeadings = /^#{1,6}\s/m.test(markdown);

// --- Frontmatter stub. Written as a literal template, not object
// serialization, specifically so the TODOs can be visible YAML comments —
// gray-matter's stringify has no way to attach a comment to a value. ---
const frontmatterLines = [
	'---',
	`title: ${JSON.stringify(title)}${titleNote ? ` # TODO — ${titleNote}` : ''}`,
	`date: '${date}'`,
	`summary: "TODO — one or two sentences" # required before this can be published`,
	`tags: [] # TODO — add relevant tags`,
	`subfield: "TODO — e.g. immunology, oncology, neuroscience"`,
	`sources: [] # TODO — citations: { title, url, authors?, year?, journal?, doi?, pmid? }`,
	`draft: true # flip to false once the TODOs above are filled in`,
	'---',
	'',
];

fs.mkdirSync(inboxDir, { recursive: true });
fs.writeFileSync(destMdPath, frontmatterLines.join('\n') + markdown);

// --- Report ---
console.log(`✓ Converted ${path.relative(process.cwd(), resolvedInput)}`);
console.log(`  -> ${path.relative(process.cwd(), destMdPath)}`);
if (imagesExtracted.length > 0) {
	console.log(`  -> ${path.relative(process.cwd(), destFiguresDir)}/ (${imagesExtracted.length} image${imagesExtracted.length === 1 ? '' : 's'})`);
}

console.log('\nDerived automatically:');
console.log(`  - date ← file modified time: ${date}`);
if (derivedTitle) {
	console.log(`  - title ← first "# " heading: "${derivedTitle}"`);
} else {
	console.log(`  - title: could not derive — stubbed as "${title}" (${titleNote})`);
}

console.log('\nLeft as TODO, on purpose — fill these in before running new-review.mjs:');
console.log('  - summary, tags, subfield, sources');

if (imagesExtracted.length > 0) {
	console.log(`\nImages extracted (${imagesExtracted.length}):`);
	for (const img of imagesExtracted) {
		console.log(`  - ${img.to}  (was ${img.from})`);
	}
}
if (imagesMissing.length > 0) {
	console.log(`\n⚠ ${imagesMissing.length} image reference(s) could not be resolved to an extracted file:`);
	for (const src of imagesMissing) console.log(`  - ${src}`);
}

console.log('\nNeeds manual attention:');
let flaggedAnything = false;
if (!hasRealHeadings) {
	console.log(
		'  - No real ## / ### headings in the output (the whole document appears to use bold text as pseudo-headings). ' +
			'The site\'s sticky table of contents needs real headings — add them manually, or this review will publish without one.',
	);
	flaggedAnything = true;
}
if (tableCount > 0) {
	console.log(`  - ${tableCount} table(s) converted — verify column alignment and that merged/complex cells survived intact.`);
	flaggedAnything = true;
}
if (hasReferencesSection) {
	console.log(
		'  - A references/bibliography section was found — verify citations converted correctly. ' +
			'docx→markdown conversion commonly mangles hanging indents, italicised journal names, and numbered/bracketed citation markers.',
	);
	flaggedAnything = true;
}
if (pandocWarnings) {
	console.log('  - pandoc reported warnings during conversion:');
	for (const line of pandocWarnings.split('\n')) console.log(`      ${line}`);
	flaggedAnything = true;
}
if (!flaggedAnything) {
	console.log('  - Nothing flagged — still read it over before publishing.');
}
