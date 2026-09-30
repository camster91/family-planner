import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

/** `/device` is not a screen of its own; the board is the tablet's home. */
export default function DeviceIndexPage() {
  redirect('/device/today')
}
