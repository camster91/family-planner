import { I18nProvider } from '@/i18n'
import { HandoffClient } from './HandoffClient'

const printStyles = `
@media print {
  @page { margin: 0.5in; size: letter; }
  body * { visibility: hidden; }
  .print-card, .print-card * { visibility: visible; }
  .print-card { position: fixed; left: 0; top: 0; width: 100%; }
  .no-print { display: none !important; }
}
`

export default async function PublicHandoffPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  return (
    <I18nProvider>
      <style dangerouslySetInnerHTML={{ __html: printStyles }} />
      <HandoffClient token={token} />
    </I18nProvider>
  )
}
