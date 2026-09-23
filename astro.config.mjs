// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import { unified } from '@astrojs/markdown-remark';
import sitemap from '@astrojs/sitemap';
import rehypeCaptions from './src/lib/rehype-captions.ts';

// TODO: replace with the real domain once it's live (phase 4a) — this
// placeholder uses the IANA-reserved .example TLD so it can never resolve.
const SITE_URL = 'https://chaperone.example';

const isPlaceholderSite = !SITE_URL || SITE_URL.includes('example');
const isBuildCommand = process.argv.includes('build');

if (isPlaceholderSite) {
  const message =
    `astro.config.mjs: "site" is ${SITE_URL ? `still the placeholder ${JSON.stringify(SITE_URL)}` : 'unset'}. ` +
    'Canonical URLs, the sitemap, and every link in the RSS feed all derive from this — ' +
    'set it to the real Netlify URL (or custom domain) before building for production.';
  if (isBuildCommand) {
    throw new Error(message);
  }
  console.warn(`[astro.config] ${message} (continuing — not a production build)`);
}

// https://astro.build/config
export default defineConfig({
  site: SITE_URL,
  integrations: [sitemap()],
  vite: {
    plugins: [tailwindcss()]
  },
  markdown: {
    processor: unified({ rehypePlugins: [rehypeCaptions] })
  }
});