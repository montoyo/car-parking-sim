/**
 * The cockpit shell: A-pillars, door frames, roof rails, dashboard, the bonnet
 * edge and the rear screen with the boot lid beyond it, as flat-shaded boxes in
 * the vehicle's local frame.
 *
 * This exists for two reasons. The occlusion is part of the difficulty: a driver
 * cannot see the nearside front corner past the A-pillar or the bonnet, and a
 * parking trainer that quietly deleted those blind spots would teach the wrong
 * habits. But the surfaces the driver DOES sight along matter just as much — the
 * bonnet for the front extent and the boot lid for the rear — and a shell that
 * stopped at the C-pillar left reversing as a blind guess at where the car ends.
 *
 * Every dimension is derived from the shared vehicle definition, so the shell can
 * never drift away from the body the physics uses: the boot lid ends at the same
 * rear face the collision polygon does.
 */

import type { VehicleDefinition } from '../core/index';
import { VEHICLE, frontAxleX, rearAxleX } from '../core/index';

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
 * Top of the boot lid above the road (m). Deliberately just ABOVE the sight line
 * from the driver's eye to the tail: a deck that sat at bonnet height would be
 * hidden behind its own leading edge, and the rear extent — the thing the driver
 * is reversing towards something with — would be invisible again.
 */
function deckZ(v: VehicleDefinition): number {
  return windowLineZ(v) - 0.02;
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
  // The rear: roof header, then the rear screen dropping to the boot lid, which
  // runs back to the tail. `tailX` is the body's own rear face, so the deck ends
  // exactly where the collision polygon does.
  const tailX = rearAxleX(v) - v.rearOverhang;
  const cPillarX = -1.55;
  const rearHeaderX = -1.86;
  const rearScreenBaseX = -1.95;
  const deck = deckZ(v);
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
    // Roof header above the rear screen — the top edge of what a shoulder check
    // looks out through.
    {
      centre: { x: rearHeaderX, y: 0, z: roofZ - 0.05 },
      half: { x: 0.07, y: halfWidth - 0.05, z: 0.05 },
      slant: 0,
      colour: TRIM,
    },
    // Boot lid: the whole point of this rear section. This is the surface the
    // driver sights the car's rear extent along, exactly as the bonnet serves the
    // front, so it is bodywork and it spans the full width of the car.
    {
      centre: { x: (rearScreenBaseX + tailX) / 2, y: 0, z: deck },
      half: { x: (rearScreenBaseX - tailX) / 2, y: halfWidth - 0.03, z: 0.025 },
      slant: 0,
      colour: PAINT,
    },
    // The trailing edge, stood a little proud of the deck. Without it the deck
    // just fades into the road behind and "where does my car stop" stays a guess;
    // with it there is a hard line across the bottom of the rear screen.
    {
      centre: { x: tailX + 0.035, y: 0, z: deck + 0.035 },
      half: { x: 0.035, y: halfWidth - 0.03, z: 0.045 },
      slant: 0,
      colour: PAINT,
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
      centre: { x: cPillarX, y, z: (windowZ + roofZ) / 2 },
      half: { x: 0.1, y: 0.05, z: (roofZ - windowZ) / 2 },
      slant: 0,
      colour: TRIM,
    });
    // Rear screen side frame, from the boot lid up to the rear header. Only the
    // two edges are drawn — the aperture between them is glass, and filling it in
    // would blind the shoulder check this whole section exists to serve.
    pieces.push(
      strut(
        { x: rearScreenBaseX, z: deck + 0.03 },
        { x: rearHeaderX, z: roofZ - 0.06 },
        y,
        0.05,
        0.05,
        TRIM,
      ),
    );
    // Rear quarter trim below the screen line, closing the side off behind the
    // C-pillar so the rear reads as an enclosed boot and not an open frame.
    pieces.push({
      centre: { x: (cPillarX + rearScreenBaseX) / 2, y: y + side * 0.03, z: deck - 0.06 },
      half: { x: Math.abs(cPillarX - rearScreenBaseX) / 2 + 0.1, y: 0.045, z: 0.09 },
      slant: 0,
      colour: TRIM,
    });
  }

  return pieces;
}
