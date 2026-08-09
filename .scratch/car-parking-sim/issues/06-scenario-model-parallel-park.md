# 06 — Scenario data model and the parallel park scenario

**What to build:** The player can load the parallel park scenario: a gap between two parked cars with a kerb along one side, bay markings on the ground, and a consistent sensible approach pose so repeated attempts are comparable. The target bay is clearly marked. Restarting the scenario is instant.

A scenario is **data, not code**: bay polygon and type, parked-car placements, kerb polyline and height, walls and bollards, spawn pose, tunable parameters (gap length, bay width, kerb height), pass criteria, and which scoring criteria apply. Adding a scenario later must mean adding data, with no new code paths — tickets 12 depends on that holding.

Collision is not part of this ticket; the parked cars and kerb are geometry that later tickets test against.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Scenario is expressed purely as data with the fields above
- [ ] Parallel park scenario renders: two parked cars, a kerb with a stated height, walls, and bay line markings
- [ ] The target bay is visually unambiguous
- [ ] The car spawns at a consistent approach pose
- [ ] Scenario tolerances and tunable parameters are part of the data, not hardcoded in logic
- [ ] Instant restart returns the world to its exact initial state
- [ ] Test: `createWorld` for the parallel park scenario produces the expected spawn pose and obstacle set
- [ ] Test: restarting produces a world identical to the initial one
