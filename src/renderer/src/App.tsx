import React, { useEffect, useState } from 'react'
import { FirstRun } from './components/FirstRun'
import { Icon } from './components/Icon'
import { tr, useLang } from './i18n'

const hasApi = typeof window !== 'undefined' && !!window.vr

export function App() {
  useLang()
  const [firstRun, setFirstRun] = useState<boolean | null>(null) // null = loading

  useEffect(() => {
    if (!hasApi) {
      setFirstRun(true) // pure-vite dev → always show for UI work
      return
    }
    window.vr!.settings.get('firstRunDone').then((done) => setFirstRun(done !== true))
  }, [])

  if (firstRun === null) return null
  if (firstRun) return <FirstRun onDone={() => setFirstRun(false)} />

  /* main shell placeholder — library / A/B / analysis land here next */
  return (
    <div className="col" style={{ height: '100%' }}>
      <div className="drag-strip" />
      <div
        className="ph grow"
        style={{ margin: 16, marginTop: 48, borderRadius: 'var(--r-lg)' }}
      >
        <div className="col gap12" style={{ alignItems: 'center' }}>
          <Icon name="wave" style={{ width: 28, height: 28, color: 'var(--text-lo)' }} />
          <span className="ph-cap">{tr('app.emptyLibrary')}</span>
        </div>
      </div>
    </div>
  )
}
