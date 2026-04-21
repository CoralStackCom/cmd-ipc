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
      { label: 'Channels', slug: 'getting-started/channels' },
      {
        label: 'TypeScript',
        items: [
          { label: 'Quick Start', slug: 'getting-started/typescript/quick-start' },
          {
            label: 'Defining Commands',
            slug: 'getting-started/typescript/defining-commands',
          },
          { label: 'Type Safety', slug: 'getting-started/typescript/type-safety' },
          {
            label: 'Channels',
            items: [
              { label: 'Overview', slug: 'getting-started/typescript/channels' },
              {
                label: 'MessagePortChannel',
                slug: 'getting-started/typescript/channels/message-port-channel',
              },
              {
                label: 'HTTPChannel',
                slug: 'getting-started/typescript/channels/http-channel',
              },
              {
                label: 'MCPChannel',
                slug: 'getting-started/typescript/channels/mcp-channel',
              },
            ],
          },
          { label: 'CLI', slug: 'getting-started/typescript/cli' },
        ],
      },
      {
        label: 'Rust',
        items: [
          { label: 'Quick Start', slug: 'getting-started/rust/quick-start' },
          {
            label: 'Defining Commands',
            slug: 'getting-started/rust/defining-commands',
          },
          { label: 'Type Safety', slug: 'getting-started/rust/type-safety' },
          {
            label: 'Channels',
            items: [
              { label: 'Overview', slug: 'getting-started/rust/channels' },
              {
                label: 'InMemoryChannel',
                slug: 'getting-started/rust/channels/in-memory-channel',
              },
              {
                label: 'MCPChannel',
                slug: 'getting-started/rust/channels/mcp-channel',
              },
            ],
          },
        ],
      },
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
          { label: 'Multi-Service CLI', slug: 'examples/rust/multi-service' },
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
