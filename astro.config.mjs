// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import { unified } from '@astrojs/markdown-remark';
import sitemap from '@astrojs/sitemap';
import rehypeCaptions from './src/lib/rehype-captions.ts';

// TODO: replace with the real domain once it's live (phase 4a) — this
// placeholder uses the IANA-reserved .example TLD so it can never resolve.
const SITE_URL = 'https://chaperone.example';

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