import type { MenuItemConstructorOptions } from 'electron'
import { BrowserWindow, dialog } from 'electron'

import { AppCommandIDs, AppEventIDs, ChannelIDs } from '@examples/electron-core'
import { CommandsRegistryMain } from '../commands/command-registry-main'
import { WindowManager } from '../windows/windows-manager'

export const TestMenu: MenuItemConstructorOptions = {
  label: 'Test',
  submenu: [
    {
      label: 'Test hello.world',
      click: async () => {
        const response = await CommandsRegistryMain.executeCommand(AppCommandIDs.HELLO_WORLD, {
          name: 'main',
        })
        const mainWindow = BrowserWindow.getFocusedWindow()
        dialog.showMessageBox(mainWindow!, {
          type: 'info',
          buttons: ['OK'],
          title: 'Test hello.world',
          message: `Response: ${response.message}`,
        })
      },
    },
    {
      label: 'Increment Counter',
      click: async () => {
        await CommandsRegistryMain.executeCommand(AppCommandIDs.INCREMENT_COUNTER)
      },
    },
    {
      label: 'Test Event',
      click: () => {
        CommandsRegistryMain.emitEvent(AppEventIDs.MAIN_TEST_EVENT, { payload: 'test' })
      },
    },
    {
      label: 'Unregistered Command',
      click: async () => {
        try {
          // @ts-ignore - Intentionally call a fake command to test error handling
          await CommandsRegistryMain.executeCommand('fake.command')
        } catch (error) {
          const mainWindow = BrowserWindow.getFocusedWindow()
          dialog.showMessageBox(mainWindow!, {
            type: 'info',
            buttons: ['OK'],
            title: 'Called Unregistered Command',
            message: `Menu Unregistered Command ${error}`,
          })
        }
      },
    },
    {
      label: 'Show Hidden Processes',
      type: 'checkbox',
      checked: false,
      click: async (item) => {
        const workerWindow = WindowManager.get(ChannelIDs.WORKER)
        if (workerWindow) {
          if (item.checked) {
            workerWindow.show()
            workerWindow.webContents.openDevTools()
          } else {
            workerWindow.hide()
          }
        }
        const sandboxedWindow = WindowManager.get(ChannelIDs.SANDBOX)
        if (sandboxedWindow) {
          if (item.checked) {
            sandboxedWindow.show()
            sandboxedWindow.webContents.openDevTools()
          } else {
            sandboxedWindow.hide()
          }
        }
      },
    },
  ],
}
