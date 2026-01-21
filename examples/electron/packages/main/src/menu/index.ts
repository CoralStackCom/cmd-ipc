import type { MenuItemConstructorOptions } from 'electron'
import { Menu } from 'electron'

import { Environment } from '../utils/environment'
import { DeveloperMenu } from './developer-menu'
import { TestMenu } from './test-menu'

const menuItems: MenuItemConstructorOptions[] = [
  { role: 'fileMenu' },
  { role: 'editMenu' },
  { role: 'viewMenu' },
  { role: 'windowMenu' },
  TestMenu,
  DeveloperMenu,
]

// Add MacOS Specific Menu Items
if (Environment.isMacOS) {
  menuItems.unshift({ role: 'appMenu' })
}

export const menu = Menu.buildFromTemplate(menuItems)
