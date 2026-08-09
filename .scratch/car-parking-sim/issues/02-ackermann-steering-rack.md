# 02 — Ackermann geometry and the steering rack

**What to build:** The car steers like a car. Turning the wheel no longer snaps the front wheels to an angle — the rack winds toward the input target at a bounded rate, and winds noticeably slower when the car is stationary than when rolling, so the player learns to plan steering input instead of teleporting to full lock. The rack has a finite lock that cannot be exceeded.

The two front wheels no longer share an angle: inner and outer angles follow Ackermann geometry derived from the vehicle definition's wheelbase and track. Driving a full-lock circle produces the turning circle the geometry predicts, and the rear wheels visibly cut inside the fronts through a turn — the behaviour that causes most real parking damage.

Rack position is explicit state in `WorldState` (the HUD and the replay both read it later) and is shown on screen so the player can tell how much lock is applied.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Front wheel angles follow Ackermann geometry — inner and outer differ, derived from the vehicle definition
- [ ] Rack moves toward the input target at a bounded rate, slower at zero speed than rolling
- [ ] Rack position cannot exceed the vehicle's lock
- [ ] Rack position is part of `WorldState` and displayed on a HUD indicator
- [ ] Test: at full lock, the turning circle matches the Ackermann prediction for the vehicle's wheelbase and track, within a stated tolerance
- [ ] Test: through a turn, the rear wheels' traced path lies inside the front wheels'
- [ ] Test: the rack takes the specified time to travel lock-to-lock, and takes longer from a standstill
- [ ] Test: a steering input beyond lock leaves the rack at lock
