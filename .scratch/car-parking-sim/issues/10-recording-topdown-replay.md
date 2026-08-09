# 10 — Recording and top-down replay

**What to build:** When an attempt finishes, the game switches to a top-down replay showing what the player actually did. The scenario is drawn from above with the traced path of the car body and of each wheel — so the rear wheels cutting inside the fronts is finally visible — with direction of travel and gear changes marked, and every contact event pinned at the exact spot it happened.

The player can scrub the timeline, play slower or faster, step frame by frame, and jump straight to any contact event from the timeline. At the scrubbed moment they see the steering rack position and gear, so they can connect their input to the car's behaviour. They can retry straight from the replay screen.

**Replay is playback of a recording, never a re-simulation.** Each fixed tick appends a frame record — body pose, per-wheel pose and contact patch position, rack position, gear, speed — alongside the event log with tick indices. A re-simulated replay that diverged even slightly would show the player a collision that didn't happen, at precisely the moment they came to the replay to study it.

**Blocked by:** 09

**Status:** ready-for-agent

- [ ] Every fixed tick appends a frame record with the fields above; the event log is stored with tick indices
- [ ] Replay renders recorded frames and never re-simulates
- [ ] Top-down orthographic view draws body-centre and per-wheel traces
- [ ] Direction of travel and gear-change points are marked on the trace
- [ ] Contact events are marked at their recorded world positions
- [ ] Scrub, variable playback speed, and frame-step all work by setting a frame index
- [ ] Jump-to-event from the timeline for each contact
- [ ] Rack position and gear are displayed for the scrubbed frame
- [ ] Retry from the replay screen restarts the scenario
- [ ] Test: the number of replay contact markers equals the number of coalesced contact events scoring counted
