const state = {
  view: new URLSearchParams(window.location.search).get("view") || "best",
  sportFilter: "All",
  confidenceFilter: "All",
  snapshot: null,
  picks: [],
  accuracy: null,
  modelLab: null,
  worldCup: null,
  worldCupOdds: null,
  worldCupStageFilter: "All",
  worldCupGroupFilter: "All",
  deferredInstallPrompt: null,
  canInstall: false,
  isStandalone: window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true,
  ledger: JSON.parse(localStorage.getItem("edgelab-ledger") || "[]")
};

const views = [
  ["board", "Board", "calendar"],
  ["worldcup", "World Cup 2026", "globe"],
  ["best", "Best Bets", "target"],
  ["accuracy", "Accuracy", "chart"],
  ["models", "Models", "lab"],
  ["tuning", "Tuning", "sliders"],
  ["ledger", "Bet Ledger", "ticket"],
  ["health", "Data Health", "pulse"]
];

const fmtPct = (value, digits = 1) => `${((value || 0) * 100).toFixed(digits)}%`;
const fmtOdds = (value) => Number.isFinite(value) ? (value > 0 ? `+${Math.round(value)}` : `${Math.round(value)}`) : "-";
const fmtMoney = (value) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}u`;
const app = document.querySelector("#app");

async function loadData() {
  const [snapshot, picks, accuracy, modelLab, worldCup, worldCupOdds] = await Promise.all([
    fetchJson("/api/snapshot"),
    fetchJson("/api/picks"),
    fetchJson("/api/accuracy"),
    fetchJson("/api/model-lab"),
    fetchJson("/api/world-cup-2026?refresh=true"),
    fetchJson("/api/odds/world-cup-2026?refresh=true")
  ]);
  state.snapshot = snapshot;
  state.picks = picks.picks;
  state.accuracy = accuracy.accuracy;
  state.modelLab = modelLab;
  state.worldCup = worldCup;
  state.worldCupOdds = worldCupOdds;
  render();
}

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path} ${response.status}`);
  return response.json();
}

function render() {
  if (!state.snapshot) {
    app.innerHTML = `<main class="loading">Loading EdgeLab Sports...</main>`;
    return;
  }
  app.innerHTML = `
    <div class="shell">
      ${renderSidebar()}
      <main class="main">
        ${renderTopbar()}
        ${renderCurrentView()}
      </main>
    </div>
  `;
  bindEvents();
}

function renderSidebar() {
  return `
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">EL</div>
        <div>
          <strong>EdgeLab</strong>
          <span>Sports model desk</span>
        </div>
      </div>
      <nav>
        ${views.map(([id, label, icon]) => `
          <button class="nav-item ${state.view === id ? "active" : ""}" data-view="${id}" title="${label}">
            ${iconSvg(icon)}
            <span>${label}</span>
          </button>
        `).join("")}
      </nav>
      <div class="side-card">
        <span>Live mode</span>
        <strong>${state.snapshot.live.mode}</strong>
        <small>${state.snapshot.live.lastUpdated ? new Date(state.snapshot.live.lastUpdated).toLocaleTimeString() : "seed fallback"}</small>
      </div>
    </aside>
  `;
}

function renderTopbar() {
  const sports = ["All", ...new Set(state.snapshot.leagues.map((league) => league.sport))];
  if (state.view === "worldcup") {
    const stages = ["All", ...new Set(state.worldCup.matches.map((match) => match.stage))];
    const groups = ["All", ...state.worldCup.groups.map((group) => group.id)];
    return `
      <header class="topbar">
        <div>
          <h1>${viewTitle()}</h1>
          <p>${viewSubtitle()}</p>
        </div>
        <div class="toolbar">
          <select id="worldCupGroupFilter" aria-label="World Cup group filter">
            ${groups.map((group) => `<option ${state.worldCupGroupFilter === group ? "selected" : ""}>${group}</option>`).join("")}
          </select>
          <select id="worldCupStageFilter" aria-label="World Cup stage filter">
            ${stages.map((stage) => `<option ${state.worldCupStageFilter === stage ? "selected" : ""}>${stage}</option>`).join("")}
          </select>
          <button class="icon-button" id="refreshWorldCup" title="Refresh World Cup source data">${iconSvg("refresh")}</button>
          <button class="icon-button" id="refreshWorldCupOdds" title="Refresh and store World Cup odds">${iconSvg("ticket")}</button>
        </div>
      </header>
    `;
  }
  return `
    <header class="topbar">
      <div>
        <h1>${viewTitle()}</h1>
        <p>${viewSubtitle()}</p>
      </div>
      <div class="toolbar">
        <select id="sportFilter" aria-label="Sport filter">
          ${sports.map((sport) => `<option ${state.sportFilter === sport ? "selected" : ""}>${sport}</option>`).join("")}
        </select>
        <select id="confidenceFilter" aria-label="Confidence filter">
          ${["All", "A", "B", "C", "Watch"].map((level) => `<option ${state.confidenceFilter === level ? "selected" : ""}>${level}</option>`).join("")}
        </select>
        ${state.canInstall && !state.isStandalone ? `<button class="install-button" id="installApp" title="Install EdgeLab Sports">Install</button>` : ""}
        <button class="icon-button" id="refreshLive" title="Refresh live scores">${iconSvg("refresh")}</button>
      </div>
    </header>
  `;
}

function viewTitle() {
  return {
    board: "Game Board",
    worldcup: "World Cup 2026",
    best: "Best Bets",
    accuracy: "Accuracy Tracker",
    models: "Model Lab",
    tuning: "Model Tuning",
    ledger: "Bet Ledger",
    health: "Data Health"
  }[state.view];
}

function viewSubtitle() {
  return {
    board: "Live slate, status, prices, totals, rest, and injury signals across covered U.S. leagues.",
    worldcup: "Every match, source-backed fixture data, 3-way soccer probabilities, fair odds, and group outlooks.",
    best: "Recommended picks ranked by expected value after train/test model selection.",
    accuracy: "Overall and sport-level pick accuracy from the latest completed holdout season.",
    models: "Prior seasons train the methods; latest completed season tests fit and calibration.",
    tuning: "Action-model policy, feature weights, league diagnostics, and a worked NBA example.",
    ledger: "Local bankroll journal for recommendations you choose to track.",
    health: "Coverage map, live polling status, and provider readiness."
  }[state.view];
}

function renderCurrentView() {
  if (state.view === "board") return renderBoard();
  if (state.view === "worldcup") return renderWorldCup();
  if (state.view === "accuracy") return renderAccuracy();
  if (state.view === "models") return renderModels();
  if (state.view === "tuning") return renderTuning();
  if (state.view === "ledger") return renderLedger();
  if (state.view === "health") return renderHealth();
  return renderBestBets();
}

function filteredPicks() {
  return state.picks.filter((pick) =>
    (state.sportFilter === "All" || pick.sport === state.sportFilter || pick.league === state.sportFilter) &&
    (state.confidenceFilter === "All" || pick.confidence === state.confidenceFilter)
  );
}

function filteredSlate() {
  return state.snapshot.slate.filter((game) => state.sportFilter === "All" || game.sport === state.sportFilter || game.league === state.sportFilter);
}

function filteredWorldCupMatches() {
  return state.worldCup.matches.filter((match) =>
    (state.worldCupStageFilter === "All" || match.stage === state.worldCupStageFilter) &&
    (state.worldCupGroupFilter === "All" || match.group === state.worldCupGroupFilter)
  );
}

function renderWorldCup() {
  const worldCup = state.worldCup;
  const quality = worldCup.quality;
  const matches = filteredWorldCupMatches();
  const finalCount = worldCup.matches.filter((match) => match.status === "final").length;
  const modeledShare = quality.rowCount ? quality.modeledMatches / quality.rowCount : 0;
  const sourceStamp = quality.sourceAccessedAt ? new Date(quality.sourceAccessedAt).toLocaleString() : "static seed";
  const champion = worldCup.simulation.topChampions[0];
  const topAdvancer = worldCup.simulation.topAdvancers[0];
  const volatileGroup = worldCup.groupDifficulty[0];
  const odds = state.worldCupOdds;
  return `
    <section class="kpi-grid">
      ${kpi("Total matches", quality.rowCount, `${quality.groupMatches} group / ${quality.knockoutMatches} knockout`)}
      ${kpi("Champion favorite", champion.team, fmtPct(champion.championProbability))}
      ${kpi("Safest advancer", topAdvancer.team, fmtPct(topAdvancer.advanceProbability))}
      ${kpi("Volatile group", `Group ${volatileGroup.group}`, `${fmtPct(volatileGroup.upsetRisk)} top-seed risk`)}
      ${kpi("Market edges", odds.summary.edgeCount, `${odds.source.mode} odds source`)}
    </section>
    <section class="content-grid worldcup-layout">
      <div class="panel full market-panel">
        <div class="panel-head"><h2>Live Market Edge</h2><span>${odds.source.mode} / ${odds.summary.oddsEventCount} priced matches</span></div>
        ${renderWorldCupMarketBoard(odds)}
      </div>
      <div class="panel wide">
        <div class="panel-head"><h2>Best Model Leans</h2><span>fair-price board</span></div>
        ${renderWorldCupLeans(worldCup.bestPicks)}
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Tournament Simulation</h2><span>${worldCup.simulation.simulations.toLocaleString()} paths</span></div>
        ${renderTournamentSimulation(worldCup.simulation)}
      </div>
      <div class="panel full">
        <div class="panel-head"><h2>Power & Advancement</h2><span>Monte Carlo tournament odds</span></div>
        ${renderWorldCupPowerTable(worldCup.simulation.teams)}
      </div>
      <div class="panel full">
        <div class="panel-head"><h2>Group Outlook</h2><span>actual points plus model projected points</span></div>
        ${renderWorldCupGroups(worldCup.groupOutlooks)}
      </div>
      <div class="panel wide">
        <div class="panel-head"><h2>Group Difficulty</h2><span>rating depth and top-seed risk</span></div>
        ${renderGroupDifficulty(worldCup.groupDifficulty)}
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Upset Watch</h2><span>underdog fair prices</span></div>
        ${renderUpsetWatch(worldCup.upsetWatch)}
      </div>
      <div class="panel full">
        <div class="panel-head"><h2>Every Match</h2><span>${matches.length} visible / ${worldCup.matches.length} total</span></div>
        ${renderWorldCupTable(matches)}
      </div>
      <div class="panel wide">
        <div class="panel-head"><h2>Data Quality</h2><span>automated checks</span></div>
        ${renderWorldCupQuality(quality)}
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Closing Line Tracker</h2><span>${odds.history.status}</span></div>
        ${renderClosingLineTracker(odds)}
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Model Standard</h2><span>soccer 3-way</span></div>
        ${renderWorldCupModelStandard(worldCup)}
      </div>
      <div class="panel full">
        <div class="panel-head"><h2>Sources</h2><span>${quality.refreshError ? "seed fallback" : `refreshed ${sourceStamp}`}</span></div>
        ${renderWorldCupSources(worldCup.sources)}
      </div>
    </section>
  `;
}

function renderWorldCupLeans(picks) {
  if (!picks.length) return `<div class="empty">No known-participant World Cup fixtures are available for model pricing yet.</div>`;
  return `
    <div class="worldcup-lean-grid">
      ${picks.slice(0, 8).map((pick) => `
        <article class="worldcup-lean">
          <div>
            <span>${escapeHtml(`Match ${pick.matchNo} / ${pick.group ? `Group ${pick.group}` : pick.stage}`)}</span>
            <strong>${escapeHtml(pick.topOutcome.label)}</strong>
            <small>${escapeHtml(pick.homeTeam)} vs ${escapeHtml(pick.awayTeam)}</small>
          </div>
          <div class="lean-metrics">
            ${miniMetric("Prob.", fmtPct(pick.topOutcome.probability))}
            ${miniMetric("Fair", fmtOdds(pick.fairOdds.pick))}
            ${miniMetric("xG", `${pick.expectedGoals.home.toFixed(2)}-${pick.expectedGoals.away.toFixed(2)}`)}
          </div>
          <p>Only bet when a live market price is better than this fair price after vig.</p>
        </article>
      `).join("")}
    </div>
  `;
}

function renderWorldCupMarketBoard(odds) {
  const edges = odds.bestEdges.slice(0, 10);
  return `
    <div class="market-summary-grid">
      ${miniMetric("Odds source", odds.source.mode)}
      ${miniMetric("Priced matches", odds.summary.oddsEventCount)}
      ${miniMetric("Avg. hold", fmtPct(odds.summary.averageHold))}
      ${miniMetric("Max EV", fmtPct(odds.summary.maxExpectedValue))}
      ${miniMetric("Max Kelly", fmtPct(odds.summary.maxKelly))}
    </div>
    ${odds.source.warnings?.length ? `<div class="callout odds-warning"><strong>${escapeHtml(odds.source.provider)}</strong><span>${escapeHtml(odds.source.warnings[0])}</span></div>` : ""}
    ${edges.length ? `
      <div class="table-wrap">
        <table class="market-table">
          <thead>
            <tr><th>Match</th><th>Best Price</th><th>Model</th><th>Book</th><th>Edge</th><th>EV</th><th>Kelly</th><th>Bookmaker</th><th>Hold</th></tr>
          </thead>
          <tbody>
            ${edges.map((edge) => `
              <tr>
                <td><strong>${escapeHtml(edge.matchup)}</strong><small>Match ${edge.matchNo} / ${edge.group ? `Group ${edge.group}` : edge.stage}</small></td>
                <td>${escapeHtml(edge.label)}</td>
                <td>${fmtPct(edge.modelProbability)}<small>fair ${fmtOdds(edge.fairOdds)}</small></td>
                <td>${fmtOdds(edge.bookOdds)}<small>${fmtPct(edge.impliedProbability)} implied</small></td>
                <td class="${edge.edge > 0.03 ? "positive" : ""}">${fmtPct(edge.edge)}</td>
                <td class="${edge.expectedValue > 0 ? "positive" : ""}">${fmtPct(edge.expectedValue)}</td>
                <td>${fmtPct(edge.kelly)}</td>
                <td>${escapeHtml(edge.bookmaker)}</td>
                <td>${Number.isFinite(edge.marketHold) ? fmtPct(edge.marketHold) : "-"}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    ` : `<div class="empty">No positive-EV market prices are available. The model still shows fair odds, but there is no actionable edge at current prices.</div>`}
  `;
}

function renderClosingLineTracker(odds) {
  const history = odds.history;
  const seedDemo = history.status === "seed-demo";
  return `
    <dl class="health-list">
      <div><dt>Snapshots</dt><dd>${history.snapshotCount}</dd></div>
      <div><dt>Latest</dt><dd>${history.latestAt ? new Date(history.latestAt).toLocaleString() : "none"}</dd></div>
      <div><dt>Events tracked</dt><dd>${history.latestEventCount}</dd></div>
      <div><dt>Provider modes</dt><dd>${history.providerModes?.join(", ") || "none"}</dd></div>
    </dl>
    ${history.movement?.length ? `
      <div class="movement-list">
        ${history.movement.slice(0, 5).map((row) => `
          <article>
            <strong>${escapeHtml(row.outcome)}</strong>
            <span>${escapeHtml(row.bookmaker)} / ${fmtOdds(row.previousPrice)} to ${fmtOdds(row.latestPrice)}</span>
            <small>${escapeHtml(row.match)}</small>
          </article>
        `).join("")}
      </div>
    ` : `<div class="callout"><strong>${seedDemo ? "Seed demo only." : "CLV starts now."}</strong><span>${seedDemo ? "Connect ODDS_API_KEY to turn these stored snapshots into real closing-line evidence." : "Use the ticket refresh button to store odds snapshots. Once games close, this history becomes your closing-line value layer."}</span></div>`}
  `;
}

function renderWorldCupModelStandard(worldCup) {
  return `
    <div class="step-list">
      ${worldCup.modelSpec.methods.slice(0, 5).map((method, idx) => `
        <div><strong>${idx + 1}</strong><span>${escapeHtml(method)}</span></div>
      `).join("")}
    </div>
    <div class="callout">
      <strong>${escapeHtml(worldCup.modelSpec.name)}</strong>
      <span>${escapeHtml(worldCup.modelSpec.limitations[0])}</span>
    </div>
  `;
}

function renderTournamentSimulation(simulation) {
  return `
    <div class="simulation-card">
      <div class="sim-leader">
        <span>Champion leader</span>
        <strong>${escapeHtml(simulation.topChampions[0].team)}</strong>
        <small>${fmtPct(simulation.topChampions[0].championProbability)} title probability</small>
      </div>
      <div class="bar-list compact-bars">
        ${simulation.topChampions.slice(0, 7).map((team) => `
          <div class="bar-row">
            <span>${escapeHtml(team.team)}</span>
            <div class="bar-track"><i style="width:${Math.max(4, team.championProbability / simulation.topChampions[0].championProbability * 100)}%"></i></div>
            <strong>${fmtPct(team.championProbability)}</strong>
          </div>
        `).join("")}
      </div>
      <div class="callout">
        <strong>Reproducible seed ${simulation.seed}</strong>
        <span>Completed matches are fixed; unplayed matches are sampled from the model's expected-goals distribution.</span>
      </div>
    </div>
  `;
}

function renderWorldCupPowerTable(teams) {
  const rows = [...teams].sort((a, b) => b.championProbability - a.championProbability).slice(0, 18);
  return `
    <div class="table-wrap">
      <table class="power-table">
        <thead>
          <tr><th>Team</th><th>Group</th><th>Rating</th><th>Exp. Pts</th><th>Top 2</th><th>Advance</th><th>QF</th><th>SF</th><th>Final</th><th>Title</th></tr>
        </thead>
        <tbody>
          ${rows.map((team, idx) => `
            <tr>
              <td><strong>${idx + 1}. ${escapeHtml(team.team)}</strong></td>
              <td>${team.group}</td>
              <td>${Math.round(team.rating)}</td>
              <td>${team.expectedGroupPoints.toFixed(1)}</td>
              <td>${fmtPct(team.topTwoProbability)}</td>
              <td>${fmtPct(team.advanceProbability)}</td>
              <td>${fmtPct(team.quarterfinalProbability)}</td>
              <td>${fmtPct(team.semifinalProbability)}</td>
              <td>${fmtPct(team.finalProbability)}</td>
              <td><span class="grade grade-${team.championProbability > 0.08 ? "a" : team.championProbability > 0.04 ? "b" : "watch"}">${fmtPct(team.championProbability)}</span></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderGroupDifficulty(groups) {
  return `
    <div class="difficulty-grid">
      ${groups.slice(0, 6).map((group) => `
        <article class="difficulty-card">
          <div>
            <span>Group ${group.group}</span>
            <strong>${escapeHtml(group.favorite)}</strong>
            <small>${fmtPct(group.upsetRisk)} favorite top-two risk</small>
          </div>
          <div class="mini-bars">
            ${group.teams.map((team) => `
              <div>
                <span>${escapeHtml(team.team)}</span>
                <i style="width:${Math.max(5, team.advanceProbability * 100)}%"></i>
                <strong>${fmtPct(team.advanceProbability, 0)}</strong>
              </div>
            `).join("")}
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function renderUpsetWatch(rows) {
  if (!rows.length) return `<div class="empty">No high-probability underdog spots clear the current upset threshold.</div>`;
  return `
    <div class="upset-list">
      ${rows.slice(0, 6).map((row) => `
        <article>
          <span>Match ${row.matchNo} / Group ${row.group}</span>
          <strong>${escapeHtml(row.underdog)}</strong>
          <small>vs ${escapeHtml(row.favorite)} / ${fmtPct(row.probability)} / fair ${fmtOdds(row.fairOdds)}</small>
        </article>
      `).join("")}
    </div>
  `;
}

function renderWorldCupTable(matches) {
  return `
    <div class="table-wrap">
      <table class="worldcup-table">
        <thead>
          <tr>
            <th>Match</th>
            <th>Date</th>
            <th>Stage</th>
            <th>Fixture</th>
            <th>Status</th>
            <th>Venue</th>
            <th>Model</th>
            <th>Fair</th>
            <th>Quality</th>
          </tr>
        </thead>
        <tbody>
          ${matches.map((match) => `
            <tr>
              <td><strong>${match.matchNo}</strong></td>
              <td>${escapeHtml(formatWorldCupDate(match))}</td>
              <td>${escapeHtml(match.group ? `Group ${match.group}` : match.stage)}</td>
              <td><strong>${escapeHtml(match.homeTeam)} vs ${escapeHtml(match.awayTeam)}</strong><small>${escapeHtml(match.timeLocal)}</small></td>
              <td>${match.score ? escapeHtml(match.score) : escapeHtml(match.status)}</td>
              <td>${escapeHtml(match.venue)}<small>${escapeHtml(match.city)}</small></td>
              <td>${match.topOutcome ? `${escapeHtml(match.topOutcome.label)}<small>${fmtPct(match.topOutcome.probability)} / ${match.confidence}</small>` : "<small>pending participants</small>"}</td>
              <td>${match.fairOdds ? fmtOdds(match.fairOdds.pick) : "-"}</td>
              <td><span class="grade grade-${match.confidence.toLowerCase()}">${fmtPct(match.dataQualityScore, 0)}</span></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderWorldCupGroups(groupOutlooks) {
  return `
    <div class="worldcup-group-grid">
      ${groupOutlooks.map((group) => `
        <article class="worldcup-group-card">
          <h3>Group ${group.group}</h3>
          <table>
            <thead><tr><th>Team</th><th>Pts</th><th>Proj.</th><th>GD</th></tr></thead>
            <tbody>
              ${group.standings.map((row) => `
                <tr>
                  <td><strong>${escapeHtml(row.team)}</strong><small>${row.played} played</small></td>
                  <td>${row.points}</td>
                  <td>${row.projectedTotal.toFixed(1)}</td>
                  <td>${row.goalDifference > 0 ? "+" : ""}${row.goalDifference}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </article>
      `).join("")}
    </div>
  `;
}

function renderWorldCupQuality(quality) {
  return `
    <div class="quality-grid">
      ${quality.checks.map((check) => `
        <article class="quality-check ${check.status}">
          <strong>${escapeHtml(check.name)}</strong>
          <span>${escapeHtml(check.status)}</span>
          <p>${escapeHtml(check.detail)}</p>
        </article>
      `).join("")}
    </div>
    ${quality.refreshError ? `<div class="error-box"><p>${escapeHtml(quality.refreshError)}</p></div>` : ""}
  `;
}

function renderWorldCupSources(sources) {
  return `
    <div class="source-list">
      ${sources.map((source) => `
        <a href="${escapeAttribute(source.url)}" target="_blank" rel="noreferrer">
          <strong>${escapeHtml(source.title)}</strong>
          <span>${escapeHtml(source.role)}</span>
        </a>
      `).join("")}
    </div>
  `;
}

function renderBestBets() {
  const picks = filteredPicks();
  const recommended = state.accuracy.recommended;
  const exposure = picks.reduce((sum, pick) => sum + pick.kelly, 0);
  return `
    <section class="kpi-grid">
      ${kpi("Holdout accuracy", fmtPct(recommended.accuracy), `${recommended.wins}-${recommended.losses} recommended`)}
      ${kpi("Expected value", fmtPct(avg(picks, "expectedValue")), "average current board EV")}
      ${kpi("Kelly exposure", fmtPct(exposure), "quarter-Kelly capped")}
      ${kpi("Calibration error", fmtPct(state.accuracy.overall.calibrationError), "lower is better")}
      ${kpi("Best fit", state.modelLab.aggregate[0].name, `log loss ${state.modelLab.aggregate[0].logLoss.toFixed(3)}`)}
    </section>
    <section class="content-grid">
      <div class="panel full">
        <div class="panel-head">
          <h2>Recommended Picks</h2>
          <span>${picks.length} active edges</span>
        </div>
        ${renderPicksTable(picks)}
      </div>
      <aside class="panel">
        <div class="panel-head">
          <h2>Model Stack</h2>
          <span>tested blend</span>
        </div>
        ${renderModelStack()}
      </aside>
      <div class="panel">
        <div class="panel-head"><h2>Edge by League</h2><span>current slate</span></div>
        ${barList(groupAverage(picks, "league", "edge"), "edge")}
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Probability Range</h2><span>pick confidence</span></div>
        ${barList(picks.map((pick) => ({ name: pick.pick, value: pick.modelWinProbability })).slice(0, 7), "probability")}
      </div>
    </section>
  `;
}

function renderPicksTable(picks) {
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Game</th>
            <th>Market</th>
            <th>Pick</th>
            <th>Model</th>
            <th>Fair</th>
            <th>Book</th>
            <th>Edge</th>
            <th>Kelly</th>
            <th>Conf.</th>
            <th>Risk</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${picks.map((pick) => `
            <tr>
              <td><strong>${pick.matchup}</strong><small>${pick.league} · ${formatDate(pick.gameTime)} · ${pick.status} · ${escapeHtml(sourceLabel(pick))}</small></td>
              <td>${pick.market}</td>
              <td>${pick.pick}</td>
              <td>${fmtPct(pick.modelWinProbability)}<small>${pick.model}</small></td>
              <td>${fmtOdds(pick.fairOdds)}</td>
              <td>${fmtOdds(pick.bookOdds)}</td>
              <td class="${pick.edge > 0.04 ? "positive" : ""}">${fmtPct(pick.edge)}</td>
              <td>${fmtPct(pick.kelly)}</td>
              <td><span class="grade grade-${pick.confidence.toLowerCase()}">${pick.confidence}</span></td>
              <td>${pick.riskFlags.map((flag) => `<span class="flag">${flag}</span>`).join("")}</td>
              <td><button class="mini-button" data-add-pick="${pick.id}">Track</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderBoard() {
  const games = filteredSlate();
  return `
    <section class="panel full">
      <div class="panel-head">
        <h2>Covered Games</h2>
        <span>${games.length} games · ${state.snapshot.live.mode}</span>
      </div>
      <div class="game-grid">
        ${games.map((game) => `
          <article class="game-card">
            <div class="game-card-head">
              <span>${game.league}</span>
              <strong>${game.status}</strong>
            </div>
            <h3>${game.awayTeam} at ${game.homeTeam}</h3>
            <div class="score-line">
              <span>${Number.isFinite(game.awayScore) ? game.awayScore : "-"}</span>
              <small>${formatDate(game.gameTime)}</small>
              <span>${Number.isFinite(game.homeScore) ? game.homeScore : "-"}</span>
            </div>
            <dl>
              <div><dt>Moneyline</dt><dd>${fmtOdds(game.awayMoneyline)} / ${fmtOdds(game.homeMoneyline)}</dd></div>
              <div><dt>Total</dt><dd>${game.total}</dd></div>
              <div><dt>Spread</dt><dd>${game.spread}</dd></div>
              <div><dt>Risk</dt><dd>${fmtPct(Math.max(game.injurySignalHome, game.injurySignalAway))}</dd></div>
              <div><dt>Source</dt><dd>${escapeHtml(sourceLabel(game))}</dd></div>
            </dl>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function renderAccuracy() {
  const overall = state.accuracy.overall;
  const recommended = state.accuracy.recommended;
  return `
    <section class="kpi-grid">
      ${kpi("Overall accuracy", fmtPct(overall.accuracy), `${overall.picks} holdout games`)}
      ${kpi("Recommended accuracy", fmtPct(recommended.accuracy), `${recommended.picks} positive-EV plays`)}
      ${kpi("Recommended ROI", fmtMoney(recommended.roi), "flat 1u historical simulation")}
      ${kpi("Brier score", overall.brier.toFixed(3), "probability error")}
      ${kpi("Log loss", overall.logLoss.toFixed(3), "fit quality")}
    </section>
    <section class="content-grid">
      <div class="panel wide">
        <div class="panel-head"><h2>Accuracy by Sport</h2><span>holdout season</span></div>
        ${summaryTable(state.accuracy.bySport)}
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Accuracy by League</h2><span>diagnostics</span></div>
        ${barList(state.accuracy.byLeague.map((row) => ({ name: row.name, value: row.accuracy })), "accuracy")}
      </div>
    </section>
  `;
}

function renderModels() {
  const aggregate = state.modelLab.aggregate;
  return `
    <section class="content-grid">
      <div class="panel wide">
        <div class="panel-head"><h2>Train/Test Best Fit</h2><span>prior seasons train · latest completed season test</span></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Method</th><th>Games</th><th>Log loss</th><th>Brier</th><th>Accuracy</th><th>Calibration</th></tr></thead>
            <tbody>
              ${aggregate.map((row) => `
                <tr>
                  <td><strong>${methodName(row.name)}</strong></td>
                  <td>${row.games}</td>
                  <td>${row.logLoss.toFixed(3)}</td>
                  <td>${row.brier.toFixed(3)}</td>
                  <td>${fmtPct(row.accuracy)}</td>
                  <td>${fmtPct(row.calibrationError)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>League Splits</h2><span>selected model</span></div>
        ${state.accuracy.bestFitByLeague.map((row) => `
          <div class="model-row">
            <strong>${row.league}</strong>
            <span>${methodName(row.actionModel || row.bestModel)} action</span>
            <small>benchmark ${methodName(row.benchmarkModel || row.bestModel)} · train ${row.trainSeasons.join(", ")} · test ${row.testSeason} · ${fmtPct(row.bestAccuracy)}</small>
          </div>
        `).join("")}
      </div>
      <div class="panel wide">
        <div class="panel-head"><h2>Methods Included</h2><span>professional terminology</span></div>
        <div class="method-grid">
          ${[
            ["Elo", "Team-strength rating with margin-adjusted postgame updates."],
            ["Poisson score model", "Expected scoring distribution converted to win probability."],
            ["Bayesian form", "Win-rate and recent-margin signal shrunk toward league average."],
            ["Market prior", "No-vig sportsbook probability used as a strong baseline."],
            ["Logistic stack", "Supervised blend fit on historical pregame features."],
            ["Ensemble", "Weighted blend where lower holdout log loss earns more influence."]
          ].map(([title, body]) => `<article><strong>${title}</strong><p>${body}</p></article>`).join("")}
        </div>
      </div>
    </section>
  `;
}

function renderTuning() {
  const leagueRows = state.accuracy.bestFitByLeague.map((row) => ({
    ...row,
    model: state.modelLab.models[row.league]
  }));
  const actionCounts = countBy(leagueRows, (row) => row.actionModel || row.bestModel);
  const okcPick = state.picks.find((pick) => pick.matchup.includes("Oklahoma City Thunder")) ||
    state.picks.find((pick) => pick.league === "NBA") ||
    state.picks[0];
  const nbaModel = state.modelLab.models.NBA;
  const nbaMetrics = nbaModel?.metrics ?? [];
  const nbaLogistic = nbaMetrics.find((metric) => metric.name === "logistic");
  const nbaBenchmark = nbaMetrics.find((metric) => metric.name === nbaModel?.benchmarkModel);
  return `
    <section class="kpi-grid">
      ${kpi("Action models", Object.entries(actionCounts).map(([name, count]) => `${count} ${methodName(name)}`).join(" / "), "market prior excluded")}
      ${kpi("NBA action", methodName(nbaModel?.actionModel), `benchmark ${methodName(nbaModel?.benchmarkModel)}`)}
      ${kpi("NBA log loss", nbaLogistic ? nbaLogistic.logLoss.toFixed(3) : "-", "logistic holdout")}
      ${kpi("NBA benchmark", nbaBenchmark ? nbaBenchmark.logLoss.toFixed(3) : "-", "lowest pure metric")}
      ${kpi("Shrink rule", "28-48%", "toward no-vig market")}
    </section>
    <section class="content-grid">
      <div class="panel full">
        <div class="panel-head">
          <h2>Action vs Benchmark</h2>
          <span>tuning policy by league</span>
        </div>
        ${renderTuningTable(leagueRows)}
      </div>
      <div class="panel wide">
        <div class="panel-head">
          <h2>OKC Thunder Example</h2>
          <span>${okcPick ? okcPick.league : "NBA"} pick decomposition</span>
        </div>
        ${renderOkcExample(okcPick, nbaModel)}
      </div>
      <div class="panel">
        <div class="panel-head">
          <h2>NBA Logistic Weights</h2>
          <span>feature direction</span>
        </div>
        ${renderWeights(nbaModel?.logisticWeights)}
      </div>
      <div class="panel">
        <div class="panel-head">
          <h2>Tuning Rules</h2>
          <span>current policy</span>
        </div>
        <div class="step-list">
          <div><strong>1</strong><span>Train on 2022-2024 seasons, test on 2025 holdout games.</span></div>
          <div><strong>2</strong><span>Keep market prior as a benchmark and feature, never as the action model.</span></div>
          <div><strong>3</strong><span>Prefer logistic when it is within 0.05 log loss and 0.05 calibration of ensemble.</span></div>
          <div><strong>4</strong><span>Shrink final probabilities back toward no-vig market to control overconfidence.</span></div>
          <div><strong>5</strong><span>Cap quarter-Kelly stake sizing and flag model-market gaps.</span></div>
        </div>
      </div>
      <div class="panel wide">
        <div class="panel-head">
          <h2>League Insight Board</h2>
          <span>where the model is confident or fragile</span>
        </div>
        <div class="insight-grid">
          ${leagueRows.map((row) => renderLeagueInsight(row)).join("")}
        </div>
      </div>
    </section>
  `;
}

function renderTuningTable(rows) {
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>League</th><th>Action</th><th>Benchmark</th><th>Train</th><th>Test</th><th>Best log loss</th><th>Accuracy</th><th>Calibration</th></tr>
        </thead>
        <tbody>
          ${rows.map((row) => {
            const metric = row.model?.metrics?.[0];
            return `
              <tr>
                <td><strong>${row.league}</strong></td>
                <td>${methodName(row.actionModel || row.bestModel)}</td>
                <td>${methodName(row.benchmarkModel || row.bestModel)}</td>
                <td>${row.trainSeasons.join(", ")}</td>
                <td>${row.testSeason}</td>
                <td>${row.bestLogLoss.toFixed(3)}</td>
                <td>${fmtPct(row.bestAccuracy)}</td>
                <td>${metric ? fmtPct(metric.calibrationError) : "-"}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderOkcExample(pick, nbaModel) {
  if (!pick) return `<div class="empty">No NBA pick is available in the current slate.</div>`;
  const marketProbability = pick.modelWinProbability - pick.edge;
  const sideProbability = pick.pickSide === "home" ? pick.homeProbability : pick.awayProbability;
  const benchmark = nbaModel?.benchmarkModel ?? "market";
  const action = nbaModel?.actionModel ?? pick.model;
  return `
    <div class="example-card">
      <div>
        <span class="eyebrow">${pick.matchup}</span>
        <h3>${pick.pick} ${pick.market}</h3>
        <p>${methodName(action)} is the action model while ${methodName(benchmark)} remains the benchmark comparator.</p>
      </div>
      <div class="example-metrics">
        ${miniMetric("Action prob", fmtPct(sideProbability))}
        ${miniMetric("Market prob", fmtPct(marketProbability))}
        ${miniMetric("Edge", fmtPct(pick.edge))}
        ${miniMetric("Fair odds", fmtOdds(pick.fairOdds))}
        ${miniMetric("Book odds", fmtOdds(pick.bookOdds))}
        ${miniMetric("Confidence", pick.confidence)}
      </div>
      <div class="step-list compact">
        <div><strong>A</strong><span>Pregame features feed Elo, Poisson, Bayesian form, market prior, rest, and injury signals.</span></div>
        <div><strong>B</strong><span>The logistic stack converts those feature logits into a supervised NBA probability.</span></div>
        <div><strong>C</strong><span>The probability is shrunk toward the no-vig market, then compared to book odds for edge.</span></div>
        <div><strong>D</strong><span>Kelly stake and risk flags are calculated only after the tuned action probability clears the edge filter.</span></div>
      </div>
    </div>
  `;
}

function renderWeights(weights = []) {
  const labels = ["Intercept", "Elo", "Poisson", "Bayesian", "Market", "Rest", "Injury"];
  if (!weights.length) return `<div class="empty">No NBA weights available.</div>`;
  const max = Math.max(...weights.map((weight) => Math.abs(weight)), 0.01);
  return `
    <div class="weight-list">
      ${weights.map((weight, idx) => `
        <div class="weight-row">
          <span>${labels[idx] || `Feature ${idx}`}</span>
          <div class="weight-track">
            <i class="${weight >= 0 ? "positive-weight" : "negative-weight"}" style="width:${Math.max(4, Math.abs(weight) / max * 100)}%"></i>
          </div>
          <strong>${weight.toFixed(3)}</strong>
        </div>
      `).join("")}
    </div>
  `;
}

function renderLeagueInsight(row) {
  const action = row.actionModel || row.bestModel;
  const benchmark = row.benchmarkModel || row.bestModel;
  const metric = row.model?.metrics?.find((item) => item.name === action) ?? row.model?.metrics?.[0];
  const benchmarkMetric = row.model?.metrics?.find((item) => item.name === benchmark);
  const delta = metric && benchmarkMetric ? metric.logLoss - benchmarkMetric.logLoss : 0;
  const tone = delta <= 0.02 ? "stable" : delta <= 0.06 ? "watch" : "fragile";
  return `
    <article class="insight-card ${tone}">
      <strong>${row.league}</strong>
      <span>${methodName(action)} action</span>
      <small>benchmark ${methodName(benchmark)} / delta ${delta.toFixed(3)} / ${row.testGames} test games</small>
    </article>
  `;
}

function renderLedger() {
  const open = state.ledger.filter((bet) => bet.result === "pending").length;
  const settled = state.ledger.filter((bet) => bet.result !== "pending");
  const profit = settled.reduce((sum, bet) => sum + Number(bet.profit || 0), 0);
  return `
    <section class="kpi-grid">
      ${kpi("Tracked bets", state.ledger.length, `${open} open`)}
      ${kpi("Settled P/L", fmtMoney(profit), "browser-local ledger")}
      ${kpi("Ledger accuracy", fmtPct(settled.length ? settled.filter((bet) => bet.result === "win").length / settled.length : 0), `${settled.length} settled`)}
      ${kpi("Average stake", `${avg(state.ledger, "stake").toFixed(2)}u`, "recommended quarter-Kelly")}
      ${kpi("Storage", "Local", "no cloud sync")}
    </section>
    <section class="panel full">
      <div class="panel-head"><h2>Tracked Picks</h2><button class="mini-button" id="clearLedger">Clear Ledger</button></div>
      ${state.ledger.length ? `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Game</th><th>Pick</th><th>Odds</th><th>Stake</th><th>Edge</th><th>Status</th><th>P/L</th></tr></thead>
            <tbody>${state.ledger.map((bet) => `
              <tr>
                <td><strong>${bet.matchup}</strong><small>${bet.league} · ${formatDate(bet.gameTime)}</small></td>
                <td>${bet.pick}</td>
                <td>${fmtOdds(bet.bookOdds)}</td>
                <td>${Number(bet.stake).toFixed(2)}u</td>
                <td>${fmtPct(bet.edge)}</td>
                <td>${bet.result}</td>
                <td>${fmtMoney(Number(bet.profit || 0))}</td>
              </tr>
            `).join("")}</tbody>
          </table>
        </div>
      ` : `<div class="empty">Track a pick from Best Bets to start a local bankroll journal.</div>`}
    </section>
  `;
}

function renderHealth() {
  const live = state.snapshot.live;
  const freshness = live.freshness ?? {
    liveLeagues: [],
    staleSeedGames: 0,
    policy: "Live freshness policy unavailable on this build."
  };
  return `
    <section class="content-grid">
      <div class="panel">
        <div class="panel-head"><h2>Live Results</h2><span>${live.mode}</span></div>
        <dl class="health-list">
          <div><dt>Enabled</dt><dd>${live.enabled}</dd></div>
          <div><dt>Poll interval</dt><dd>${live.pollSeconds}s</dd></div>
          <div><dt>Last update</dt><dd>${live.lastUpdated || "seed fallback"}</dd></div>
          <div><dt>Live events</dt><dd>${live.scoreboard.length}</dd></div>
          <div><dt>Live leagues</dt><dd>${freshness.liveLeagues.join(", ") || "none"}</dd></div>
          <div><dt>Stale seed removed</dt><dd>${freshness.staleSeedGames}</dd></div>
        </dl>
        <p class="health-note">${escapeHtml(freshness.policy)}</p>
        ${live.errors.length ? `<div class="error-box">${live.errors.slice(0, 4).map((error) => `<p>${error.league || "live"}: ${error.message}</p>`).join("")}</div>` : ""}
      </div>
      <div class="panel wide">
        <div class="panel-head"><h2>League Coverage</h2><span>major U.S. sports</span></div>
        <div class="coverage-grid">
          ${state.snapshot.leagues.map((league) => `
            <article>
              <strong>${league.name}</strong>
              <span>${league.sport} · ${league.activeMonths}</span>
              <small>${league.historicalGames} historical games · ${league.currentGames} current slate · ${league.conferences.join(", ")}</small>
            </article>
          `).join("")}
        </div>
      </div>
      <div class="panel wide">
        <div class="panel-head"><h2>Provider Path</h2><span>production upgrade</span></div>
        <div class="method-grid">
          <article><strong>Scores</strong><p>ESPN adapter is wired for live polling. Commercial feeds can replace it behind the same API.</p></article>
          <article><strong>Odds</strong><p>Add The Odds API, SportsData.io, OddsJam, or sportsbook feeds for live and closing prices.</p></article>
          <article><strong>History</strong><p>Load prior-season results and closing lines into the same game schema to train on real historical seasons.</p></article>
          <article><strong>Settlement</strong><p>Final live scores update pick status and support overall, sport, and league accuracy analytics.</p></article>
        </div>
      </div>
    </section>
  `;
}

function renderModelStack() {
  const best = state.modelLab.aggregate[0];
  return `
    <div class="stack">
      ${state.modelLab.aggregate.map((row, idx) => `
        <div>
          <span>${methodName(row.name)}</span>
          <strong>${row.logLoss.toFixed(3)}</strong>
          <div class="meter"><i style="width:${Math.max(6, 100 - row.logLoss * 110)}%"></i></div>
        </div>
      `).join("")}
    </div>
    <div class="callout">
      <strong>${methodName(best.name)} currently wins best fit.</strong>
      <span>Selection is based on holdout log loss, with Brier and calibration shown as risk diagnostics.</span>
    </div>
  `;
}

function kpi(label, value, detail) {
  return `<article class="kpi"><span>${label}</span><strong>${value}</strong><small>${detail}</small></article>`;
}

function miniMetric(label, value) {
  return `<div><span>${label}</span><strong>${value}</strong></div>`;
}

function summaryTable(rows) {
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Sport</th><th>Picks</th><th>Wins</th><th>Losses</th><th>Accuracy</th><th>ROI</th><th>Log loss</th></tr></thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td><strong>${row.name}</strong></td>
              <td>${row.picks}</td>
              <td>${row.wins}</td>
              <td>${row.losses}</td>
              <td>${fmtPct(row.accuracy)}</td>
              <td class="${row.roi > 0 ? "positive" : ""}">${fmtMoney(row.roi)}</td>
              <td>${row.logLoss.toFixed(3)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function barList(rows, mode) {
  const max = Math.max(...rows.map((row) => Math.abs(row.value)), 0.01);
  return `<div class="bar-list">
    ${rows.map((row) => `
      <div class="bar-row">
        <span>${row.name}</span>
        <div class="bar-track"><i style="width:${Math.max(5, Math.abs(row.value) / max * 100)}%"></i></div>
        <strong>${mode === "probability" || mode === "accuracy" || mode === "edge" ? fmtPct(row.value) : row.value.toFixed(2)}</strong>
      </div>
    `).join("")}
  </div>`;
}

function groupAverage(rows, groupKey, valueKey) {
  const groups = new Map();
  rows.forEach((row) => {
    const group = row[groupKey];
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(row[valueKey]);
  });
  return [...groups.entries()].map(([name, values]) => ({
    name,
    value: values.reduce((sum, value) => sum + value, 0) / values.length
  })).sort((a, b) => b.value - a.value);
}

function avg(rows, key) {
  if (!rows.length) return 0;
  return rows.reduce((sum, row) => sum + Number(row[key] || 0), 0) / rows.length;
}

function countBy(rows, accessor) {
  return rows.reduce((counts, row) => {
    const key = accessor(row) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function formatDate(value) {
  return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function sourceLabel(row = {}) {
  if (row.source === "live-espn") {
    if (row.dataFreshness === "live-schedule") return "ESPN live schedule";
    if (row.dataFreshness === "final") return "ESPN final";
    if (row.dataFreshness === "live") return "ESPN live";
    return "ESPN live feed";
  }
  if (row.source === "seed-current" || row.dataFreshness === "seed-fallback") return "Seed fallback";
  if (row.source === "stale-seed" || row.dataFreshness === "stale") return "Stale seed";
  return row.source || "unknown";
}

function formatWorldCupDate(match) {
  if (!match.date) return "TBD";
  return new Date(`${match.date}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric" });
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}

function escapeAttribute(value = "") {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function methodName(name) {
  return {
    elo: "Elo",
    poisson: "Poisson",
    bayesian: "Bayesian form",
    market: "Market prior",
    logistic: "Logistic stack",
    ensemble: "Ensemble"
  }[name] || name;
}

function addToLedger(pickId) {
  const pick = state.picks.find((row) => row.id === pickId);
  if (!pick || state.ledger.some((bet) => bet.id === pick.id)) return;
  const stake = Math.max(0.1, Math.round(pick.kelly * 100) / 10);
  const bet = {
    ...pick,
    stake,
    result: pick.result,
    profit: pick.result === "win"
      ? stake * (pick.bookOdds > 0 ? pick.bookOdds / 100 : 100 / Math.abs(pick.bookOdds))
      : pick.result === "loss" ? -stake : 0,
    trackedAt: new Date().toISOString()
  };
  state.ledger.unshift(bet);
  saveLedger();
  state.view = "ledger";
  render();
}

function saveLedger() {
  localStorage.setItem("edgelab-ledger", JSON.stringify(state.ledger));
}

async function refreshLive() {
  await fetchJson("/api/live/scoreboard?refresh=true");
  await loadData();
}

async function refreshWorldCup() {
  state.worldCup = await fetchJson("/api/world-cup-2026?refresh=true");
  state.worldCupOdds = await fetchJson("/api/odds/world-cup-2026");
  render();
}

async function refreshWorldCupOdds() {
  state.worldCupOdds = await fetchJson("/api/odds/world-cup-2026?refresh=true&persist=true");
  render();
}

function bindEvents() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      history.replaceState(null, "", `/?view=${state.view}`);
      render();
    });
  });
  document.querySelector("#sportFilter")?.addEventListener("change", (event) => {
    state.sportFilter = event.target.value;
    render();
  });
  document.querySelector("#confidenceFilter")?.addEventListener("change", (event) => {
    state.confidenceFilter = event.target.value;
    render();
  });
  document.querySelector("#worldCupGroupFilter")?.addEventListener("change", (event) => {
    state.worldCupGroupFilter = event.target.value;
    render();
  });
  document.querySelector("#worldCupStageFilter")?.addEventListener("change", (event) => {
    state.worldCupStageFilter = event.target.value;
    render();
  });
  document.querySelector("#refreshLive")?.addEventListener("click", refreshLive);
  document.querySelector("#refreshWorldCup")?.addEventListener("click", refreshWorldCup);
  document.querySelector("#refreshWorldCupOdds")?.addEventListener("click", refreshWorldCupOdds);
  document.querySelector("#installApp")?.addEventListener("click", installApp);
  document.querySelectorAll("[data-add-pick]").forEach((button) => {
    button.addEventListener("click", () => addToLedger(button.dataset.addPick));
  });
  document.querySelector("#clearLedger")?.addEventListener("click", () => {
    state.ledger = [];
    saveLedger();
    render();
  });
}

async function installApp() {
  if (!state.deferredInstallPrompt) return;
  state.deferredInstallPrompt.prompt();
  await state.deferredInstallPrompt.userChoice.catch(() => null);
  state.deferredInstallPrompt = null;
  state.canInstall = false;
  render();
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  state.deferredInstallPrompt = event;
  state.canInstall = true;
  render();
});

window.addEventListener("appinstalled", () => {
  state.deferredInstallPrompt = null;
  state.canInstall = false;
  state.isStandalone = true;
  render();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

function iconSvg(name) {
  const icons = {
    calendar: `<svg viewBox="0 0 24 24"><path d="M7 3v3M17 3v3M4 9h16M5 5h14v15H5z"/></svg>`,
    globe: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>`,
    target: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>`,
    chart: `<svg viewBox="0 0 24 24"><path d="M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-8"/></svg>`,
    lab: `<svg viewBox="0 0 24 24"><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/><path d="M8 15h8"/></svg>`,
    ticket: `<svg viewBox="0 0 24 24"><path d="M4 8a2 2 0 0 0 2-2h12a2 2 0 0 0 2 2v8a2 2 0 0 0-2 2H6a2 2 0 0 0-2-2z"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>`,
    pulse: `<svg viewBox="0 0 24 24"><path d="M3 12h4l2-6 4 12 2-6h6"/></svg>`,
    sliders: `<svg viewBox="0 0 24 24"><path d="M4 6h8M16 6h4M4 12h3M11 12h9M4 18h10M18 18h2"/><circle cx="14" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="16" cy="18" r="2"/></svg>`,
    refresh: `<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v6h-6"/></svg>`
  };
  return icons[name] || "";
}

render();
loadData().catch((error) => {
  app.innerHTML = `<main class="loading error">Could not load EdgeLab Sports: ${error.message}</main>`;
});

setInterval(() => {
  loadData().catch(() => {});
}, 30000);
