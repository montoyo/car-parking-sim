/**
 * Raw WebGL2 renderer. Flat-shaded boxes, a gridded ground plane, and a debug
 * top-down camera that follows the car. No textures beyond the grid lines, no
 * shadows, no framework.
 *
 * It reads the SAME vehicle definition the core does — box dimensions come from
 * `VEHICLE`, never from numbers typed in here.
 */

import type { VehicleState, WheelId } from '../core/index';
import { VEHICLE, WHEEL_IDS, bodyOutline, wheelPosition } from '../core/index';
import type { Mat4 } from './mat4';
import { multiply, orthographic, perspective, poseMatrix, rotationY, topDownView } from './mat4';
import type { CockpitPiece } from './cockpit';
import { cockpitShell } from './cockpit';
import type { LookState } from './camera';
import { FIRST_PERSON_FOV, LOOK_AHEAD, bodyTransform, firstPersonViewMatrix } from './camera';

const BOX_VS = `#version 300 es
in vec3 aPosition;
in vec3 aNormal;
uniform mat4 uViewProjection;
uniform mat4 uModel;
out vec3 vNormal;
void main() {
  vNormal = mat3(uModel) * aNormal;
  gl_Position = uViewProjection * uModel * vec4(aPosition, 1.0);
}`;

const BOX_FS = `#version 300 es
precision highp float;
in vec3 vNormal;
uniform vec3 uColour;
out vec4 outColour;
void main() {
  vec3 n = normalize(vNormal);
  vec3 lightDir = normalize(vec3(0.35, 0.5, 0.8));
  float lambert = max(dot(n, lightDir), 0.0);
  vec3 lit = uColour * (0.42 + 0.58 * lambert);
  outColour = vec4(lit, 1.0);
}`;

const GROUND_VS = `#version 300 es
in vec2 aPosition;
uniform mat4 uViewProjection;
out vec2 vWorld;
void main() {
  vWorld = aPosition;
  gl_Position = uViewProjection * vec4(aPosition, 0.0, 1.0);
}`;

const GROUND_FS = `#version 300 es
precision highp float;
in vec2 vWorld;
out vec4 outColour;
void main() {
  vec2 g = abs(fract(vWorld) - 0.5);
  float line = 1.0 - smoothstep(0.0, 0.03, min(g.x, g.y));
  vec3 base = vec3(0.19, 0.20, 0.22);
  vec3 mark = vec3(0.30, 0.31, 0.34);
  outColour = vec4(mix(base, mark, line), 1.0);
}`;

interface BoxProgram {
  readonly program: WebGLProgram;
  readonly vao: WebGLVertexArrayObject;
  readonly count: number;
  readonly uViewProjection: WebGLUniformLocation;
  readonly uModel: WebGLUniformLocation;
  readonly uColour: WebGLUniformLocation;
}

interface GroundProgram {
  readonly program: WebGLProgram;
  readonly vao: WebGLVertexArrayObject;
  readonly uViewProjection: WebGLUniformLocation;
}

/**
 * Which camera the frame is drawn through. First-person is the game; the
 * top-down debug camera stays available (V) because it is how you check that
 * what the driver sees agrees with where the car actually is.
 */
export type ViewMode = 'first-person' | 'top-down';

/** Half-extents of a unit box drawn centred on its own origin. */
interface BoxSize {
  readonly hx: number;
  readonly hy: number;
  readonly hz: number;
}

export class Renderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly box: BoxProgram;
  private readonly ground: GroundProgram;
  private readonly cockpit: readonly CockpitPiece[] = cockpitShell(VEHICLE);
  private viewMode: ViewMode = 'first-person';
  /** Metres visible vertically in the debug top-down camera. */
  private viewHeightMetres = 22;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true });
    if (!gl) throw new Error('WebGL2 is required and is not available in this browser.');
    this.gl = gl;
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    this.box = this.createBoxProgram();
    this.ground = this.createGroundProgram();
  }

  setViewMode(mode: ViewMode): void {
    this.viewMode = mode;
  }

  get mode(): ViewMode {
    return this.viewMode;
  }

  /** Resize the drawing buffer to the canvas' CSS size and device pixel ratio. */
  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.gl.viewport(0, 0, width, height);
  }

  /**
   * Draw one frame of an (already interpolated) vehicle state, seen from where
   * the driver is looking. One pass, flat shading, no textures: the frame budget
   * goes on holding the refresh rate, which is what low-speed control needs.
   */
  render(vehicle: VehicleState, look: LookState = LOOK_AHEAD): void {
    const gl = this.gl;
    this.resize();
    gl.clearColor(0.09, 0.1, 0.12, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const firstPerson = this.viewMode === 'first-person';
    const viewProjection = firstPerson
      ? this.firstPersonViewProjection(vehicle, look)
      : this.debugTopDownViewProjection(vehicle);

    gl.useProgram(this.ground.program);
    gl.uniformMatrix4fv(this.ground.uViewProjection, false, viewProjection);
    gl.bindVertexArray(this.ground.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.useProgram(this.box.program);
    gl.uniformMatrix4fv(this.box.uViewProjection, false, viewProjection);
    gl.bindVertexArray(this.box.vao);

    // Body: extents straight from the shared vehicle definition.
    const outline = bodyOutline(VEHICLE);
    const xs = outline.map((p) => p.x);
    const centreX = (Math.max(...xs) + Math.min(...xs)) / 2;
    const halfLength = (Math.max(...xs) - Math.min(...xs)) / 2;
    const bodyBottom = VEHICLE.sillHeight;
    const bodyTop = VEHICLE.bodyHeight;
    this.drawBox(
      this.bodyMatrix(vehicle),
      { x: centreX, y: 0, z: (bodyBottom + bodyTop) / 2 },
      { hx: halfLength, hy: VEHICLE.bodyWidth / 2, hz: (bodyTop - bodyBottom) / 2 },
      [0.78, 0.24, 0.22],
    );

    // A nose marker so heading is unambiguous in the debug view — it would sit
    // in the driver's eyeline, so it is drawn only from above.
    if (!firstPerson) {
      this.drawBox(
      this.bodyMatrix(vehicle),
        { x: Math.max(...xs) - 0.12, y: 0, z: bodyTop + 0.02 },
        { hx: 0.12, hy: 0.28, hz: 0.03 },
        [0.95, 0.9, 0.55],
      );
    }

    for (const id of WHEEL_IDS) {
      this.drawWheel(id, vehicle);
    }

    if (firstPerson) this.drawCockpit(vehicle);
  }

  /**
   * The cockpit shell, drawn in the body's frame so it moves and leans with the
   * car. Its pieces are the A-pillars, door frames, roof and bonnet edge — the
   * occlusion that makes parking hard.
   */
  private drawCockpit(vehicle: VehicleState): void {
    const body = this.bodyMatrix(vehicle);
    for (const piece of this.cockpit) {
      const placement = multiply(
        poseMatrix(piece.centre.x, piece.centre.y, piece.centre.z, 0),
        rotationY(piece.slant),
      );
      this.drawBox(
        multiply(body, placement),
        { x: 0, y: 0, z: 0 },
        { hx: piece.half.x, hy: piece.half.y, hz: piece.half.z },
        piece.colour,
      );
    }
  }

  private drawWheel(id: WheelId, vehicle: VehicleState): void {
    const local = wheelPosition(id, VEHICLE);
    const steer = vehicle.wheels[id].steerAngle;
    const model = multiply(
      this.bodyMatrix(vehicle),
      poseMatrix(local.x, local.y, VEHICLE.wheelRadius, steer),
    );
    this.drawBox(
      model,
      { x: 0, y: 0, z: 0 },
      { hx: VEHICLE.wheelRadius, hy: VEHICLE.wheelWidth / 2, hz: VEHICLE.wheelRadius },
      [0.12, 0.12, 0.13],
    );
  }

  private drawBox(
    parent: Mat4,
    offset: { x: number; y: number; z: number },
    size: BoxSize,
    colour: readonly [number, number, number],
  ): void {
    const gl = this.gl;
    const local = poseMatrix(offset.x, offset.y, offset.z, 0);
    local[0] = size.hx;
    local[5] = size.hy;
    local[10] = size.hz;
    gl.uniformMatrix4fv(this.box.uModel, false, multiply(parent, local));
    gl.uniform3f(this.box.uColour, colour[0], colour[1], colour[2]);
    gl.drawArrays(gl.TRIANGLES, 0, this.box.count);
  }

  /**
   * The body's placement, including the cosmetic pitch and roll from the
   * dynamics — the same transform the camera uses, so the shell never floats
   * away from the car as it leans.
   */
  private bodyMatrix(vehicle: VehicleState): Mat4 {
    return bodyTransform(vehicle);
  }

  private firstPersonViewProjection(vehicle: VehicleState, look: LookState): Mat4 {
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    // Near plane inside the cockpit trim; far plane covers a whole car park.
    const projection = perspective(FIRST_PERSON_FOV, aspect, 0.04, 250);
    return multiply(projection, firstPersonViewMatrix(vehicle, look, VEHICLE));
  }

  private debugTopDownViewProjection(vehicle: VehicleState): Mat4 {
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const halfY = this.viewHeightMetres / 2;
    const halfX = halfY * aspect;
    const projection = orthographic(-halfX, halfX, -halfY, halfY, 0.1, 200);
    const view = topDownView(vehicle.pose.x, vehicle.pose.y, 60);
    return multiply(projection, view);
  }

  private createBoxProgram(): BoxProgram {
    const gl = this.gl;
    const program = compileProgram(gl, BOX_VS, BOX_FS);
    const { positions, normals } = unitBoxGeometry();
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    bindAttribute(gl, program, 'aPosition', positions, 3);
    bindAttribute(gl, program, 'aNormal', normals, 3);
    gl.bindVertexArray(null);
    return {
      program,
      vao,
      count: positions.length / 3,
      uViewProjection: uniform(gl, program, 'uViewProjection'),
      uModel: uniform(gl, program, 'uModel'),
      uColour: uniform(gl, program, 'uColour'),
    };
  }

  private createGroundProgram(): GroundProgram {
    const gl = this.gl;
    const program = compileProgram(gl, GROUND_VS, GROUND_FS);
    const extent = 200;
    // prettier-ignore
    const quad = new Float32Array([
      -extent, -extent,  extent, -extent,  extent, extent,
      -extent, -extent,  extent,  extent, -extent, extent,
    ]);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    bindAttribute(gl, program, 'aPosition', quad, 2);
    gl.bindVertexArray(null);
    return { program, vao, uViewProjection: uniform(gl, program, 'uViewProjection') };
  }
}

/** Unit cube spanning [-1, 1] on each axis, flat-shaded via per-face normals. */
function unitBoxGeometry(): { positions: Float32Array; normals: Float32Array } {
  const faces: { normal: [number, number, number]; corners: [number, number, number][] }[] = [
    { normal: [0, 0, 1], corners: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
    { normal: [0, 0, -1], corners: [[-1, 1, -1], [1, 1, -1], [1, -1, -1], [-1, -1, -1]] },
    { normal: [1, 0, 0], corners: [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]] },
    { normal: [-1, 0, 0], corners: [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]] },
    { normal: [0, 1, 0], corners: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
    { normal: [0, -1, 0], corners: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
  ];
  const positions: number[] = [];
  const normals: number[] = [];
  for (const face of faces) {
    const [a, b, c, d] = face.corners as [
      [number, number, number],
      [number, number, number],
      [number, number, number],
      [number, number, number],
    ];
    for (const corner of [a, b, c, a, c, d]) {
      positions.push(corner[0], corner[1], corner[2]);
      normals.push(face.normal[0], face.normal[1], face.normal[2]);
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals) };
}

function compileProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const program = gl.createProgram();
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Shader link failed: ${gl.getProgramInfoLog(program) ?? 'unknown'}`);
  }
  return program;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Could not create shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(shader) ?? 'unknown'}`);
  }
  return shader;
}

function bindAttribute(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
  data: Float32Array,
  components: number,
): void {
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  const location = gl.getAttribLocation(program, name);
  if (location < 0) throw new Error(`Attribute ${name} not found.`);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, components, gl.FLOAT, false, 0, 0);
}

function uniform(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
): WebGLUniformLocation {
  const location = gl.getUniformLocation(program, name);
  if (!location) throw new Error(`Uniform ${name} not found.`);
  return location;
}
