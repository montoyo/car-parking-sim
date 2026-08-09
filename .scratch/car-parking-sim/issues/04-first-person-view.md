# 04 — First-person driver's seat view

**What to build:** The player sees the world from the driver's seat rather than from a debug camera. The eye point sits on the correct side of the car at a realistic height, taken from the vehicle definition, so the player's sense of where the car's extents are is right.

The player can look around freely with the mouse, and can snap-look left, right and over the shoulder with a single control each, because shoulder checks should cost one button rather than a mouse sweep.

The cockpit shell is rendered — A-pillars, door frame, bonnet edge — so the occlusion that makes parking genuinely hard is present rather than being quietly optimised away.

**Blocked by:** 01

**Status:** done

- [x] First-person camera at the vehicle definition's driver eye point, on the correct side and at a realistic height
- [x] Free mouse look
- [x] One-button look left, look right, and look back
- [x] Cockpit shell renders A-pillars, door frame and bonnet edge, occluding the view as they would in reality
- [x] Cosmetic pitch and roll from 03, where already available, feed the camera
- [x] Frame rate holds on a laptop with the first-person pass active

## Implementation notes

- `src/render/camera.ts` owns the driver's-seat camera: `driverEyeWorld`, `bodyTransform`,
  `firstPersonViewMatrix`, `firstPersonGazeDirection`, `clampLook`, `approachLook`,
  plus `LOOK_LIMITS`, `SNAP_LOOK` and `FIRST_PERSON_FOV`. Eye point comes from
  `VEHICLE.driverEyePoint`; nothing here re-declares a dimension.
- `src/input/look.ts` is the head device adapter (pointer-lock mouse look, Q/E/C snaps,
  Z recentre). It advances on the display clock and never feeds the core.
- `src/render/cockpit.ts` derives the shell (bonnet edge, dash, A/B/C pillars, sills,
  roof) from the vehicle definition; the renderer draws it in the body frame so it
  leans with the cosmetic pitch/roll.
- `tests/camera.test.ts` tests only the pure camera maths — the WebGL passes and the
  shell's appearance are verified by eye per the spec (checked in the browser: driver's
  eye height, bonnet edge in view ahead, door aperture and B-pillar on a left snap look,
  ~120 fps).
