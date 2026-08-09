# 06 — Scenario data model and the parallel park scenario

**What to build:** The player can load the parallel park scenario: a gap between two parked cars with a kerb along one side, bay markings on the ground, and a consistent sensible approach pose so repeated attempts are comparable. The target bay is clearly marked. Restarting the scenario is instant.

A scenario is **data, not code**: bay polygon and type, parked-car placements, kerb polyline and height, walls and bollards, spawn pose, tunable parameters (gap length, bay width, kerb height), pass criteria, and which scoring criteria apply. Adding a scenario later must mean adding data, with no new code paths — tickets 12 depends on that holding.

Collision is not part of this ticket; the parked cars and kerb are geometry that later tickets test against.

**Blocked by:** 01

**Status:** done

- [x] Scenario is expressed purely as data with the fields above
- [x] Parallel park scenario renders: two parked cars, a kerb with a stated height, walls, and bay line markings
- [x] The target bay is visually unambiguous
- [x] The car spawns at a consistent approach pose
- [x] Scenario tolerances and tunable parameters are part of the data, not hardcoded in logic
- [x] Instant restart returns the world to its exact initial state
- [x] Test: `createWorld` for the parallel park scenario produces the expected spawn pose and obstacle set
- [x] Test: restarting produces a world identical to the initial one
