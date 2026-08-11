/**
 * The sun, and the view-projection the shadow pass renders depth through.
 *
 * Shadows are the one cue that tells a driver where the car actually is relative
 * to the ground: without them a box floats, and the gap between a wheel and the
 * kerb is unreadable. The light is a single directional sun, so the shadow pass
 * is one orthographic depth render — and because the depth map is in world
 * space, it is view independent: rendered once per frame and sampled by the
 * windscreen pass, every mirror pass and the reversing camera alike.
 *
 * The projection follows the car rather than covering the whole car park: a
 * fixed 1024-pixel map over the 60 metres a scenario might span would give
 * texels the size of a wheel. Centring a modest box on the car keeps the texel
 * fine enough that the shadow edge under the bumper is where the bumper is.
 */

import type { Mat4 } from './mat4';
import { identity, invertRigid, multiply, orthographic } from './mat4';

/**
 * Direction from a lit surface TOWARD the sun, in world axes (z up). Kept
 * deliberately identical to the vector the surface shading uses, so the lit side
 * of a box and the side its shadow falls away from can never disagree.
 */
export const SUN_DIRECTION: { readonly x: number; readonly y: number; readonly z: number } =
  normalise({ x: 0.35, y: 0.5, z: 0.8 });

/** Resolution of the square depth map. */
export const SHADOW_MAP_SIZE = 1024;

/**
 * Half-width of the ground the map covers, in metres. Wide enough to hold the
 * car, the bay it is going into and the cars either side of it — which is all
 * that is ever on screen while parking.
 */
export const SHADOW_EXTENT_METRES = 14;

/** How far back along the light the depth camera sits. Sets the far plane too. */
const LIGHT_DISTANCE_METRES = 40;

/**
 * World-space texel size of the map, which is what the depth bias has to be
 * scaled against: a bias smaller than a texel's worth of slope lets a surface
 * shadow itself (acne), a much larger one lifts shadows off their casters.
 */
export function shadowTexelMetres(): number {
  return (2 * SHADOW_EXTENT_METRES) / SHADOW_MAP_SIZE;
}

/**
 * The light's view-projection, centred on a point on the ground.
 *
 * The centre is snapped to whole texels. Without that, moving the car by a
 * fraction of a texel reshuffles which samples land inside a caster and every
 * shadow edge in the scene crawls — the classic shimmer of a following shadow
 * camera, and very visible at parking speeds where the car is nearly still.
 */
export function shadowViewProjection(centre: {
  readonly x: number;
  readonly y: number;
}): Mat4 {
  const view = shadowView(centre);
  const projection = orthographic(
    -SHADOW_EXTENT_METRES,
    SHADOW_EXTENT_METRES,
    -SHADOW_EXTENT_METRES,
    SHADOW_EXTENT_METRES,
    0.1,
    2 * LIGHT_DISTANCE_METRES,
  );
  return multiply(projection, view);
}

/** The depth camera's view matrix: looking down the sun direction at `centre`. */
function shadowView(centre: { readonly x: number; readonly y: number }): Mat4 {
  const back = SUN_DIRECTION; // camera looks along -back, i.e. down the light
  // Any world axis not parallel to the light will do to seed the basis; the sun
  // is high but never straight up, so world +z is safe.
  const right = normalise(cross({ x: 0, y: 0, z: 1 }, back));
  const up = cross(back, right);

  const eye = {
    x: centre.x + back.x * LIGHT_DISTANCE_METRES,
    y: centre.y + back.y * LIGHT_DISTANCE_METRES,
    z: back.z * LIGHT_DISTANCE_METRES,
  };

  const world = identity();
  world[0] = right.x;
  world[1] = right.y;
  world[2] = right.z;
  world[4] = up.x;
  world[5] = up.y;
  world[6] = up.z;
  world[8] = back.x;
  world[9] = back.y;
  world[10] = back.z;
  world[12] = eye.x;
  world[13] = eye.y;
  world[14] = eye.z;

  const view = invertRigid(world);
  // Snap in the light's own x/y, which is the plane the depth map is sampled in:
  // snapping the world centre instead would still slide the texel grid.
  const texel = shadowTexelMetres();
  view[12] = Math.round((view[12] as number) / texel) * texel;
  view[13] = Math.round((view[13] as number) / texel) * texel;
  return view;
}

function cross(
  a: { readonly x: number; readonly y: number; readonly z: number },
  b: { readonly x: number; readonly y: number; readonly z: number },
): { x: number; y: number; z: number } {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalise(v: {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}): { x: number; y: number; z: number } {
  const length = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}
