import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://docs.junando.dev',
  base: '/',
  output: 'static',
  integrations: [
    starlight({
      title: 'Junando Documentation',
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Overview', slug: 'getting-started' },
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
