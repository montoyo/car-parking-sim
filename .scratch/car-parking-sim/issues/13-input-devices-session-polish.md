# 13 — Gamepad, remapping, and session polish

**What to build:** The player can play with whatever they have and isn't tripped up by rough edges. A gamepad works with analogue steering and pedals, mapping stick position directly to rack target for proportional control — the keyboard's wind-on and self-centre ramping stays as it is, so both devices hand the core the same normalised `ControlInput`. Controls can be remapped, and an on-screen reference means nobody has to guess the keys.

Audio can be muted or adjusted. The game pauses when the tab loses focus so time and physics don't run away unattended. Contact markers and bay lines are distinguished by shape as well as colour, so the feedback stays readable with limited colour vision.

**Blocked by:** 09

**Status:** done

- [x] Gamepad adapter supports analogue steering and pedals, mapping stick position directly to rack target
- [x] Both input adapters produce the same normalised `ControlInput` shape; the core is unaware of the device
- [x] Controls are remappable, and the mapping persists between sessions
- [x] On-screen control reference available during play
- [x] Audio mute and volume control
- [x] Game pauses on tab blur, freezing elapsed time and the simulation
- [x] Contact markers and bay lines are shape-coded as well as colour-coded
- [x] Speedometer resolves very low speeds usefully — a creep is distinguishable from a lurch

## Notes

- `src/input/bindings.ts` is now the ONE registry of every key the game listens for —
  driving, head, mirrors, session, replay and menu alike. Two actions may share a code
  only when their scopes can never be live together (`Space` is the handbrake while
  driving and play/pause on the replay screen). `assertNoDuplicateBindings` runs at
  startup and in `tests/bindings.test.ts`, which reconstructs the historical
  `KeyR` = gear-reverse + restart collision and asserts it is reported. The adapters'
  own `DEFAULT_*_BINDINGS` are derived from the registry, so the shipped keys are
  written down once.
- Rebinding takes a key away from any overlapping claimant, so the invariant holds by
  construction rather than by the player picking a free key. Mapping persists in
  `localStorage`; a stored set that double-claims a key is discarded.
- Contact markers (per-severity glyphs) and bay lines (dashes plus corner blocks and a
  waist tick) were already shape-coded by tickets 08 and 10; verified rather than
  rebuilt.
