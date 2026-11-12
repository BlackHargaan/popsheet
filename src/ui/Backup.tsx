import { useRef, useState } from 'react'
import { parseBackup } from '../core/backup'
import type { BackupEntry } from '../core/backup'
import { exportBackup, restoreBackup } from '../store'
import { download } from './files'

export function Backup({ onRestored }: { onRestored: () => void }) {
  const file = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<BackupEntry[] | null>(null)
  const [replace, setReplace] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setMessage('')
    try { await action() } catch (e) { setError(e instanceof Error ? e.message : 'Could not complete the backup operation.') }
    finally { setBusy(false) }
  }
  const count = (prefix: string) => pending?.filter(([k]) => k.startsWith(prefix)).length ?? 0
  return <section className="panel backup-panel" aria-label="Backup and restore">
    <div className="row between"><div><h2>Backup and restore</h2><p className="muted small">Save worksheets, classes, scans and grades in one file. Keep it somewhere private: it contains student data.</p></div>
      <div className="row"><button disabled={busy} onClick={() => void run(async () => {
        download(`popsheet-backup-${new Date().toISOString().slice(0, 10)}.json`, await exportBackup(), 'application/json')
        setMessage('Backup downloaded.')
      })}>Download backup</button><button disabled={busy} onClick={() => file.current?.click()}>Restore backup</button></div></div>
    <input ref={file} type="file" accept="application/json,.json" hidden onChange={e => {
      const picked = e.target.files?.[0]; e.target.value = ''
      if (picked) void run(async () => { setPending(null); setReplace(false); setPending(parseBackup(await picked.text())) })
    }} />
    {pending && <div className="backup-preview">
      <p>Ready to restore {count('ws:')} worksheets, {count('class:')} classes and {count('scan:')} scans, plus saved grades and readings.</p>
      <label className="check"><input type="checkbox" checked={replace} disabled={busy} onChange={e => setReplace(e.target.checked)} />Replace matching worksheets and classes</label>
      <p className="small muted">{replace ? 'Matching worksheets and all of their scans, grades and readings will be replaced with the backup. Other worksheets stay as they are.' : 'Matching worksheets and classes will be skipped, keeping the data already on this device.'}</p>
      <div className="row"><button className="primary" disabled={busy} onClick={() => void run(async () => {
        const count = await restoreBackup(pending, replace)
        setPending(null); setMessage(`Restored ${count} records.`); onRestored()
      })}>{busy ? 'Restoring...' : 'Restore now'}</button><button disabled={busy} onClick={() => setPending(null)}>Cancel</button></div>
    </div>}
    {message && <p role="status">{message}</p>}{error && <p className="error" role="alert">{error}</p>}
  </section>
}
