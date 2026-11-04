import { CircleView } from '@/components/CircleView'
import { Help } from '@/components/Help'
import { Landing } from '@/components/Landing'
import { Settings } from '@/components/Settings'
import { Shell } from '@/components/Shell'
import { Workspace } from '@/components/Workspace'
import { TxProvider } from '@/hooks/tx'
import { matchCircle, usePath } from '@/lib/router'

export default function App() {
  const path = usePath().replace(/\/+$/, '') || '/'
  const circleId = matchCircle(path)

  return (
    <TxProvider>
      {path === '/' ? (
        <Landing />
      ) : path === '/help' ? (
        <Help />
      ) : (
        <Shell>{circleId ? <CircleView key={circleId} id={circleId} /> : path === '/app/settings' ? <Settings /> : <Workspace />}</Shell>
      )}
    </TxProvider>
  )
}
