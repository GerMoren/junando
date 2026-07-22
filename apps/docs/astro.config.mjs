import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  // Real deployment URL. Switch back to https://docs.junando.dev once DNS for
  // the custom domain is configured (currently it has no A/CNAME records).
  site: 'https://junando-docs-rouge.vercel.app',
  base: '/',
  output: 'static',
  integrations: [
    starlight({
      title: 'Junando Documentation',
      customCss: ['./src/styles/custom.css'],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Getting Started', slug: 'getting-started' },
            { label: 'Local Docker', slug: 'local-docker' },
            { label: 'AWS Deployment', slug: 'aws' },
          ],
        },
        {
          label: 'Integrations',
          items: [
            { label: 'Slack', slug: 'slack' },
            { label: 'Teams', slug: 'teams' },
          ],
        },
        {
          label: 'Concepts',
          items: [
            { label: 'Wide Events', slug: 'wide-events' },
          ],
        },
        {
          label: 'Production',
          items: [
            { label: 'Pilot', slug: 'pilot' },
            { label: 'Troubleshooting', slug: 'troubleshooting' },
          ],
        },
      ],
    }),
  ],
});
