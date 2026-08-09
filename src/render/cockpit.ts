/**
 * The cockpit shell: A-pillars, door frames, roof rails, dashboard and the
 * bonnet edge, as flat-shaded boxes in the vehicle's local frame.
 *
 * This exists for one reason: the occlusion is part of the difficulty. A driver
 * cannot see the nearside front corner past the A-pillar or the bonnet, and a
 * parking trainer that quietly deleted those blind spots would teach the wrong
 * habits. Every dimension is derived from the shared vehicle definition, so the
 * shell can never drift away from the body the physics uses.
 */

import type { VehicleDefinition } from '../core/index';
import { VEHICLE, frontAxleX } from '../core/index';

/** A box in vehicle-local coordinates, optionally slanted about the local y axis. */
export interface CockpitPiece {
  readonly centre: { readonly x: number; readonly y: number; readonly z: number };
  /** Half-extents along the piece's own axes (m). */
  readonly half: { readonly x: number; readonly y: number; readonly z: number };
  /** Rotation about the local +y axis (rad); 0 for upright, axis-aligned pieces. */
  readonly slant: number;
  readonly colour: readonly [number, number, number];
}

const TRIM: readonly [number, number, number] = [0.15, 0.15, 0.17];
const DASH: readonly [number, number, number] = [0.11, 0.11, 0.12];
const PAINT: readonly [number, number, number] = [0.7, 0.21, 0.2];

/** Height of the window line (bottom of the side glass) above the road (m). */
function windowLineZ(v: VehicleDefinition): number {
  return v.bodyHeight - 0.44;
}

/** Top of the bonnet above the road (m) — the reference edge a driver sights along. */
function bonnetZ(v: VehicleDefinition): number {
  return v.bodyHeight - 0.53;
}

/**
 * A box spanning two points along its long axis, slanted in the x-z plane.
 * Used for the A-pillars, which are neither vertical nor horizontal.
 */
function strut(
  from: { x: number; z: number },
  to: { x: number; z: number },
  y: number,
  halfY: number,
  halfThickness: number,
  colour: readonly [number, number, number],
): CockpitPiece {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  // Rotation about +y takes local +x to (cos, 0, -sin), so the slant that aims
  // the long axis along (dx, dz) is atan2(-dz, dx).
  return {
    centre: { x: (from.x + to.x) / 2, y, z: (from.z + to.z) / 2 },
    half: { x: length / 2, y: halfY, z: halfThickness },
    slant: Math.atan2(-dz, dx),
    colour,
  };
}

/**
 * The cockpit shell for a vehicle definition. Pure, cheap, and computed once at
 * renderer construction — none of it changes as the car moves.
 */
export function cockpitShell(v: VehicleDefinition = VEHICLE): readonly CockpitPiece[] {
  const halfWidth = v.bodyWidth / 2;
  const noseX = frontAxleX(v) + v.frontOverhang;
  const screenBaseX = 0.95;
  const headerX = 0.34;
  const roofZ = v.bodyHeight;
  const windowZ = windowLineZ(v);
  const bonnet = bonnetZ(v);
  // Trim sits just inboard of the bodywork so it reads as interior, not as body.
  const trimY = halfWidth - 0.07;

  const pieces: CockpitPiece[] = [
    // Bonnet: the visible top surface of the nose, and the edge the driver sights
    // the car's front extent along. Drawn as bodywork, not trim.
    {
      centre: { x: (screenBaseX + noseX) / 2, y: 0, z: bonnet },
      half: { x: (noseX - screenBaseX) / 2, y: halfWidth - 0.03, z: 0.035 },
      slant: 0,
      colour: PAINT,
    },
    // Dashboard and windscreen base, occluding everything low and close.
    {
      centre: { x: (headerX + screenBaseX) / 2 + 0.06, y: 0, z: bonnet - 0.06 },
      half: { x: (screenBaseX - headerX) / 2, y: halfWidth - 0.05, z: 0.12 },
      slant: 0,
      colour: DASH,
    },
    // Roof header above the windscreen.
    {
      centre: { x: headerX, y: 0, z: roofZ - 0.05 },
      half: { x: 0.07, y: halfWidth - 0.05, z: 0.05 },
      slant: 0,
      colour: TRIM,
    },
    // Roof panel, so looking up is roof rather than sky.
    {
      centre: { x: headerX - 1.1, y: 0, z: roofZ - 0.02 },
      half: { x: 1.1, y: halfWidth - 0.05, z: 0.025 },
      slant: 0,
      colour: TRIM,
    },
  ];

  for (const side of [1, -1]) {
    const y = side * trimY;
    // A-pillar: base at the windscreen corner, top at the roof header. This is
    // the pillar that hides the nearside front corner in a tight turn.
    pieces.push(
      strut({ x: screenBaseX, z: bonnet + 0.02 }, { x: headerX, z: roofZ - 0.06 }, y, 0.055, 0.05, TRIM),
    );
    // Door window sill, running from the A-pillar back past the driver.
    pieces.push({
      centre: { x: -0.35, y: y + side * 0.03, z: windowZ - 0.06 },
      half: { x: 1.25, y: 0.045, z: 0.09 },
      slant: 0,
      colour: TRIM,
    });
    // B-pillar behind the driver's shoulder — the shoulder check has to work
    // around it, exactly as in the real car.
    pieces.push({
      centre: { x: -0.9, y, z: (windowZ + roofZ) / 2 },
      half: { x: 0.07, y: 0.05, z: (roofZ - windowZ) / 2 },
      slant: 0,
      colour: TRIM,
    });
    // Roof rail above the side glass.
    pieces.push({
      centre: { x: -0.45, y, z: roofZ - 0.06 },
      half: { x: 1.0, y: 0.05, z: 0.055 },
      slant: 0,
      colour: TRIM,
    });
    // C-pillar and rear quarter, closing the cabin behind the door.
    pieces.push({
      centre: { x: -1.55, y, z: (windowZ + roofZ) / 2 },
      half: { x: 0.1, y: 0.05, z: (roofZ - windowZ) / 2 },
      slant: 0,
      colour: TRIM,
    });
  }

  return pieces;
}
