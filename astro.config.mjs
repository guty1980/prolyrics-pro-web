// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import preact from '@astrojs/preact';

const site = process.env.SITE_URL || 'https://prolyrics-pro.netlify.app';

// https://astro.build/config
export default defineConfig({
  site,
  integrations: [
    sitemap(),
    preact(),
  ],
  markdown: {
    shikiConfig: {
      theme: 'github-light',
      wrap: true,
    },
  },
});
