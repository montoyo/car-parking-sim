# 13 — Gamepad, remapping, and session polish

**What to build:** The player can play with whatever they have and isn't tripped up by rough edges. A gamepad works with analogue steering and pedals, mapping stick position directly to rack target for proportional control — the keyboard's wind-on and self-centre ramping stays as it is, so both devices hand the core the same normalised `ControlInput`. Controls can be remapped, and an on-screen reference means nobody has to guess the keys.

Audio can be muted or adjusted. The game pauses when the tab loses focus so time and physics don't run away unattended. Contact markers and bay lines are distinguished by shape as well as colour, so the feedback stays readable with limited colour vision.

**Blocked by:** 09

**Status:** ready-for-agent

- [ ] Gamepad adapter supports analogue steering and pedals, mapping stick position directly to rack target
- [ ] Both input adapters produce the same normalised `ControlInput` shape; the core is unaware of the device
- [ ] Controls are remappable, and the mapping persists between sessions
- [ ] On-screen control reference available during play
- [ ] Audio mute and volume control
- [ ] Game pauses on tab blur, freezing elapsed time and the simulation
- [ ] Contact markers and bay lines are shape-coded as well as colour-coded
- [ ] Speedometer resolves very low speeds usefully — a creep is distinguishable from a lurch
