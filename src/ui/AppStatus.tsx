import { useState, useSyncExternalStore } from 'react'
import { appState, applyUpdate, install, onAppState } from '../pwa/app'

const useAppState = () => useSyncExternalStore(onAppState, appState)

/** "Install app" in the header, where the browser allows it. */
export function InstallButton() {
  const s = useAppState()
  const [showIos, setShowIos] = useState(false)
  if (s.installed) return null
  if (s.canInstall) {
    return (
      <button className="install-btn quiet sm" onClick={() => void install()} title="Install Popsheet on this device so it opens like an app and works offline">
        <InstallIcon />
        <span>Install app</span>
      </button>
    )
  }
  if (!s.iosHint) return null
  return (
    <div className="install-ios">
      <button className="install-btn quiet sm" aria-expanded={showIos} onClick={() => setShowIos((v) => !v)}>
        <InstallIcon />
        <span>Install app</span>
      </button>
      {showIos && (
        <div className="install-pop panel" role="dialog" aria-label="Install Popsheet">
          <p>
            Tap <b>Share</b> <ShareIcon /> in Safari, then <b>Add to Home Screen</b>.
          </p>
          <p className="muted small">Popsheet then opens from your home screen and works without internet.</p>
          <button className="sm" onClick={() => setShowIos(false)}>
            Got it
          </button>
        </div>
      )}
    </div>
  )
}

/** Tells the teacher a new version is ready, and lets them switch when it suits them. */
export function UpdateNotice() {
  const s = useAppState()
  const [later, setLater] = useState(false)
  if (!s.updateReady || later) return null
  return (
    <div className="update-toast panel" role="status">
      <span>A new version of Popsheet is ready.</span>
      <button className="primary sm" onClick={applyUpdate}>
        Update now
      </button>
      <button className="quiet sm" onClick={() => setLater(true)}>
        Later
      </button>
    </div>
  )
}

function InstallIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2v8M4.8 7 8 10.2 11.2 7M3 13.5h10" />
    </svg>
  )
}

function ShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-label="(the square with an arrow)" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: '-2px' }}>
      <path d="M8 1.8v8.4M5.2 4.4 8 1.6l2.8 2.8M5 6.5H3.5v7.5h9V6.5H11" />
    </svg>
  )
}
