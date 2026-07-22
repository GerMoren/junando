import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://docs.junando.dev',
  base: '/',
  output: 'static',
  integrations: [
    starlight({
      title: 'Junando Documentation',
      customCss: ['./src/styles/custom.css'],
      sidebar: [
        {
          label: 'Onboarding',
          items: [
            { label: 'Documentation', slug: 'index' },
          ],
        },
      ],
    }),
  ],
});
