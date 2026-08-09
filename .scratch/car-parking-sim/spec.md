# Spec: Car Parking Simulator Mini-Game

Status: ready-for-agent

## Problem Statement

Learning how a car actually behaves during a parking manoeuvre is hard. Real practice is expensive, stressful, and gives poor feedback: you find out you clipped the kerb only by the sound, you can't see why the car swung the way it did, and nobody tells you whether you ended up centred in the bay or 40cm off. Existing driving games either model the car so loosely that the steering lessons don't transfer, or they're full simulators that are far too heavyweight for "I want ten minutes of parallel-park practice".

The user wants a browser mini-game that is genuinely faithful about *how a car moves under steering* — including the counter-intuitive parts like the rear axle cutting inside the front, and how a reversing car pivots — while staying visually cheap and instantly playable. They want to feel the manoeuvre from the driver's seat, using mirrors the way you would in reality, and then immediately see from above what their car actually did and where it went wrong.

## Solution

A WebGL browser mini-game. The player picks a parking scenario (parallel, bay/regular, reverse bay, angled/echelon, and a tight "kerb rash" challenge), then drives a rear-wheel-drive car from a first-person driver's-seat view using steering, throttle, brake, and gear selection.

The car is simulated with a high-fidelity but real-time-cheap vehicle model: Ackermann steering geometry, a finite steering rack with a rate limit (you must wind the wheel, not teleport it), per-wheel tyre forces with slip, weight transfer, RWD drive torque, and a proper low-speed kinematic regime so crawling manoeuvres behave correctly rather than dissolving into numerical noise.

Graphics are deliberately minimal — flat-shaded boxes, no textures beyond line markings — but the *geometry* is honest, because it has to be: the interior rear-view mirror and both wing mirrors are rendered as real reflected views with correct mirror pose, field of view, and convexity, so what the player sees in the passenger-side mirror is what a driver would actually see, blind spots included.

Collision is detected against parked cars, walls/bollards, and — separately — the roadway border. Kerb contact is modelled distinctly: a wheel scraping the kerb is a "rim strike" event with its own severity, not the same thing as bodywork contact with another car.

Every attempt is scored: final centring between the bay lines, final heading alignment, whether the car is fully inside its bay, number of shunts (gear changes), time taken, and penalties for each contact event. On completion the game switches to a top-down replay: the scenario from above, with the traced path of the car body and of each wheel, scrubbable and speed-adjustable, with contact events marked on the timeline so the player can jump straight to the moment they hit the kerb and watch the geometry that caused it.

## User Stories

### Scenario selection and setup

1. As a player, I want to choose from a list of parking scenarios, so that I can practise the manoeuvre I'm actually bad at.
2. As a player, I want a parallel parking scenario with a gap between two parked cars and a kerb on one side, so that I can practise the hardest common manoeuvre.
3. As a player, I want a regular forward bay parking scenario, so that I can practise the everyday case.
4. As a player, I want a reverse bay parking scenario, so that I can practise backing into a bay between two cars.
5. As a player, I want an angled/echelon parking scenario, so that I can practise entering a bay that isn't perpendicular to the lane.
6. As a player, I want a deliberately tight scenario with a high kerb, so that I can practise not kerbing my rims.
7. As a player, I want each scenario to state its difficulty and its pass criteria before I start, so that I know what I'm being judged on.
8. As a player, I want to see the target bay clearly marked, so that I know where I'm meant to end up.
9. As a player, I want to start each attempt from a consistent, sensible approach position, so that repeated attempts are comparable.
10. As a player, I want to restart the current scenario instantly, so that a botched approach doesn't cost me time.
11. As a player, I want to adjust the gap size or bay width on a scenario, so that I can make it easier while learning and harder once confident.

### Driving and vehicle feel

12. As a player, I want to steer with a rack that takes real time to wind lock-to-lock, so that I learn to plan steering input rather than snapping to full lock.
13. As a player, I want to see how much steering lock I currently have applied, so that I know whether I'm at full lock.
14. As a player, I want the front wheels to follow Ackermann geometry, so that the car turns the way a real car does at low speed.
15. As a player, I want the rear wheels to cut inside the fronts through a turn, so that I learn the rear-overhang and rear-axle behaviour that causes most parking damage.
16. As a driver of a rear-wheel-drive car, I want drive torque applied at the rear axle, so that throttle behaviour matches the stated drivetrain.
17. As a player, I want the car to creep forward gently at idle in gear, so that low-speed manoeuvring feels like a real automatic rather than an on/off toy.
18. As a player, I want to select forward, neutral and reverse, so that I can shunt back and forth during a manoeuvre.
19. As a player, I want reversing to steer the opposite way around the pivot, so that I build correct reversing instincts.
20. As a player, I want a brake that actually stops the car and holds it, so that I can pause mid-manoeuvre and think.
21. As a player, I want a handbrake, so that I can secure the car when I believe I'm finished.
22. As a player, I want the car to lose grip and slide if I'm heavy-handed with throttle or steering, so that the model doesn't reward abuse.
23. As a player, I want tyre scrub when I steer while stationary, so that dry-steering feels different from steering on the move.
24. As a player, I want weight transfer under braking and acceleration to affect grip, so that the physics stays coherent even though I'm going slowly.
25. As a player, I want to use either keyboard or a gamepad with analogue steering and pedals, so that I can play with whatever I have.
26. As a player using analogue steering, I want the wheel position to map to rack position directly, so that I get proportional control.
27. As a player using the keyboard, I want steering to wind on and self-centre at a believable rate, so that keyboard play still teaches the right habits.
28. As a player, I want a speedometer showing very low speeds usefully, so that I can tell a creep from a lurch.

### First-person view and mirrors

29. As a player, I want a first-person view from the driver's seat, so that I judge the manoeuvre from the same viewpoint as in a real car.
30. As a player, I want the eye position to sit on the correct side of the car and at a realistic height, so that my sense of the car's extents is right.
31. As a player, I want to look around freely with the mouse, so that I can check over my shoulder.
32. As a player, I want a quick "look left / look right / look back" control, so that shoulder checks are one button rather than a mouse sweep.
33. As a player, I want an interior rear-view mirror showing a correct reflected view out of the rear window, so that I can reverse using the mirror.
34. As a player, I want left and right wing mirrors showing correct reflected views, so that I can judge my distance to the kerb and to parked cars.
35. As a player, I want the wing mirrors to be convex with a wider field of view than the flat interior mirror, so that mirror judgement transfers to reality.
36. As a player, I want mirrors to have realistic blind spots, so that the game doesn't let me cheat with impossible visibility.
37. As a player, I want to adjust mirror aim, so that I can set the car up the way I would in reality.
38. As a player, I want the car's own bodywork visible in the mirrors where it would be, so that I have the reference edge real drivers use.
39. As a player, I want the A-pillars, door frame and bonnet visible from the driver's seat, so that the occlusion that makes parking hard is present.
40. As a player, I want an optional reversing camera on some scenarios, so that I can compare mirror-only against camera-assisted parking.

### Collision

41. As a player, I want contact with a parked car to be detected and reported, so that I know I've hit something.
42. As a player, I want contact with walls and bollards to be detected, so that boundaries are meaningful.
43. As a player, I want the roadway border/kerb tracked separately from other obstacles, so that kerbing is called out as its own mistake.
44. As a player, I want a wheel touching the kerb to be reported as a rim strike, so that I learn the specific error that damages alloys in real life.
45. As a player, I want a wheel *mounting* the kerb to be reported as worse than a graze, so that severity is proportionate.
46. As a player, I want bodywork overhang contacting a high kerb to be distinguished from a rim strike, so that the feedback is accurate.
47. As a player, I want impact severity to scale with closing speed, so that a gentle nudge isn't scored like a crash.
48. As a player, I want an immediate audible and visual cue on contact, so that I notice it in the moment rather than only in the score.
49. As a player, I want the car to be physically stopped or deflected by what it hits, so that I can't drive through a parked car.
50. As a player, I want repeated contact with the same object over a short window to count as one sustained event, so that a single scrape isn't penalised twenty times.
51. As a player, I want a scenario to optionally end immediately on a severe impact, so that hard mode has real stakes.

### Scoring

52. As a player, I want a score at the end of each attempt, so that I can tell whether I did well.
53. As a player, I want to be scored on how centred my car is between the bay lines, so that I'm rewarded for precision, not just for fitting.
54. As a player, I want to be scored on how parallel my car is to the bay or kerb, so that a crooked park isn't a good park.
55. As a player, I want to be scored on my distance from the kerb in parallel parking, so that I learn the right gap.
56. As a player, I want to be scored on how far into the bay I am fore-and-aft, so that hanging out the back counts against me.
57. As a player, I want a hard requirement that the whole car is inside the bay for a pass, so that the pass condition is unambiguous.
58. As a player, I want penalties per contact event scaled by severity, so that damage matters.
59. As a player, I want the number of shunts counted, so that I'm encouraged to park in fewer moves.
60. As a player, I want time taken to contribute modestly to the score, so that I'm pushed to be smooth without being pushed to be reckless.
61. As a player, I want a per-criterion breakdown of my score, so that I know which part to work on.
62. As a player, I want a letter grade or star rating summarising the attempt, so that progress is legible at a glance.
63. As a player, I want my best score per scenario kept between sessions, so that I can chase improvement.
64. As a player, I want to see whether an attempt beat my previous best, so that improvement is celebrated.

### Replay

65. As a player, I want the game to switch to a top-down replay when I finish an attempt, so that I can see what I actually did.
66. As a player, I want my car's path drawn as a trace, so that I can see the shape of my manoeuvre.
67. As a player, I want each wheel's path drawn separately, so that I can see the rear wheels cutting inside the front.
68. As a player, I want the traces to show direction of travel and where I changed gear, so that I can count and locate my shunts.
69. As a player, I want contact events marked on the trace at the exact spot they happened, so that I can see the geometry that caused them.
70. As a player, I want to scrub the replay timeline, so that I can study any moment.
71. As a player, I want to play the replay at slower or faster speed, so that I can examine tight moments closely.
72. As a player, I want to step frame by frame, so that I can pinpoint the instant of contact.
73. As a player, I want to jump directly to each contact event from the timeline, so that I don't have to hunt for it.
74. As a player, I want to see the steering rack position and gear at the scrubbed moment, so that I can connect my input to the car's behaviour.
75. As a player, I want the ideal or reference line optionally overlaid, so that I can compare my path with a clean one.
76. As a player, I want to toggle between the replay's top-down view and the first-person view of the same recorded attempt, so that I can reconcile what I saw with what happened.
77. As a player, I want to retry straight from the replay screen, so that the loop from mistake to next attempt is short.

### Accessibility, performance and polish

78. As a player on a laptop, I want the game to hold a smooth frame rate with the simple graphics, so that low-speed control stays precise.
79. As a player, I want the physics to be deterministic and frame-rate independent, so that the car behaves the same on any machine.
80. As a player, I want an on-screen control reference, so that I don't have to guess the keys.
81. As a player, I want to remap controls, so that the game fits my keyboard or pad.
82. As a player, I want to mute or adjust audio, so that the cues don't annoy me.
83. As a player, I want the game to pause when the tab loses focus, so that time and physics don't run away without me.
84. As a player with limited colour vision, I want contact markers and bay lines distinguished by shape as well as colour, so that the feedback is readable.

## Implementation Decisions

### Architecture: one pure simulation core, everything else above it

- The project splits into a **simulation core** and a **presentation layer**. The core is pure TypeScript with no WebGL, no DOM, no timers, no randomness beyond an injected seed.
- The core's entire public surface is a single tick function:

  ```ts
  step(world: WorldState, input: ControlInput, dt: number): { world: WorldState; events: SimEvent[] }
  ```

  plus scenario constructors (`createWorld(scenarioId, options): WorldState`) and a scoring function over a finished world/recording. This is the sole seam (confirmed with the user).
- `ControlInput` is normalised and device-agnostic: steering rack *target* in [-1, 1], throttle [0, 1], brake [0, 1], handbrake boolean, gear (`forward` | `neutral` | `reverse`). Input devices (keyboard, gamepad) are adapters that produce `ControlInput`; the keyboard adapter is responsible for wind-on/self-centre ramping so the core sees the same shape from both devices.
- `SimEvent` is a discriminated union covering at minimum: `contact` (with `surface: 'vehicle' | 'wall' | 'kerb'`, `part: 'body' | 'wheel'`, severity, closing speed, world position, the colliding wheel/corner), `gearChange`, `scenarioComplete`, `scenarioFailed`. Events are the primary assertion target for tests and the primary feed for HUD cues, scoring penalties and replay markers — one mechanism, three consumers.
- The core is stepped at a **fixed timestep** with an accumulator in the render loop; rendering interpolates between the two most recent states. This gives frame-rate independence and determinism.

### Vehicle model

- Rigid body with three degrees of freedom (planar: x, y, yaw) plus tracked per-wheel state. Full 3D body dynamics (pitch/roll as real DOF) are not simulated; pitch/roll are derived cosmetically from longitudinal/lateral acceleration for the camera.
- **Ackermann steering geometry**: inner and outer front wheel angles are computed from a common steer input via wheelbase and track, not set equal.
- **Steering rack with rate limit and finite lock**: the rack position moves toward the input target at a bounded rate; the rate is lower at zero speed than rolling (dry-steer resistance). Lock-to-lock is a scenario/vehicle constant, and the rack position is an explicit part of `WorldState` because the HUD and the replay both read it.
- **Tyre forces** via a simplified Pacejka-style curve on slip angle and slip ratio, with per-wheel normal load from static weight distribution plus longitudinal and lateral **weight transfer**. Friction is combined-slip limited (a friction-circle clamp) so a wheel can't simultaneously deliver full cornering and full drive force.
- **Low-speed regime**: below a speed threshold the model blends toward a kinematic bicycle solution (rear-axle-pivot geometry) to avoid the slip-angle singularity and numerical jitter that plagues force-based models at crawl speed. The blend is continuous — this is a stated design decision because virtually the entire game happens in that regime, and getting it right is the difference between "fidelity" and "vibrating box".
- **RWD drivetrain**: engine/motor torque curve → fixed final drive → open differential → rear wheels only. An idle-creep torque is applied in gear at low speed with the brake off. Reverse uses a separate, lower ratio.
- Brakes apply to all four wheels with a front bias; handbrake locks the rears only.
- The vehicle's geometry (wheelbase, track, overhangs, body outline, wheel radius/width, mirror mounting points, driver eye point) lives in one **vehicle definition** consumed by both the core (collision shapes, dynamics) and the renderer (body mesh, camera, mirror poses). Single source of truth — the mirrors are only "accurate" if they read the same numbers the physics does.

### Collision

- Collision uses 2D shapes in the ground plane plus a height dimension where it matters (kerb height vs. body overhang height). Two distinct classes:
  - **Body collision**: the car's body polygon against other cars' body polygons, walls, and bollards. Resolved as an impulse with restitution and friction so the car is deflected/stopped rather than passing through.
  - **Kerb / roadway border collision**: the border is a polyline with a height. Tested against (a) each wheel's contact footprint — producing a **rim strike** — and (b) the body outline at the kerb's height — producing an overhang scrape. Mounting the kerb (wheel crossing the border rather than grazing it) is a distinct, higher severity than a graze.
- Severity is a function of closing speed normal to the contact surface, bucketed into graze / knock / impact so scoring and audio can key off a small vocabulary rather than a raw float.
- **Event coalescing**: contacts with the same object and part within a debounce window extend the existing event (updating peak severity) instead of emitting a new one. Tests assert on the coalesced count, since "one scrape" is the user-meaningful unit.

### Scenarios

- A scenario is data, not code: bay polygon and type, parked-car placements, kerb polyline and height, walls, spawn pose, tunable parameters (gap length, bay width, kerb height), pass criteria, and which scoring criteria apply. Adding a scenario means adding data, and the pass condition for a bay-type scenario is expressed by the same criteria machinery as every other.
- Shipping scenarios: parallel park, forward bay, reverse bay, angled/echelon, tight-kerb challenge.
- Completion is detected when the car is stationary with the handbrake set (or held stopped past a dwell time) — the player declares they're done by parking properly, not by pressing "finish".

### Scoring

- Scoring is a pure function over the finished world plus the event log, producing a per-criterion breakdown and a total. Criteria: lateral centring between bay lines, heading alignment to the bay/kerb, kerb distance (parallel scenarios), fore-aft position in the bay, fully-inside-bay (a hard gate, not a weighted term), contact penalties by severity, shunt count, elapsed time.
- Each criterion returns a normalised 0–1 sub-score with its own tolerance band from the scenario data, so scenario difficulty is expressed by tolerances rather than by bespoke scoring code.
- Best scores persist in browser local storage keyed by scenario id and its tunable parameters (a wider bay is not the same leaderboard entry).

### Recording and replay

- The render loop appends a frame record each fixed tick: body pose, per-wheel pose and contact patch position, rack position, gear, speed, plus the event log with tick indices. This recording *is* the replay — replay is playback of recorded frames, not re-simulation, so a replay can never disagree with what the player experienced.
- Top-down replay renders the scenario orthographically, draws body-centre and per-wheel polylines from the recording, and marks gear changes and contact events at their recorded positions. Scrubbing sets a frame index; frame-step, speed control and event-jump all reduce to setting that index.
- Replay can render the same recorded frames through the first-person camera, giving the FPV/top-down toggle for free.

### Rendering, view and mirrors

- WebGL via a thin renderer over flat-shaded geometry — no textures beyond line markings, no PBR, no shadows beyond a cheap ground-contact darkening. The graphics budget goes to nothing except keeping frame rate high and geometry honest.
- **Mirrors are real renders**: each mirror is an additional camera pass into a small render target, with the camera pose derived by reflecting the driver's eye point through the mirror plane defined in the vehicle definition, and the frustum clipped to the mirror's outline. This gives correct blind spots as a consequence of geometry rather than as a hand-tuned effect.
- Wing mirrors are convex: the reflected view is rendered with a wider field of view and a radial warp matching a spherical mirror of a stated radius. Interior mirror is flat.
- Mirror render targets are low resolution and may update at a reduced rate; the interior mirror and the wing mirror on the manoeuvre-relevant side get priority if a frame budget is exceeded.
- The car's own body is included in the mirror passes (a driver sees their own flank in the wing mirror), and the cockpit shell — A-pillars, door frame, bonnet edge — is rendered in the FPV pass so the real occlusion is present.
- HUD: rack position indicator, gear, speed, elapsed time, live contact cues.

### Non-decisions deliberately left open

- No build/framework choice is mandated here beyond "TypeScript, WebGL, runs in a browser"; whatever the implementer picks must keep the simulation core free of renderer imports.

## Testing Decisions

### What makes a good test here

A good test drives the simulation core through `step()` with a scripted `ControlInput` sequence and asserts on the resulting `WorldState` and emitted `SimEvent`s. It never reaches inside the tyre model, the collision broadphase, or the integrator. Tests are written in the player's language ("reversing at full right lock from this pose ends up inside the bay", "clipping the kerb at 0.4 m/s emits exactly one graze-severity rim strike on the front-left wheel"), so that the physics implementation can be rewritten wholesale without touching them.

Because the core is pure and deterministic with a fixed timestep, tests are exact and fast: no wall clock, no rendering, no async. Assertions on continuous quantities use explicit tolerances stated in physical units (metres, degrees) rather than magic float comparisons.

### The single seam

All gameplay tests go through the core's public surface: `createWorld`, `step`, and the scoring function. A small test helper drives N seconds of a held input and returns the accumulated events plus the final world — that helper is the vocabulary the whole suite is written in.

### What gets tested

- **Steering geometry and kinematics**: at full lock the turning circle matches the Ackermann prediction for the vehicle's wheelbase and track within tolerance; the rear wheels' traced path lies inside the front wheels' through a turn; the rack takes the specified time to travel lock-to-lock and cannot exceed lock.
- **Drivetrain and direction**: throttle in reverse moves the car backwards; steering in reverse yaws the car the opposite way relative to travel; idle creep moves the car with no throttle and releases the brake; handbrake holds the car on the given surface.
- **Low-speed regime**: crawl-speed manoeuvres produce smooth, non-oscillating poses, and the kinematic/dynamic blend introduces no discontinuity in yaw rate as the car accelerates through the threshold.
- **Grip limits**: excessive throttle in a turn produces measurable rear slip; the friction-circle clamp prevents simultaneous full drive and full cornering force.
- **Determinism**: identical input scripts from an identical initial world produce bit-identical final worlds; halving `dt` while doubling tick count leaves the final pose within tolerance.
- **Collision**: driving into a parked car emits a `contact` with `surface: 'vehicle'` and stops the car; driving into a wall likewise; a wheel grazing the kerb emits a rim strike naming the correct wheel; mounting the kerb reports higher severity than grazing; body overhang over a high kerb reports a body contact, not a rim strike; severity scales monotonically with closing speed; a sustained scrape emits one coalesced event, not many.
- **Scenarios**: each shipping scenario is reachable — a scripted "known good" manoeuvre completes it with zero contacts; a car left half out of the bay fails the fully-inside gate regardless of other criteria.
- **Scoring**: a perfectly centred, perfectly aligned park scores maximum on centring and alignment; offsetting the car by a known distance degrades the centring sub-score monotonically; each contact event reduces the total by its severity's weight; shunt count matches the number of `gearChange` events; the breakdown's parts sum to the total.
- **Recording/scoring consistency**: the event log a run produces is the same log scoring and replay markers consume — asserted by scoring a recorded run and checking the marker count matches the coalesced event count.

### What is not tested

WebGL rendering, mirror image quality, HUD layout, replay playback UI, and input-device plumbing are verified by eye. Mirror *pose* correctness is bounded by the fact that mirrors derive from the same vehicle definition the physics uses; if that proves insufficient in practice, extracting a mirror-geometry seam is the natural follow-up (the user explicitly deferred it).

### Prior art

None — this is a greenfield repo. This suite therefore establishes the prior art: pure-core, scripted-input, event-asserting tests. Later features should extend the same helper rather than introducing new seams.

## Out of Scope

- Multiplayer, leaderboards beyond local best scores, accounts, or any server component.
- Traffic, pedestrians, or any moving obstacle — all obstacles are static.
- Driving outside the parking scenario: no open world, no road network, no journey to the parking spot.
- Manual gearbox with a clutch; the car is an automatic with forward/neutral/reverse.
- Vehicle damage modelling, deformation, or repair economy — contacts are events and penalties, not persistent damage.
- Weather, surface conditions, night driving, or variable grip levels.
- Multiple selectable vehicles with different dimensions. One vehicle definition ships; the definition is data so more can follow, but tuning and testing a fleet is not in this spec.
- Force-feedback wheel support (a gamepad's analogue axes are supported; FFB is not).
- Mobile/touch controls.
- Photorealistic graphics, textures, PBR materials, dynamic shadows, or post-processing.
- Exporting or sharing replays.
- Tutorial or coaching mode that tells the player where to steer next; the reference-line overlay in replay is the extent of guidance.

## Further Notes

- The riskiest part of this build is the **low-speed regime**. A force-based tyre model that behaves beautifully at 60 km/h will jitter, creep, or refuse to settle at 2 km/h — and 2 km/h is the entire game. Build and test the crawl case first; do not defer it.
- The second-riskiest part is **mirror credibility**. Mirrors that are merely "a second camera pointing backwards" will feel wrong to anyone who drives, and the user called them out specifically. Deriving mirror pose by reflecting the eye point through the mirror plane, using the same geometry the physics uses, is what makes the blind spots emerge correctly instead of being faked.
- Making the replay a *recording* rather than a re-simulation is a deliberate correctness decision: a re-simulated replay that diverges even slightly would show the player a collision that didn't happen, which is precisely the moment they came to the replay to study.
- The `SimEvent` stream doing triple duty (live cues, scoring penalties, replay markers) is the main structural bet in this spec. It keeps the three consumers automatically consistent and gives tests one thing to assert on.
- Scenario difficulty is expressed entirely as data — tolerances, gap sizes, kerb heights — so adding "harder" content later requires no new code paths.
