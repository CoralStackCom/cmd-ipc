/**
 * Sidebar configuration for cmd-ipc documentation
 *
 * This configuration is shared between Starlight and the llmify plugin
 * to ensure the sidebar and llms.txt stay in sync.
 */

export interface SidebarItem {
  label: string
  slug?: string
  items?: SidebarItem[]
  autogenerate?: { directory: string }
}

export interface SidebarSection {
  label: string
  items?: SidebarItem[]
  autogenerate?: { directory: string }
}

export const sidebar: SidebarSection[] = [
  {
    label: 'Introduction',
    items: [
      { label: 'What is cmd-ipc?', slug: 'introduction/what-is-cmd-ipc' },
      { label: 'Use Cases', slug: 'introduction/use-cases' },
      { label: 'Architecture', slug: 'introduction/architecture' },
      { label: 'Protocol', slug: 'introduction/protocol' },
    ],
  },
  {
    label: 'Getting Started',
    items: [
      { label: 'Installation', slug: 'getting-started/installation' },
      { label: 'Quick Start', slug: 'getting-started/quick-start' },
      { label: 'Defining Commands', slug: 'getting-started/defining-commands' },
      { label: 'Type Safety', slug: 'getting-started/type-safety' },
      {
        label: 'Channels',
        items: [
          { label: 'Overview', slug: 'getting-started/channels' },
          {
            label: 'MessagePortChannel',
            slug: 'getting-started/channels/message-port-channel',
          },
          { label: 'HTTPChannel', slug: 'getting-started/channels/http-channel' },
          {
            label: 'InMemoryChannel',
            slug: 'getting-started/channels/in-memory-channel',
          },
          { label: 'MCPChannel', slug: 'getting-started/channels/mcp-channel' },
        ],
      },
      { label: 'CLI', slug: 'getting-started/cli' },
    ],
  },
  {
    label: 'Examples',
    items: [
      { label: 'Overview', slug: 'examples/overview' },
      {
        label: 'TypeScript',
        items: [
          { label: 'Web Workers', slug: 'examples/typescript/web-workers' },
          { label: 'Electron', slug: 'examples/typescript/electron' },
          {
            label: 'Cloudflare Workers',
            slug: 'examples/typescript/cloudflare-workers',
          },
          { label: 'AI Agent MCP', slug: 'examples/typescript/mcp-agent' },
        ],
      },
      {
        label: 'Rust',
        items: [
          { label: 'Multi-Service', slug: 'examples/rust/multi-service' },
        ],
      },
    ],
  },
  {
    label: 'Reference',
    items: [
      { label: 'TypeScript API', slug: 'api/typescript' },
      { label: 'Rust API', slug: 'api/rust' },
    ],
  },
]
