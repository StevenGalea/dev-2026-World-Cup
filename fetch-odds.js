// fetch-odds.js
//
// Fetches the live "World Cup Winner" market from Polymarket's public
// Gamma API and writes odds_live.json to the repo root in the shape
// the dashboard expects:
//
//   { "updated": "<ISO timestamp>", "odds": { "Spain": 5.88, ... } }
//
// Polymarket gives implied probability (0-1) per team via outcomePrices
// on the "Yes" outcome of each per-team sub-market. We convert that to
// decimal odds (1 / probability) so it slots into the same maths the
// dashboard already uses for draw-day odds (oddsToImpliedProb = 1/odds).
//
// No API key is required — this is Polymarket's documented public
// Gamma API, not a scrape of a bookmaker's site.

const fs = require('fs');
const path = require('path');

const GAMMA_URL = 'https://gamma-api.polymarket.com/events?slug=world-cup-winner';
const OUTPUT_PATH = path.join(__dirname, '..', '..', 'odds_live.json');

// Polymarket's team naming doesn't always match the names used in the
// dashboard's ALL_TEAMS list. Map any mismatches here. Left side is
// Polymarket's name (lowercased, trimmed), right side is the exact
// name used in ALL_TEAMS in the dashboard HTML.
const NAME_MAP = {
  'south korea': 'Korea',
  'ivory coast': 'Cote d Ivoire',
  "cote d'ivoire": 'Cote d Ivoire',
  'bosnia-herzegovina': 'Bosnia',
  'bosnia and herzegovina': 'Bosnia',
  'curaçao': 'Curacao',
  'curacao': 'Curacao',
  'turkiye': 'Turkiye',
  'turkey': 'Turkiye',
  'usa': 'USA',
  'united states': 'USA',
  'england': 'England',
  // Anything not listed here is passed through unchanged (most teams
  // already match: Spain, France, Brazil, Argentina, Germany, etc).
};

function normalizeName(rawName) {
  const key = rawName.trim().toLowerCase();
  return NAME_MAP[key] || rawName.trim();
}

async function main() {
  let res;
  try {
    res = await fetch(GAMMA_URL);
  } catch (e) {
    console.error('Network error fetching Polymarket Gamma API:', e.message);
    process.exit(1);
  }

  if (!res.ok) {
    console.error('Polymarket Gamma API returned HTTP', res.status);
    process.exit(1);
  }

  const events = await res.json();
  if (!Array.isArray(events) || events.length === 0) {
    console.error('Polymarket Gamma API returned no events for slug "world-cup-winner". The slug may have changed — check https://polymarket.com/event/world-cup-winner and update GAMMA_URL if so.');
    process.exit(1);
  }

  const event = events[0];
  const markets = event.markets || [];
  if (markets.length === 0) {
    console.error('Event found but it has no per-team markets. Aborting without overwriting odds_live.json.');
    process.exit(1);
  }

  const odds = {};
  let skipped = 0;

  markets.forEach(market => {
    // Each per-team market has a "groupItemTitle" or "question" naming
    // the team, and an outcomePrices array like ["0.17", "0.83"] for
    // ["Yes", "No"]. Yes price = implied probability of that team
    // winning the tournament.
    const teamNameRaw = market.groupItemTitle || (market.question || '').replace(/^Will\s+/i, '').replace(/\s+win the.*$/i, '');
    if (!teamNameRaw) { skipped++; return; }

    let outcomePrices;
    try {
      outcomePrices = typeof market.outcomePrices === 'string'
        ? JSON.parse(market.outcomePrices)
        : market.outcomePrices;
    } catch (e) {
      skipped++; return;
    }
    if (!Array.isArray(outcomePrices) || outcomePrices.length === 0) { skipped++; return; }

    const yesPrice = parseFloat(outcomePrices[0]);
    if (!yesPrice || yesPrice <= 0 || yesPrice >= 1) { skipped++; return; } // 0 or 1 means resolved/invalid, skip

    const teamName = normalizeName(teamNameRaw);
    const decimalOdds = 1 / yesPrice;
    odds[teamName] = Math.round(decimalOdds * 100) / 100; // 2dp
  });

  if (Object.keys(odds).length === 0) {
    console.error('Parsed zero usable team odds — aborting without overwriting odds_live.json. Inspect the raw API response shape, it may have changed.');
    process.exit(1);
  }

  const output = {
    updated: new Date().toISOString(),
    source: 'Polymarket (gamma-api.polymarket.com, event slug: world-cup-winner)',
    odds,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n');
  console.log(`Wrote odds_live.json with ${Object.keys(odds).length} teams (${skipped} skipped/unparseable).`);
}

main();
