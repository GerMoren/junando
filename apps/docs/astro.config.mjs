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
          label: 'Onboarding',
          items: [
            { label: 'Documentation foundation', slug: 'index' },
          ],
        },
      ],
    }),
  ],
});
