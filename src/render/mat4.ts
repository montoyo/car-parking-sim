/** Minimal column-major 4x4 matrix helpers. No dependencies, no allocations hidden. */

export type Mat4 = Float32Array;

export function identity(): Mat4 {
  // prettier-ignore
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += (a[k * 4 + r] as number) * (b[c * 4 + k] as number);
      }
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

/** Orthographic projection into WebGL clip space. */
export function orthographic(
  left: number,
  right: number,
  bottom: number,
  top: number,
  near: number,
  far: number,
): Mat4 {
  const m = identity();
  m[0] = 2 / (right - left);
  m[5] = 2 / (top - bottom);
  m[10] = -2 / (far - near);
  m[12] = -(right + left) / (right - left);
  m[13] = -(top + bottom) / (top - bottom);
  m[14] = -(far + near) / (far - near);
  return m;
}

/**
 * Camera looking straight down at (`cx`, `cy`) from above, with world +y mapped
 * to screen up and world +x to screen right. World z is depth.
 */
export function topDownView(cx: number, cy: number, height: number): Mat4 {
  // Eye space: x_e = x - cx, y_e = y - cy, z_e = z - height. The camera looks
  // along -z_e, so ground (z ~ 0) sits `height` metres in front of it.
  const m = identity();
  m[12] = -cx;
  m[13] = -cy;
  m[14] = -height;
  return m;
}

/** Translate then rotate about the z axis (yaw), applied as T * Rz. */
export function poseMatrix(x: number, y: number, z: number, yaw: number): Mat4 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const m = identity();
  m[0] = c;
  m[1] = s;
  m[4] = -s;
  m[5] = c;
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}
