import { Classes } from './ui/Classes'
import { Editor } from './ui/Editor'
import { Grade } from './ui/Grade'
import { Home } from './ui/Home'
import { Print } from './ui/Print'
import { Results } from './ui/Results'
import { Scan } from './ui/Scan'
import { Lock, ScanIcon } from './ui/icons'
import { useRoute } from './ui/nav'

function Logo() {
  return (
    <a className="logo" href="#/" aria-label="Popsheet home">
      <svg width="46" height="22" viewBox="0 0 46 22" aria-hidden="true">
        <circle cx="8" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle className="pop" cx="23" cy="11" r="7.5" fill="#ffd23f" stroke="currentColor" strokeWidth="2" />
        <circle cx="38" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
      <span>Popsheet</span>
    </a>
  )
}

function NavLink({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return (
    <a href={href} className={'navlink' + (on ? ' on' : '')} aria-current={on ? 'page' : undefined}>
      <i className="b" aria-hidden="true" />
      {children}
    </a>
  )
}

export default function App() {
  const route = useRoute()
  let page
  if (route[0] === 'w' && route[1]) {
    if (route[2] === 'print') page = <Print key={route[1]} id={route[1]} />
    else if (route[2] === 'results') page = <Results key={route[1]} id={route[1]} />
    else if (route[2] === 'grade') page = <Grade key={route[1]} id={route[1]} boxId={route[3]} focusCode={route[4]} />
    else page = <Editor key={route[1]} id={route[1]} />
  } else if (route[0] === 'scan') page = <Scan />
  else if (route[0] === 'classes') page = <Classes />
  else page = <Home />

  return (
    <>
      <header className="top">
        <Logo />
        <nav>
          <NavLink href="#/" on={route.length === 0 || route[0] === 'w'}>
            Worksheets
          </NavLink>
          <NavLink href="#/classes" on={route[0] === 'classes'}>
            Classes
          </NavLink>
          <a href="#/scan" className={'btn primary scan-cta' + (route[0] === 'scan' ? ' on' : '')} aria-current={route[0] === 'scan' ? 'page' : undefined}>
            <ScanIcon />
            Scan
          </a>
        </nav>
      </header>
      <main>{page}</main>
      <footer>
        <Lock size={14} />
        Everything stays on this device. Worksheets, names and scans are never uploaded.
      </footer>
    </>
  )
}
