# 04 — First-person driver's seat view

**What to build:** The player sees the world from the driver's seat rather than from a debug camera. The eye point sits on the correct side of the car at a realistic height, taken from the vehicle definition, so the player's sense of where the car's extents are is right.

The player can look around freely with the mouse, and can snap-look left, right and over the shoulder with a single control each, because shoulder checks should cost one button rather than a mouse sweep.

The cockpit shell is rendered — A-pillars, door frame, bonnet edge — so the occlusion that makes parking genuinely hard is present rather than being quietly optimised away.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] First-person camera at the vehicle definition's driver eye point, on the correct side and at a realistic height
- [ ] Free mouse look
- [ ] One-button look left, look right, and look back
- [ ] Cockpit shell renders A-pillars, door frame and bonnet edge, occluding the view as they would in reality
- [ ] Cosmetic pitch and roll from 03, where already available, feed the camera
- [ ] Frame rate holds on a laptop with the first-person pass active
