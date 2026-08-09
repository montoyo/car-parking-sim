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

/** Perspective projection. `fovY` in radians, vertical. */
export function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16) as Mat4;
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

/**
 * General (possibly off-axis) perspective frustum, with the sides given at the
 * near plane. The mirrors need this rather than `perspective`: their frustum is
 * the skewed cone the glass subtends from the reflected eye, and centring it
 * would be exactly the hand-wave that destroys the blind spots.
 */
export function frustum(
  left: number,
  right: number,
  bottom: number,
  top: number,
  near: number,
  far: number,
): Mat4 {
  const m = new Float32Array(16) as Mat4;
  m[0] = (2 * near) / (right - left);
  m[5] = (2 * near) / (top - bottom);
  m[8] = (right + left) / (right - left);
  m[9] = (top + bottom) / (top - bottom);
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

export function translation(x: number, y: number, z: number): Mat4 {
  const m = identity();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}

export function rotationX(a: number): Mat4 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const m = identity();
  m[5] = c;
  m[6] = s;
  m[9] = -s;
  m[10] = c;
  return m;
}

export function rotationY(a: number): Mat4 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const m = identity();
  m[0] = c;
  m[2] = -s;
  m[8] = s;
  m[10] = c;
  return m;
}

export function rotationZ(a: number): Mat4 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const m = identity();
  m[0] = c;
  m[1] = s;
  m[4] = -s;
  m[5] = c;
  return m;
}

/**
 * Inverse of a rigid transform (orthonormal rotation plus translation): the
 * rotation is transposed and the translation rotated back. Cheap and exact —
 * a general 4x4 inverse is never needed for camera work.
 */
export function invertRigid(m: Mat4): Mat4 {
  const out = identity();
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[c * 4 + r] = m[r * 4 + c] as number;
    }
  }
  const tx = m[12] as number;
  const ty = m[13] as number;
  const tz = m[14] as number;
  out[12] = -((m[0] as number) * tx + (m[1] as number) * ty + (m[2] as number) * tz);
  out[13] = -((m[4] as number) * tx + (m[5] as number) * ty + (m[6] as number) * tz);
  out[14] = -((m[8] as number) * tx + (m[9] as number) * ty + (m[10] as number) * tz);
  return out;
}

/** Transform a point (w = 1) by a matrix, ignoring any perspective divide. */
export function transformPoint(
  m: Mat4,
  p: { readonly x: number; readonly y: number; readonly z: number },
): { x: number; y: number; z: number } {
  return {
    x: (m[0] as number) * p.x + (m[4] as number) * p.y + (m[8] as number) * p.z + (m[12] as number),
    y: (m[1] as number) * p.x + (m[5] as number) * p.y + (m[9] as number) * p.z + (m[13] as number),
    z: (m[2] as number) * p.x + (m[6] as number) * p.y + (m[10] as number) * p.z + (m[14] as number),
  };
}

/** Transform a direction (w = 0) by a matrix. */
export function transformDirection(
  m: Mat4,
  p: { readonly x: number; readonly y: number; readonly z: number },
): { x: number; y: number; z: number } {
  return {
    x: (m[0] as number) * p.x + (m[4] as number) * p.y + (m[8] as number) * p.z,
    y: (m[1] as number) * p.x + (m[5] as number) * p.y + (m[9] as number) * p.z,
    z: (m[2] as number) * p.x + (m[6] as number) * p.y + (m[10] as number) * p.z,
  };
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
