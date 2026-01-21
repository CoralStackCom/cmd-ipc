import type { AstroIntegration } from 'astro'
import fg from 'fast-glob'
import * as fs from 'fs/promises'
import yaml from 'js-yaml'
import * as path from 'path'
import type { SidebarItem, SidebarSection } from '../config/sidebar'

const CMD_IPC_DESCRIPTION = `# cmd-ipc Documentation

cmd-ipc is an open-source Inter-Process Communication (IPC) library for TypeScript
that enables type-safe command execution across multiple processes and services.

## Core Benefits

- **Type Safety**: Full TypeScript inference with Valibot schema validation.
- **Multi-Process**: Works with Web Workers, Electron, Node.js worker_threads, and HTTP.
- **Flexible Architecture**: Hybrid Tree-Mesh routing with optional command escalation.
- **Schema Generation**: CLI tool generates TypeScript types from remote services.
- **Event Broadcasting**: Fire-and-forget events across all connected channels.
- **Decorator Support**: Use @Command decorator to register class methods as handlers.

## Documentation Sitemap

`

interface PageInfo {
  slug: string
  label: string
  description?: string
}

interface Frontmatter {
  title?: string
  description?: string
}

/** Parse YAML frontmatter from markdown content */
function parseFrontmatter(content: string, filePath: string): Frontmatter {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}
  try {
    return (yaml.load(match[1]) as Frontmatter) || {}
  } catch (err) {
    throw new Error(`Failed to parse frontmatter in ${filePath}: ${err}`)
  }
}

/** Read a markdown file and extract its frontmatter */
async function readFrontmatter(filePath: string): Promise<Frontmatter> {
  const content = await fs.readFile(filePath, 'utf-8')
  return parseFrontmatter(content, filePath)
}

/** Find a markdown file for a given slug, trying common patterns */
async function findMarkdownFile(sourceDir: string, slug: string): Promise<string | null> {
  const patterns = [`${slug}.{md,mdx}`, `${slug}/index.{md,mdx}`]
  const files = await fg(patterns, { cwd: sourceDir, absolute: true })
  return files[0] || null
}

/** Get all markdown files in a directory (non-recursive) */
async function getMarkdownFiles(dirPath: string): Promise<string[]> {
  const files = await fg('*.{md,mdx}', { cwd: dirPath, absolute: true })
  return files.sort()
}

/** Collect page info by traversing the sidebar configuration */
async function collectPages(sourceDir: string, sidebar: SidebarSection[]): Promise<PageInfo[]> {
  const pages: PageInfo[] = []

  // Add the homepage
  const homePath = await findMarkdownFile(sourceDir, 'index')
  if (homePath) {
    const fm = await readFrontmatter(homePath)
    pages.push({
      slug: '',
      label: fm.title || 'Home',
      description: fm.description,
    })
  }

  async function processAutogenerate(directory: string): Promise<void> {
    const dirPath = path.join(sourceDir, directory)
    try {
      for (const filePath of await getMarkdownFiles(dirPath)) {
        const fm = await readFrontmatter(filePath)
        const fileName = path.basename(filePath).replace(/\.(md|mdx)$/, '')
        const slug = fileName === 'index' ? directory : `${directory}/${fileName}`
        pages.push({
          slug,
          label: fm.title || fileName,
          description: fm.description,
        })
      }
    } catch {
      // Directory doesn't exist, skip
    }
  }

  async function processItem(item: SidebarItem): Promise<void> {
    if (item.slug) {
      const filePath = await findMarkdownFile(sourceDir, item.slug)
      if (filePath) {
        const fm = await readFrontmatter(filePath)
        pages.push({
          slug: item.slug,
          label: item.label,
          description: fm.description,
        })
      }
    }

    if (item.autogenerate) {
      await processAutogenerate(item.autogenerate.directory)
    }

    if (item.items) {
      for (const subItem of item.items) {
        await processItem(subItem)
      }
    }
  }

  async function processSection(section: SidebarSection): Promise<void> {
    if (section.items) {
      for (const item of section.items) {
        await processItem(item)
      }
    }

    if (section.autogenerate) {
      await processAutogenerate(section.autogenerate.directory)
    }
  }

  for (const section of sidebar) {
    await processSection(section)
  }

  return pages
}

/** Generate the llms.txt index content */
function generateLlmsTxt(baseUrl: string, pages: PageInfo[]): string {
  const lines = pages.map((page) => {
    const url = page.slug ? `${baseUrl}${page.slug}.md` : `${baseUrl}index.md`
    const description = page.description ? `: ${page.description}` : ''
    return `- [${page.label}](${url})${description}`
  })
  return CMD_IPC_DESCRIPTION + lines.join('\n') + '\n'
}

/** Copy all markdown files from source to dest, renaming .mdx to .md and flattening index files */
async function copyMarkdownFiles(sourceDir: string, destDir: string): Promise<number> {
  const files = await fg('**/*.{md,mdx}', { cwd: sourceDir })

  for (const file of files) {
    const srcPath = path.join(sourceDir, file)
    // Convert .mdx to .md and flatten index files (e.g., docs/about/index.md -> docs/about.md)
    let destFile = file.replace(/\.mdx$/, '.md')
    destFile = destFile.replace(/\/index\.md$/, '.md')
    const destPath = path.join(destDir, destFile)
    await fs.mkdir(path.dirname(destPath), { recursive: true })
    await fs.copyFile(srcPath, destPath)
  }

  return files.length
}

export interface LlmifyOptions {
  /** Sidebar configuration matching Starlight's sidebar structure */
  sidebar: SidebarSection[]
}

export default function llmifyPlugin(options: LlmifyOptions): AstroIntegration {
  let siteUrl: string
  let basePath: string
  let publicDir: string

  return {
    name: 'llmify',
    hooks: {
      'astro:config:done': ({ config }) => {
        siteUrl = config.site?.toString() ?? ''
        basePath = config.base ?? '/'
        publicDir = config.publicDir.pathname
        if (!siteUrl.endsWith('/')) {
          siteUrl += '/'
        }
        // Append base path to site URL
        if (basePath && basePath !== '/') {
          const base = basePath.startsWith('/') ? basePath.slice(1) : basePath
          siteUrl += base
          if (!siteUrl.endsWith('/')) {
            siteUrl += '/'
          }
        }
      },
      'astro:build:start': async ({ logger }) => {
        // Generate llms.txt to public folder before build so it's included in dist
        const sourceDir = path.resolve('./src/content/docs')
        const pages = await collectPages(sourceDir, options.sidebar)
        // Ensure public directory exists
        await fs.mkdir(publicDir, { recursive: true })
        await fs.writeFile(path.join(publicDir, 'llms.txt'), generateLlmsTxt(siteUrl, pages))
        logger.info(`Generated llms.txt with ${pages.length} pages`)
      },
      'astro:build:done': async ({ dir, logger }) => {
        const sourceDir = path.resolve('./src/content/docs')
        const destDir = dir.pathname

        // Copy markdown files to dist
        const fileCount = await copyMarkdownFiles(sourceDir, destDir)
        logger.info(`Copied ${fileCount} markdown files to dist`)
      },
    },
  }
}
