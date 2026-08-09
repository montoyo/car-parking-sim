# 12 — Remaining scenarios and scenario select

**What to build:** The player picks from a list of scenarios and practises the manoeuvre they're actually bad at. Four more scenarios ship alongside the parallel park: forward bay, reverse bay, angled/echelon, and a deliberately tight challenge with a high kerb for practising not kerbing the rims.

The selection menu shows each scenario's difficulty and its pass criteria before the player starts, so they know what they're being judged on. Tunable parameters — gap length, bay width, kerb height — can be adjusted to make a scenario easier while learning and harder once confident, with best scores keyed per parameter set.

Some scenarios offer an optional reversing camera, so the player can compare mirror-only parking against camera-assisted parking.

**If this ticket requires new code paths rather than new scenario data, ticket 06's data model needs fixing rather than working around.**

**Blocked by:** 09

**Status:** ready-for-agent

- [ ] Forward bay, reverse bay, angled/echelon and tight-kerb scenarios all playable and completable
- [ ] Each new scenario is expressed as data, with no bespoke scoring or completion code
- [ ] Selection menu lists scenarios with difficulty and pass criteria shown before starting
- [ ] Gap length, bay width and kerb height are adjustable where the scenario declares them tunable
- [ ] Best scores are keyed by scenario id and parameter set
- [ ] Optional reversing camera available on the scenarios that declare it
- [ ] Test: a scripted known-good manoeuvre completes each scenario with zero contacts
- [ ] Test: each scenario's fully-inside-bay gate rejects a car left partly outside
