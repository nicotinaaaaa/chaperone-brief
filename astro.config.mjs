// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import { unified } from '@astrojs/markdown-remark';
import rehypeCaptions from './src/lib/rehype-captions.ts';

// https://astro.build/config
export default defineConfig({
  vite: {
    plugins: [tailwindcss()]
  },
  markdown: {
    processor: unified({ rehypePlugins: [rehypeCaptions] })
  }
});