# 11 — First-person replay toggle and reference line overlay

**What to build:** The player can toggle the replay between the top-down view and the first-person view of the same recorded attempt, so they can reconcile what they saw through the windscreen and mirrors with what the car actually did. Because replay plays back recorded frames, this is a matter of rendering those frames through the driver camera rather than the orthographic one.

An optional reference line — a clean path through the manoeuvre — can be overlaid on the top-down trace so the player can compare their path with a good one. This overlay is the extent of guidance in the game; there is no coaching mode telling the player where to steer next.

**Blocked by:** 04, 10

**Status:** done

- [x] Replay can render the recorded frames through the first-person camera, including mirrors where available
- [x] Toggling between top-down and first-person preserves the current scrub position
- [x] Optional reference line overlays the top-down trace and can be turned off
- [x] Scrub, speed, frame-step and event-jump all work identically in both views
