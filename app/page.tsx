import { ClipperProvider } from '@/lib/clipper/provider'
import { AppShell } from '@/components/clipper/app-shell'

export default function Page() {
  return (
    <ClipperProvider>
      <AppShell />
    </ClipperProvider>
  )
}
