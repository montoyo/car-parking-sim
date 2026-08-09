# 07 — Body collision against cars and walls

**What to build:** The player can no longer drive through a parked car. Contact with another car, a wall or a bollard stops or deflects the car, and is reported immediately with an audible and visual cue so the player notices in the moment rather than only in the score.

The car's body polygon is tested against other cars' body polygons, walls and bollards, and resolved as an impulse with restitution and friction. Each contact emits a `contact` event carrying surface (`vehicle` | `wall`), part (`body`), severity, closing speed, and world position.

Severity is a function of closing speed normal to the contact surface, bucketed into graze / knock / impact — a small vocabulary that scoring and audio key off, rather than a raw float.

The `SimEvent` stream is the structural bet of this build: it feeds live cues now, scoring penalties in 09, and replay markers in 10. One mechanism, three consumers, so they cannot disagree.

**Blocked by:** 03, 06

**Status:** ready-for-agent

- [ ] Body polygon collision against parked cars, walls and bollards, resolved as an impulse with restitution and friction
- [ ] `contact` events carry surface, part, severity bucket, closing speed and world position
- [ ] Severity buckets are graze / knock / impact, derived from normal closing speed
- [ ] Immediate audible and visual cue on contact
- [ ] Test: driving into a parked car emits a `contact` with surface `vehicle` and stops the car
- [ ] Test: driving into a wall emits a `contact` with surface `wall` and stops the car
- [ ] Test: the car cannot pass through a parked car at any approach speed the scenario allows
- [ ] Test: severity increases monotonically with closing speed
