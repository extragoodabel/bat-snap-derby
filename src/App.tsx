import { GameCanvas } from './GameCanvas'

function App() {
  return (
    <div className="app-page">
      <div className="app-page__row">
        <div className="app-page__game-column">
          {/* Fit probe: same box the framed cabinet must fit in (excludes dev aside). */}
          <div
            id="game-max-fit-rect"
            className="game-max-fit-rect"
            aria-hidden="true"
          />
          <div className="game-cabinet" role="presentation">
            <div className="game-cabinet__navy">
              <div className="game-cabinet__teal">
                <div className="game-cabinet__silver">
                  <div className="game-cabinet__stage">
                    <GameCanvas />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <aside
          id="game-dev-tools-host"
          className="game-dev-aside"
          aria-label="Developer tools"
        />
      </div>
    </div>
  )
}

export default App
