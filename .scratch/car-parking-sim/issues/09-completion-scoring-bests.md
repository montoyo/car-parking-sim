# 09 — Completion detection, scoring, breakdown, persisted bests

**What to build:** The full game loop becomes playable end to end. The player parks, comes to a stop with the handbrake set (or held stopped past a dwell time), and the attempt completes — they declare they're done by parking properly, not by pressing a "finish" button. They then see a score with a per-criterion breakdown, a letter grade or star rating, and whether they beat their previous best.

Scoring is a pure function over the finished world plus the event log, producing a per-criterion breakdown and a total. Criteria: lateral centring between the bay lines, heading alignment to the bay or kerb, kerb distance (parallel scenarios), fore-aft position in the bay, contact penalties by severity, shunt count, and elapsed time as a modest term. Being fully inside the bay is a **hard gate**, not a weighted term — the pass condition must be unambiguous.

Each criterion returns a normalised 0–1 sub-score against its own tolerance band from the scenario data, so difficulty is expressed by tolerances rather than bespoke scoring code. Shunts are counted from `gearChange` events; contact penalties are counted from the coalesced `contact` events of 08 — the same stream that drove the live cues.

Best scores persist in browser local storage keyed by scenario id *and* its tunable parameters — a wider bay is not the same leaderboard entry.

**Blocked by:** 06, 08

**Status:** ready-for-agent

- [ ] Completion is detected by the car being stationary with the handbrake set, or held stopped past a dwell time
- [ ] Scoring is a pure function over the finished world and event log
- [ ] Every criterion listed above contributes a normalised sub-score against a tolerance from scenario data
- [ ] Fully-inside-bay is a hard pass gate, independent of the weighted total
- [ ] Breakdown screen shows per-criterion results plus a letter grade or star rating
- [ ] Best score per scenario and parameter set persists in local storage, with a "new best" cue
- [ ] Test: a perfectly centred, perfectly aligned park scores maximum on centring and alignment
- [ ] Test: offsetting the car by a known distance degrades the centring sub-score monotonically
- [ ] Test: a car left half outside the bay fails regardless of every other criterion
- [ ] Test: each contact event reduces the total by its severity's weight
- [ ] Test: shunt count matches the number of `gearChange` events
- [ ] Test: the breakdown's parts sum to the total
- [ ] Test: a scripted known-good manoeuvre completes the parallel park scenario with zero contacts
