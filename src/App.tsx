import './App.css'

function App() {
  return (
    <div className="shell">
      <header className="hud">
        <h1 className="title">Bat Snap Derby</h1>
        <p className="tagline">
          Pull back the bat, arc baseballs at absurd ballpark targets — carnival
          gallery meets Seattle baseball lore.
        </p>
      </header>

      <main className="playfield" aria-label="Game canvas placeholder">
        <p className="placeholder">
          Game canvas + slingshot mechanic go here (React + Vite, landscape-first).
        </p>
      </main>

      <footer className="footer">
        <p className="disclaimer">
          Unofficial fan-made tribute — not affiliated with MLB, the Seattle
          Mariners, or T-Mobile Park.
        </p>
        <p className="rotate-hint">Best played in landscape on phones.</p>
      </footer>
    </div>
  )
}

export default App
