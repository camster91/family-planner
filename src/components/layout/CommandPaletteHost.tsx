'use client'

import * as React from 'react'
import CommandPalette from './CommandPalette'

/**
 * Host that mounts the CommandPalette once and listens for
 * the global 'open-command-palette' event (and the ⌘K shortcut
 * handled inside the palette itself). Lives at the layout level
 * so it overlays every dashboard page.
 */
export default function CommandPaletteHost() {
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => {
    function onOpen() { setOpen(true) }
    document.addEventListener('open-command-palette', onOpen)
    return () => document.removeEventListener('open-command-palette', onOpen)
  }, [])

  return <CommandPalette open={open} onClose={() => setOpen(false)} />
}
