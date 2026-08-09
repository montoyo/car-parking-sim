# 01 — Walking skeleton: WebGL loop, fixed-timestep core seam, driveable box

**What to build:** A player can open the page and drive a flat-shaded box around an empty ground plane with the keyboard, viewed from a debug top-down camera. Nothing about the car is faithful yet — this ticket exists to put the project's one seam and its testing prior art in place before any physics is written.

The simulation core is pure TypeScript with no WebGL, DOM, timers, or unseeded randomness. Its entire public surface is `createWorld(scenarioId, options)`, `step(world, input, dt) -> { world, events }`, and (later) a scoring function. `ControlInput` is device-agnostic and normalised: steering rack target in [-1, 1], throttle [0, 1], brake [0, 1], handbrake boolean, gear (`forward` | `neutral` | `reverse`). `SimEvent` is a discriminated union — stub it with `gearChange` for now, but establish the shape.

The core is stepped on a fixed timestep with an accumulator in the render loop; rendering interpolates between the two most recent states. The vehicle definition (wheelbase, track, overhangs, body outline, wheel radius/width, mirror mounting points, driver eye point) lands here as the single source of truth both the core and the renderer read.

The vehicle model is a placeholder kinematic bicycle — it will be replaced in 02/03. Do not invest in it.

This ticket establishes the test vocabulary the entire suite will use: a helper that drives N seconds of a held `ControlInput` from an initial world and returns the accumulated events plus the final world. Every later ticket extends that helper rather than adding seams.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] TypeScript + WebGL project runs in a browser and renders a flat-shaded box on a ground plane
- [ ] Simulation core has no imports from the renderer, DOM, or any timer
- [ ] `createWorld` and `step` exist with the `ControlInput` and `SimEvent` shapes described above
- [ ] Fixed-timestep accumulator drives the core; rendering interpolates between states
- [ ] Vehicle definition exists in one place and is read by both core and renderer
- [ ] Keyboard adapter produces `ControlInput`, including wind-on and self-centre ramping for steering
- [ ] Debug top-down camera follows the car
- [ ] Scripted-input test helper exists and is used by every test in this ticket
- [ ] Test: identical input scripts from an identical initial world produce bit-identical final worlds
- [ ] Test: halving `dt` while doubling tick count leaves the final pose within a stated tolerance
- [ ] Test: selecting reverse and applying throttle moves the car backwards
