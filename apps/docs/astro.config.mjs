import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

/**
 * Minimal sitemap shim — prevents Starlight from injecting @astrojs/sitemap
 * (which fails with _routes undefined in this workspace-pnpm setup).
 * Registered before Starlight so Starlight's check for '@astrojs/sitemap' finds it.
 */
const noopSitemap = {
  name: '@astrojs/sitemap',
  hooks: {},
};

export default defineConfig({
  site: 'https://gha-dispatcher-docs.pplx.app',
  integrations: [
    noopSitemap,
    starlight({
      title: 'GHA Dispatcher',
      description: 'Single-screen GitHub Actions dispatcher for pv-udpv/pplx-lab',
      logo: { src: './src/assets/logo.svg' },
      social: { github: 'https://github.com/pv-udpv/gha-dispatcher' },
      sidebar: [
        { label: 'Overview', items: [
          { label: 'What is GHA Dispatcher', link: '/' },
          { label: 'Quick start', link: '/quick-start/' },
          { label: 'Architecture', link: '/architecture/' },
        ]},
        { label: 'Workflows', items: [
          { label: 'Catalog', link: '/workflows/' },
          { label: 'pv-cargo group', link: '/workflows/pv-cargo/' },
          { label: 'pv-sandbox group', link: '/workflows/pv-sandbox/' },
          { label: 'web group', link: '/workflows/web/' },
        ]},
        { label: 'API', items: [
          { label: 'Endpoints', link: '/api/' },
          { label: 'Schemas', link: '/api/schemas/' },
        ]},
        { label: 'Contribute', items: [
          { label: 'StackBlitz-style PR flow', link: '/contribute/pr-flow/' },
          { label: 'Local development', link: '/contribute/local-dev/' },
        ]},
      ],
      customCss: ['./src/styles/custom.css'],
    }),
  ],
  vite: {
    ssr: {
      noExternal: ['@gha-dispatcher/shared'],
    },
    resolve: {
      alias: {
        // postcss (bundled into Starlight's SSR chunk) imports nanoid/non-secure as a default.
        // Nanoid 3.x ESM has no default export; redirect to the CJS build which has one via CJS interop.
        'nanoid/non-secure': new URL(
          '../../node_modules/.pnpm/nanoid@3.3.12/node_modules/nanoid/non-secure/index.cjs',
          import.meta.url
        ).pathname,
      },
    },
  },
});
