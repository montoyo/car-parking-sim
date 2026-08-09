# 03 — Tyre forces, weight transfer, RWD drivetrain, low-speed blend

**What to build:** The real vehicle model, replacing the placeholder from 01. The car creeps gently at idle in gear, holds still under brakes, is secured by the handbrake, and can be made to slide if the player is heavy-handed with throttle or steering. Steering while stationary feels different from steering on the move.

Planar rigid body (x, y, yaw) plus per-wheel state. Tyre forces come from a simplified Pacejka-style curve on slip angle and slip ratio, with per-wheel normal load from static weight distribution plus longitudinal and lateral weight transfer, and a friction-circle clamp so no wheel delivers full cornering and full drive force at once. Pitch and roll are derived cosmetically for the camera, not simulated as degrees of freedom.

Drivetrain is rear-wheel drive: torque curve → fixed final drive → open differential → rear wheels only, with a separate lower reverse ratio and an idle-creep torque applied in gear at low speed with the brake off. Brakes act on all four wheels with front bias; the handbrake locks the rears only.

**The low-speed regime is the riskiest part of this build and the reason this ticket exists.** Below a speed threshold the model must blend continuously toward a kinematic bicycle solution pivoting on the rear axle, because a purely force-based model degenerates into jitter and slip-angle singularities at crawl speed — and crawl speed is the entire game. Build and verify the crawl case first; do not defer it to the end of the ticket.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Slip-based tyre model with per-wheel normal load, weight transfer, and a friction-circle clamp
- [ ] RWD drivetrain with torque curve, final drive, open differential, separate reverse ratio, and idle creep
- [ ] Brakes with front bias; handbrake locks the rear wheels only
- [ ] Continuous blend to a kinematic rear-axle-pivot solution below the crawl threshold
- [ ] Pitch and roll derived for the camera without being simulated as degrees of freedom
- [ ] Test: crawl-speed manoeuvres produce smooth, non-oscillating poses with no jitter
- [ ] Test: yaw rate has no discontinuity as the car accelerates through the blend threshold
- [ ] Test: idle creep moves the car with no throttle once the brake is released
- [ ] Test: the handbrake holds the car stationary
- [ ] Test: excessive throttle in a turn produces measurable rear slip
- [ ] Test: the friction-circle clamp prevents simultaneous full drive and full cornering force
- [ ] Test: steering in reverse yaws the car the opposite way relative to travel
- [ ] Test: determinism and `dt`-independence from 01 still hold with the full model
