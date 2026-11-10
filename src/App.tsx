import { Classes } from './ui/Classes'
import { Editor } from './ui/Editor'
import { Home } from './ui/Home'
import { Print } from './ui/Print'
import { Results } from './ui/Results'
import { Scan } from './ui/Scan'
import { useRoute } from './ui/nav'

function Logo() {
  return (
    <a className="logo" href="#/">
      <svg width="46" height="22" viewBox="0 0 46 22" aria-hidden="true">
        <circle cx="8" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="23" cy="11" r="7.5" fill="var(--accent)" stroke="currentColor" strokeWidth="2" />
        <circle cx="38" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
      Popsheet
    </a>
  )
}

export default function App() {
  const route = useRoute()
  let page
  if (route[0] === 'w' && route[1]) {
    if (route[2] === 'print') page = <Print key={route[1]} id={route[1]} />
    else if (route[2] === 'results') page = <Results key={route[1]} id={route[1]} />
    else page = <Editor key={route[1]} id={route[1]} />
  } else if (route[0] === 'scan') page = <Scan />
  else if (route[0] === 'classes') page = <Classes />
  else page = <Home />

  return (
    <>
      <header className="top">
        <Logo />
        <nav>
          <a href="#/" className={route.length === 0 || route[0] === 'w' ? 'on' : ''}>
            Worksheets
          </a>
          <a href="#/classes" className={route[0] === 'classes' ? 'on' : ''}>
            Classes
          </a>
          <a href="#/scan" className={'btn primary' + (route[0] === 'scan' ? ' on' : '')}>
            Scan
          </a>
        </nav>
      </header>
      <main>{page}</main>
      <footer>Everything stays on this device. Worksheets, names and scans are never uploaded.</footer>
    </>
  )
}
