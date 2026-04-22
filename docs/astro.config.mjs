import sitemap from '@astrojs/sitemap'
import starlight from '@astrojs/starlight'
import mermaid from 'astro-mermaid'
import { defineConfig } from 'astro/config'
import rehypeExternalLinks from 'rehype-external-links'
import { sidebar } from './src/config/sidebar'
import llmify from './src/integrations/llmify'

export default defineConfig({
  site: 'https://coralstack.com/cmd-ipc',
  base: '/cmd-ipc',
  markdown: {
    rehypePlugins: [
      [
        rehypeExternalLinks,
        {
          // Open external links in a new tab and harden against
          // tabnabbing / referrer leakage. Relative and same-origin
          // links are left untouched.
          target: '_blank',
          rel: ['noopener', 'noreferrer'],
        },
      ],
    ],
  },
  integrations: [
    mermaid(),
    starlight({
      title: 'cmd-ipc',
      description: 'Type-safe Inter-Process Communication for TypeScript',
      favicon: '/favicon.svg',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/CoralStackCom/cmd-ipc' },
      ],
      logo: {
        light: './src/assets/logo-light.svg',
        dark: './src/assets/logo-dark.svg',
        replacesTitle: false,
      },
      customCss: ['./src/styles/custom.css'],
      sidebar,
      editLink: {
        baseUrl: 'https://github.com/CoralStackCom/cmd-ipc/edit/main/docs/',
      },
      lastUpdated: true,
      head: [
        {
          tag: 'script',
          attrs: {
            src: '/cmd-ipc/scripts/mermaid-modal.js',
            defer: true,
          },
        },
      ],
    }),
    sitemap(),
    llmify({ sidebar }),
  ],
})
