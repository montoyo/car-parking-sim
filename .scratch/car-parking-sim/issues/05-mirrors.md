# 05 — Mirrors: interior flat, wing mirrors convex

**What to build:** The player can park using the mirrors the way they would in a real car. Three mirrors work: an interior rear-view mirror showing a correct reflected view out of the rear window, and left and right wing mirrors showing correct reflected views down each flank.

Each mirror is a real additional render pass into a small render target. The camera pose is derived by reflecting the driver's eye point through the mirror plane defined in the shared vehicle definition, and the frustum is clipped to the mirror's outline. Blind spots must emerge as a consequence of that geometry, not be hand-tuned — a mirror that is merely "a second camera pointing backwards" will feel wrong to anyone who drives, and mirror credibility is a headline requirement of this build.

Wing mirrors are convex: rendered with a wider field of view and a radial warp matching a spherical mirror of a stated radius. The interior mirror is flat. The car's own bodywork appears in the wing mirrors where a driver would see their own flank, because that edge is the reference real drivers use.

The player can adjust mirror aim. Mirror render targets are low resolution and may update at a reduced rate; if the frame budget is exceeded, the interior mirror and the wing mirror on the manoeuvre-relevant side keep priority.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] Three mirrors render as real reflected passes into render targets
- [ ] Mirror camera pose is derived by reflecting the eye point through the mirror plane from the shared vehicle definition — the same numbers the physics reads
- [ ] Each mirror's frustum is clipped to its outline, producing genuine blind spots
- [ ] Wing mirrors are convex with a wider field of view and a radial warp; the interior mirror is flat
- [ ] The car's own bodywork is visible in the wing mirrors
- [ ] Mirror aim is adjustable by the player
- [ ] Render targets are low resolution and may update at reduced rate, with priority given to the interior mirror and the manoeuvre-relevant wing mirror
- [ ] Frame rate holds on a laptop with all three mirror passes active
