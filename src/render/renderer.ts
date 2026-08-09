/**
 * Raw WebGL2 renderer. Flat-shaded boxes, a gridded ground plane, and a debug
 * top-down camera that follows the car. No textures beyond the grid lines, no
 * shadows, no framework.
 *
 * It reads the SAME vehicle definition the core does — box dimensions come from
 * `VEHICLE`, never from numbers typed in here.
 */

import type { Bay, Kerb, Obstacle, ObstacleKind, Scenario, VehicleState, WheelId } from '../core/index';
import { VEHICLE, WHEEL_IDS, bodyOutline, wheelPosition } from '../core/index';
import type { Mat4 } from './mat4';
import { multiply, orthographic, perspective, poseMatrix, rotationY, topDownView } from './mat4';
import type { CockpitPiece } from './cockpit';
import { cockpitShell } from './cockpit';
import type { LookState } from './camera';
import { FIRST_PERSON_FOV, LOOK_AHEAD, bodyTransform, firstPersonViewMatrix } from './camera';
import type { MirrorAimSet, MirrorId } from './mirror';
import {
  MIRROR_IDS,
  NEUTRAL_MIRROR_AIM,
  convexWarp,
  manoeuvreSide,
  mirrorDefinition,
  mirrorFrameWorld,
  mirrorTargetSize,
  mirrorViewProjection,
  mirrorsToUpdate,
} from './mirror';

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

/**
 * The mirror glass: a quad in the world, texture-mapped with its own render
 * target by projecting each glass point through the mirror's own view-projection.
 * Projective texturing means the image lines up with the frustum that produced it
 * without a single hand-placed UV, and because the quad is real geometry the
 * cockpit shell occludes it exactly as the door frame occludes a real mirror.
 */
const GLASS_VS = `#version 300 es
in vec3 aPosition;
uniform mat4 uViewProjection;
uniform mat4 uModel;
uniform mat4 uMirrorViewProjection;
out vec4 vMirrorClip;
void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vMirrorClip = uMirrorViewProjection * world;
  gl_Position = uViewProjection * world;
}`;

/**
 * `uWarp` is the convex mirror's radial warp: the sampled radius is compressed
 * toward the centre, so the middle of the glass keeps roughly the scale a flat
 * mirror would give and the extra field the widened frustum captured is squeezed
 * into the edges. Zero for the flat interior mirror, which then samples 1:1.
 */
const GLASS_FS = `#version 300 es
precision highp float;
in vec4 vMirrorClip;
uniform sampler2D uMirror;
uniform float uWarp;
out vec4 outColour;
void main() {
  vec2 ndc = vMirrorClip.xy / vMirrorClip.w;
  float r = length(ndc);
  vec2 warped = ndc * ((1.0 - uWarp) + uWarp * r * r);
  vec2 uv = warped * 0.5 + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    // Outside the glass' own frustum there is nothing to reflect: dark glass.
    outColour = vec4(0.03, 0.03, 0.04, 1.0);
    return;
  }
  outColour = vec4(texture(uMirror, uv).rgb, 1.0);
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

interface GlassProgram {
  readonly program: WebGLProgram;
  readonly vao: WebGLVertexArrayObject;
  readonly uViewProjection: WebGLUniformLocation;
  readonly uModel: WebGLUniformLocation;
  readonly uMirrorViewProjection: WebGLUniformLocation;
  readonly uWarp: WebGLUniformLocation;
}

/** A mirror's off-screen render target. Deliberately tiny — see `mirror.ts`. */
interface MirrorTarget {
  readonly framebuffer: WebGLFramebuffer;
  readonly texture: WebGLTexture;
  readonly width: number;
  readonly height: number;
}

/** Presentation-only per-frame inputs the renderer needs beyond the world state. */
export interface RenderOptions {
  /**
   * The scenario the attempt is in. Drawn by `drawScene`, so the parked cars,
   * kerb and bay markings appear in the mirrors as well as in the windscreen —
   * which is the whole point of judging the manoeuvre from the mirrors.
   */
  readonly scenario?: Scenario;
  /** Where the player has aimed each mirror. */
  readonly mirrorAim?: MirrorAimSet;
  /**
   * Set when the frame rate has dropped below the display's budget. Mirror
   * passes then update less often, the far wing mirror first.
   */
  readonly overBudget?: boolean;
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
  private readonly glass: GlassProgram;
  private readonly mirrors: Readonly<Record<MirrorId, MirrorTarget>>;
  private readonly cockpit: readonly CockpitPiece[] = cockpitShell(VEHICLE);
  private viewMode: ViewMode = 'first-person';
  /** Frames drawn, which is what the mirror update schedule is keyed on. */
  private frameIndex = 0;
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
    this.glass = this.createGlassProgram();
    this.mirrors = {
      interior: this.createMirrorTarget('interior'),
      wingLeft: this.createMirrorTarget('wingLeft'),
      wingRight: this.createMirrorTarget('wingRight'),
    };
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
  render(vehicle: VehicleState, look: LookState = LOOK_AHEAD, options: RenderOptions = {}): void {
    const gl = this.gl;
    const aim = options.mirrorAim ?? NEUTRAL_MIRROR_AIM;
    const firstPerson = this.viewMode === 'first-person';

    // Mirror passes first: they render into their own targets, which the main
    // pass then samples when it draws the glass.
    if (firstPerson) {
      this.renderMirrors(vehicle, aim, options.overBudget === true, options.scenario);
    }
    this.frameIndex++;

    this.resize();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0.09, 0.1, 0.12, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const viewProjection = firstPerson
      ? this.firstPersonViewProjection(vehicle, look)
      : this.debugTopDownViewProjection(vehicle);

    this.drawScene(vehicle, viewProjection, {
      noseMarker: !firstPerson,
      scenario: options.scenario,
    });
    if (firstPerson) {
      this.drawCockpit(vehicle);
      this.drawGlass(vehicle, aim, viewProjection);
    }
  }

  /**
   * The car and the world it sits in, from any camera. Shared by the first-person
   * pass, the debug top-down pass and every mirror pass — a mirror shows the same
   * scene, including the car's own flank and mirror housings, because a driver
   * sees their own bodywork in the wing mirror and uses it as a reference edge.
   */
  private drawScene(
    vehicle: VehicleState,
    viewProjection: Mat4,
    options: {
      readonly noseMarker: boolean;
      readonly skipHousing?: MirrorId | undefined;
      readonly scenario?: Scenario | undefined;
    },
  ): void {
    const gl = this.gl;
    gl.useProgram(this.ground.program);
    gl.uniformMatrix4fv(this.ground.uViewProjection, false, viewProjection);
    gl.bindVertexArray(this.ground.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.useProgram(this.box.program);
    gl.uniformMatrix4fv(this.box.uViewProjection, false, viewProjection);
    gl.bindVertexArray(this.box.vao);

    if (options.scenario) this.drawScenario(options.scenario);

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
    if (options.noseMarker) {
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

    this.drawMirrorHousings(vehicle, options.skipHousing);
  }

  /**
   * One render pass per mirror that is due this frame, into its own small target.
   *
   * The reflection reverses triangle winding, so these passes cull FRONT faces
   * rather than back ones. That has a second, useful consequence: the interior
   * mirror's reflected eye sits inside the body box (as a real interior mirror
   * does), and from in there every face of the box is culled — so the mirror looks
   * out through the greenhouse instead of at the inside of the bodywork, while the
   * wing mirrors, whose reflected eyes are outboard of the flank, still see it.
   */
  /**
   * The scenario: kerb first (it is the ground the rest sits on), then the bay
   * markings, then the obstacles. Drawn with the box program the caller has
   * already bound, and from resolved scenario DATA only — no layout number is
   * written down in the renderer.
   */
  private drawScenario(scenario: Scenario): void {
    if (scenario.kerb) this.drawKerb(scenario.kerb);
    if (scenario.bay) this.drawBayMarkings(scenario.bay);
    for (const obstacle of scenario.obstacles) this.drawObstacle(obstacle);
  }

  /**
   * The raised pavement behind the kerb line, one slab per polyline segment. The
   * kerb face is the vertical side of the slab, which is exactly the surface a
   * rim strikes — so what the player sees is the surface ticket 08 tests against.
   */
  private drawKerb(kerb: Kerb): void {
    for (let i = 1; i < kerb.polyline.length; i++) {
      const a = kerb.polyline[i - 1] as { x: number; y: number };
      const b = kerb.polyline[i] as { x: number; y: number };
      const yaw = Math.atan2(b.y - a.y, b.x - a.x);
      // The pavement is on one declared side of the line; +y of the segment's own
      // frame is its left, so the right-hand side is -y.
      const sign = kerb.raisedSide === 'left' ? 1 : -1;
      const offset = (sign * kerb.pavementWidth) / 2;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      this.drawBox(
        poseMatrix(mid.x - offset * sin, mid.y + offset * cos, kerb.height / 2, yaw),
        { x: 0, y: 0, z: 0 },
        { hx: Math.hypot(b.x - a.x, b.y - a.y) / 2, hy: kerb.pavementWidth / 2, hz: kerb.height / 2 },
        [0.46, 0.46, 0.48],
      );
    }
  }

  /**
   * The target bay: a painted outline, plus a solid block at each corner and a
   * bar across the middle. The corner blocks and the bar are SHAPE cues, not just
   * colour, so the target bay stays unambiguous without relying on hue.
   */
  private drawBayMarkings(bay: Bay): void {
    const paint: readonly [number, number, number] = [0.93, 0.86, 0.36];
    const corners = bay.polygon;
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i] as { x: number; y: number };
      const b = corners[(i + 1) % corners.length] as { x: number; y: number };
      this.drawGroundLine(a, b, 0.06, paint);
      this.drawBox(
        poseMatrix(a.x, a.y, MARKING_HEIGHT, bay.axisYaw),
        { x: 0, y: 0, z: 0 },
        { hx: 0.16, hy: 0.16, hz: MARKING_HEIGHT },
        [0.93, 0.94, 0.96],
      );
    }
    // A bar across the bay's waist: where the middle of the car belongs.
    const half = bay.width / 2 - 0.1;
    const cos = Math.cos(bay.axisYaw);
    const sin = Math.sin(bay.axisYaw);
    this.drawGroundLine(
      { x: bay.centre.x + half * sin, y: bay.centre.y - half * cos },
      { x: bay.centre.x - half * sin, y: bay.centre.y + half * cos },
      0.05,
      paint,
    );
  }

  /** A painted stripe on the ground between two world points. */
  private drawGroundLine(
    a: { readonly x: number; readonly y: number },
    b: { readonly x: number; readonly y: number },
    halfWidth: number,
    colour: readonly [number, number, number],
  ): void {
    const yaw = Math.atan2(b.y - a.y, b.x - a.x);
    this.drawBox(
      poseMatrix((a.x + b.x) / 2, (a.y + b.y) / 2, MARKING_HEIGHT, yaw),
      { x: 0, y: 0, z: 0 },
      { hx: Math.hypot(b.x - a.x, b.y - a.y) / 2, hy: halfWidth, hz: MARKING_HEIGHT },
      colour,
    );
  }

  /**
   * One obstacle. A parked car gets a second, darker box at wheel height so it
   * reads as a car from the driver's seat and in the mirrors rather than as a
   * slab — that lower edge is the reference a driver actually judges the gap by.
   */
  private drawObstacle(obstacle: Obstacle): void {
    const frame = poseMatrix(obstacle.centre.x, obstacle.centre.y, 0, obstacle.yaw);
    if (obstacle.kind === 'parked-car') {
      const bottom = VEHICLE.sillHeight;
      this.drawBox(
        frame,
        { x: 0, y: 0, z: (bottom + obstacle.height) / 2 },
        {
          hx: obstacle.halfLength,
          hy: obstacle.halfWidth,
          hz: (obstacle.height - bottom) / 2,
        },
        OBSTACLE_COLOURS['parked-car'],
      );
      this.drawBox(
        frame,
        { x: 0, y: 0, z: VEHICLE.wheelRadius },
        {
          hx: obstacle.halfLength - 0.55,
          hy: obstacle.halfWidth - 0.09,
          hz: VEHICLE.wheelRadius,
        },
        [0.11, 0.11, 0.12],
      );
      return;
    }
    this.drawBox(
      frame,
      { x: 0, y: 0, z: obstacle.height / 2 },
      { hx: obstacle.halfLength, hy: obstacle.halfWidth, hz: obstacle.height / 2 },
      OBSTACLE_COLOURS[obstacle.kind],
    );
  }

  private renderMirrors(
    vehicle: VehicleState,
    aim: MirrorAimSet,
    overBudget: boolean,
    scenario?: Scenario | undefined,
  ): void {
    const gl = this.gl;
    const due = mirrorsToUpdate(this.frameIndex, manoeuvreSide(vehicle), overBudget);
    if (due.length === 0) return;

    gl.cullFace(gl.FRONT);
    for (const id of due) {
      const target = this.mirrors[id];
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.viewport(0, 0, target.width, target.height);
      gl.clearColor(0.09, 0.1, 0.12, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      this.drawScene(vehicle, mirrorViewProjection(vehicle, id, aim[id]), {
        noseMarker: false,
        skipHousing: id,
        scenario,
      });
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.cullFace(gl.BACK);
  }

  /**
   * The reflective faces, drawn as real quads where the glass is, sampling the
   * targets the mirror passes just filled. Being real geometry, they are occluded
   * by the door frame and the A-pillar and shrink as the driver looks away.
   */
  private drawGlass(vehicle: VehicleState, aim: MirrorAimSet, viewProjection: Mat4): void {
    const gl = this.gl;
    gl.useProgram(this.glass.program);
    gl.bindVertexArray(this.glass.vao);
    gl.uniformMatrix4fv(this.glass.uViewProjection, false, viewProjection);
    // The glass is a single flat face; culling it would depend on which way the
    // mirror's frame happens to wind.
    gl.disable(gl.CULL_FACE);
    for (const id of MIRROR_IDS) {
      const definition = mirrorDefinition(id, VEHICLE);
      const model = multiply(
        mirrorFrameWorld(vehicle, id, aim[id], VEHICLE),
        scaling(definition.width / 2, definition.height / 2, 1),
      );
      gl.uniformMatrix4fv(this.glass.uModel, false, model);
      gl.uniformMatrix4fv(
        this.glass.uMirrorViewProjection,
        false,
        mirrorViewProjection(vehicle, id, aim[id], VEHICLE),
      );
      gl.uniform1f(this.glass.uWarp, convexWarp(vehicle, id, aim[id], VEHICLE));
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.mirrors[id].texture);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.enable(gl.CULL_FACE);
  }

  /**
   * The mirror bodies: a casing behind each glass so the mirrors are objects on
   * the car rather than floating rectangles, and so the wing mirrors read as
   * mounted out on the doors where the flank reference comes from.
   */
  private drawMirrorHousings(vehicle: VehicleState, skip?: MirrorId): void {
    for (const id of MIRROR_IDS) {
      // A mirror never sees its own casing: the casing is directly behind the
      // glass, i.e. right on top of the reflected eye, and would fill the view.
      if (id === skip) continue;
      const definition = mirrorDefinition(id, VEHICLE);
      // Housings ignore aim: the casing is bolted to the car, only the glass moves.
      const frame = mirrorFrameWorld(vehicle, id, undefined, VEHICLE);
      this.drawBox(
        frame,
        { x: 0, y: 0, z: -0.035 },
        {
          hx: (definition.width / 2) * 1.18,
          hy: (definition.height / 2) * 1.35,
          hz: 0.03,
        },
        [0.13, 0.13, 0.14],
      );
    }
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

  private createGlassProgram(): GlassProgram {
    const gl = this.gl;
    const program = compileProgram(gl, GLASS_VS, GLASS_FS);
    // prettier-ignore
    const quad = new Float32Array([
      -1, -1, 0,   1, -1, 0,   1, 1, 0,
      -1, -1, 0,   1,  1, 0,  -1, 1, 0,
    ]);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    bindAttribute(gl, program, 'aPosition', quad, 3);
    gl.bindVertexArray(null);
    gl.useProgram(program);
    gl.uniform1i(uniform(gl, program, 'uMirror'), 0);
    return {
      program,
      vao,
      uViewProjection: uniform(gl, program, 'uViewProjection'),
      uModel: uniform(gl, program, 'uModel'),
      uMirrorViewProjection: uniform(gl, program, 'uMirrorViewProjection'),
      uWarp: uniform(gl, program, 'uWarp'),
    };
  }

  /**
   * A mirror's render target: a small colour texture plus a depth buffer. Linear
   * filtering is what makes a 72-pixel-high mirror read as a coarse reflection
   * rather than as a mosaic.
   */
  private createMirrorTarget(id: MirrorId): MirrorTarget {
    const gl = this.gl;
    const { width, height } = mirrorTargetSize(id, VEHICLE);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);

    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`Mirror render target for ${id} is incomplete.`);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { framebuffer, texture, width, height };
  }
}

/**
 * Half-thickness of painted road markings. They are boxes rather than decals, so
 * they need a sliver of height to beat the ground plane in the depth test.
 */
const MARKING_HEIGHT = 0.004;

const OBSTACLE_COLOURS: Readonly<Record<ObstacleKind, readonly [number, number, number]>> = {
  'parked-car': [0.3, 0.36, 0.46],
  wall: [0.37, 0.37, 0.4],
  bollard: [0.84, 0.56, 0.18],
};

/** Non-uniform scale, used to stretch the unit glass quad onto a mirror. */
function scaling(x: number, y: number, z: number): Mat4 {
  const m = new Float32Array(16) as Mat4;
  m[0] = x;
  m[5] = y;
  m[10] = z;
  m[15] = 1;
  return m;
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
