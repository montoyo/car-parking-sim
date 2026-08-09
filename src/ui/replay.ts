/**
 * The top-down replay screen.
 *
 * Everything here is PLAYBACK of a `Recording`: the scenario drawn from above, the
 * body-centre and per-wheel traces drawn from the recorded frames, and the car
 * itself placed at whichever frame the player has scrubbed to. Nothing steps the
 * simulation — there is no `step` import in this file, and that is the point: a
 * re-simulated replay could show a collision that never happened.
 *
 * Every control reduces to setting one number, `index`:
 *
 *   scrub          -> index = slider value
 *   frame step     -> index += 1
 *   play at rate r -> index += r * elapsed / FIXED_DT
 *   jump to event  -> index = marker.frameIndex
 *
 * Drawn on a 2D canvas rather than through the WebGL renderer: it is a diagram of
 * the manoeuvre — polylines, arrows and marker glyphs — not a view of the world,
 * and the WebGL pass has no business growing a line renderer for it.
 *
 * Presentation only, and verified by eye per the spec. Contact markers and gear
 * markers are distinguished by SHAPE as well as colour so the feedback survives
 * limited colour vision.
 */

import type {
  Bay,
  ContactMarker,
  Frame,
  GearChangeMarker,
  Kerb,
  Obstacle,
  Recording,
  Scenario,
  Vec2,
  VehicleState,
  WheelId,
} from '../core/index';
import {
  FIXED_DT,
  VEHICLE,
  WHEEL_IDS,
  bodyPolygon,
  bodyTrace,
  contactMarkers,
  frameAt,
  gearChangeMarkers,
  obstaclePolygon,
  referenceLine,
  wheelPosition,
  wheelTrace,
} from '../core/index';
import { interpolateFrames } from '../render/interpolate';

/** Playback rates, cycled by the speed button. Slow is the useful end. */
const RATES: readonly number[] = [0.1, 0.25, 0.5, 1, 2];
const DEFAULT_RATE_INDEX = 3;

/** Metres of padding around everything the replay has to fit on screen. */
const VIEW_MARGIN = 1.6;

/**
 * One direction-of-travel chevron every this many SECONDS of recording, converted
 * to frames below. Stated in seconds so the spacing does not change if the fixed
 * timestep ever does.
 */
const ARROW_EVERY_SECONDS = 0.8;
const ARROW_EVERY = Math.max(1, Math.round(ARROW_EVERY_SECONDS / FIXED_DT));

const TRACE_COLOUR: Readonly<Record<WheelId, string>> = {
  frontLeft: '#6fd3ff',
  frontRight: '#4aa3ff',
  rearLeft: '#ffd166',
  rearRight: '#f4a13a',
};

/** The reference line: a clean path, drawn faintly so it never outshouts the trace. */
const REFERENCE_COLOUR = 'rgba(155, 227, 111, 0.75)';

const SEVERITY_COLOUR = {
  graze: '#ffd166',
  knock: '#ff9f43',
  impact: '#ff5252',
} as const;

/** Which camera the recorded frames are watched through. */
export type ReplayView = 'top-down' | 'first-person';

interface ViewTransform {
  readonly scale: number;
  readonly originX: number;
  readonly originY: number;
}

export class ReplayScreen {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly scrub: HTMLInputElement;
  private readonly readout: HTMLElement;
  private readonly events: HTMLElement;
  private readonly playButton: HTMLButtonElement;
  private readonly speedButton: HTMLButtonElement;
  private readonly viewButton: HTMLButtonElement;
  private readonly referenceButton: HTMLButtonElement;

  private recording: Recording | null = null;
  private markers: readonly ContactMarker[] = [];
  private gearMarkers: readonly GearChangeMarker[] = [];
  /** The one piece of playback state. Fractional while playing; floored to draw. */
  private index = 0;
  private playing = false;
  private rateIndex = DEFAULT_RATE_INDEX;
  private transform: ViewTransform = { scale: 20, originX: 0, originY: 0 };
  /**
   * Which camera the SAME recorded frames are shown through. Nothing about
   * playback changes with it — `index` is still the whole of the playback state,
   * so scrub, frame-step, speed and event-jump behave identically in both, and
   * switching view keeps the player exactly where they were scrubbed to.
   */
  private viewMode: ReplayView = 'top-down';
  private reference: readonly Vec2[] = [];
  private referenceOn = false;

  constructor(root: HTMLElement, private readonly onRetry: () => void) {
    this.root = root;
    root.innerHTML =
      '<canvas class="replay-canvas"></canvas>' +
      '<div class="replay-readout"></div>' +
      '<div class="replay-bar">' +
      '<div class="replay-controls">' +
      '<button data-act="stepBack" title="frame back (,)">|&lt;</button>' +
      '<button data-act="play" title="play / pause (space)">play</button>' +
      '<button data-act="stepForward" title="frame forward (.)">&gt;|</button>' +
      '<button data-act="speed" title="playback speed ([ / ])">1x</button>' +
      '<button data-act="view" title="top-down / driver\'s seat (T)">driver\'s seat</button>' +
      '<button data-act="reference" title="reference line overlay (G)">ref line: off</button>' +
      '<button data-act="retry" title="restart the scenario (Backspace)">retry</button>' +
      '</div>' +
      '<input class="replay-scrub" type="range" min="0" max="1" step="1" value="0" />' +
      '<div class="replay-events"></div>' +
      '</div>';

    this.canvas = requireElement(root, '.replay-canvas', HTMLCanvasElement);
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('2D canvas context is required for the replay.');
    this.context = context;
    this.scrub = requireElement(root, '.replay-scrub', HTMLInputElement);
    this.readout = requireElement(root, '.replay-readout', HTMLElement);
    this.events = requireElement(root, '.replay-events', HTMLElement);
    this.playButton = requireElement(root, '[data-act="play"]', HTMLButtonElement);
    this.speedButton = requireElement(root, '[data-act="speed"]', HTMLButtonElement);
    this.viewButton = requireElement(root, '[data-act="view"]', HTMLButtonElement);
    this.referenceButton = requireElement(root, '[data-act="reference"]', HTMLButtonElement);

    this.scrub.addEventListener('input', () => {
      this.playing = false;
      this.seek(Number(this.scrub.value));
    });
    root.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const act = target.dataset.act;
      if (act === 'play') this.togglePlay();
      if (act === 'stepBack') this.step(-1);
      if (act === 'stepForward') this.step(1);
      if (act === 'speed') this.cycleRate();
      if (act === 'view') this.toggleView();
      if (act === 'reference') this.toggleReference();
      if (act === 'retry') this.onRetry();
      const jump = target.dataset.frame;
      if (jump !== undefined) {
        this.playing = false;
        this.seek(Number(jump));
      }
    });

    this.hide();
  }

  /** Replay keys, live only while the replay is on screen. */
  attach(target: Window): void {
    target.addEventListener('keydown', (e) => {
      if (!this.visible) return;
      if (e.code === 'Space') {
        e.preventDefault();
        this.togglePlay();
      }
      if (e.code === 'Comma') this.step(-1);
      if (e.code === 'Period') this.step(1);
      if (e.code === 'ArrowLeft') this.step(-1);
      if (e.code === 'ArrowRight') this.step(1);
      if (e.code === 'BracketLeft') this.cycleRate(-1);
      if (e.code === 'BracketRight') this.cycleRate(1);
      if (e.code === 'KeyT') this.toggleView();
      if (e.code === 'KeyG') this.toggleReference();
    });
  }

  get visible(): boolean {
    return this.recording !== null;
  }

  /** Which camera the replay is being watched through. */
  get view(): ReplayView {
    return this.viewMode;
  }

  /** The layout the recorded attempt was driven in, for the first-person pass. */
  get scenario(): Scenario | null {
    return this.recording?.scenario ?? null;
  }

  /**
   * The scrubbed moment as a vehicle state, for rendering the recording through
   * the driver's camera. Interpolated between the two frames either side of a
   * fractional index, so playback is smooth at the display rate rather than
   * stepping at the fixed timestep. `null` when nothing is being replayed.
   */
  vehicleAtScrub(): VehicleState | null {
    const recording = this.recording;
    if (recording === null) return null;
    const last = recording.frames.length - 1;
    const lower = Math.min(Math.floor(this.index), last);
    const upper = Math.min(lower + 1, last);
    return interpolateFrames(
      frameAt(recording, lower),
      frameAt(recording, upper),
      this.index - lower,
    );
  }

  /** Open the replay on a finished attempt, parked on its last frame. */
  show(recording: Recording): void {
    this.recording = recording;
    this.markers = contactMarkers(recording);
    this.gearMarkers = gearChangeMarkers(recording);
    this.index = Math.max(0, recording.frames.length - 1);
    this.playing = false;
    this.rateIndex = DEFAULT_RATE_INDEX;
    this.reference = referenceLine(recording.scenario);
    this.setViewMode('top-down');
    this.scrub.max = String(Math.max(0, recording.frames.length - 1));
    this.scrub.value = String(this.index);
    this.events.innerHTML = this.eventButtons();
    this.root.style.display = 'flex';
    this.draw();
  }

  hide(): void {
    this.recording = null;
    this.playing = false;
    this.root.style.display = 'none';
  }

  /**
   * Advance playback on the DISPLAY clock (the recording's own clock is the fixed
   * timestep, which is what `rate` is expressed against) and redraw.
   */
  update(elapsedSeconds: number): void {
    const recording = this.recording;
    if (recording === null) return;
    if (this.playing && elapsedSeconds > 0) {
      const last = recording.frames.length - 1;
      this.index += (elapsedSeconds / FIXED_DT) * this.rate;
      if (this.index >= last) {
        this.index = last;
        this.playing = false;
        this.playButton.textContent = 'play';
      }
      this.scrub.value = String(Math.round(this.index));
    }
    this.draw();
  }

  private get rate(): number {
    return RATES[this.rateIndex] as number;
  }

  private togglePlay(): void {
    const recording = this.recording;
    if (recording === null) return;
    // Pressing play on the last frame replays from the start, which is what the
    // player wants after landing there straight off a finished attempt.
    if (!this.playing && this.index >= recording.frames.length - 1) this.index = 0;
    this.playing = !this.playing;
    this.playButton.textContent = this.playing ? 'pause' : 'play';
  }

  private cycleRate(direction = 1): void {
    this.rateIndex = (this.rateIndex + direction + RATES.length) % RATES.length;
    this.speedButton.textContent = `${this.rate}x`;
  }

  private toggleView(): void {
    this.setViewMode(this.viewMode === 'top-down' ? 'first-person' : 'top-down');
  }

  /**
   * Swapping camera touches nothing but which surface is on screen: the frame
   * index, playing state and rate all survive, which is what makes the toggle a
   * way of reconciling the two views of one moment.
   */
  private setViewMode(mode: ReplayView): void {
    this.viewMode = mode;
    this.viewButton.textContent = mode === 'top-down' ? "driver's seat" : 'top-down';
    // In the driver's seat the WebGL viewport underneath IS the picture, so the
    // diagram canvas steps out of the way and only the controls remain.
    this.canvas.style.display = mode === 'top-down' ? '' : 'none';
    this.draw();
  }

  private toggleReference(): void {
    this.referenceOn = !this.referenceOn;
    this.referenceButton.textContent = `ref line: ${this.referenceOn ? 'on' : 'off'}`;
    this.draw();
  }

  private step(frames: number): void {
    this.playing = false;
    this.playButton.textContent = 'play';
    this.seek(Math.round(this.index) + frames);
  }

  private seek(index: number): void {
    const recording = this.recording;
    if (recording === null) return;
    const last = recording.frames.length - 1;
    this.index = index < 0 ? 0 : index > last ? last : index;
    this.scrub.value = String(Math.round(this.index));
    this.draw();
  }

  /** One button per contact and per gear change: the jump-to-event timeline. */
  private eventButtons(): string {
    const recording = this.recording;
    if (recording === null) return '';
    const all = [...this.markers, ...this.gearMarkers].sort((a, b) => a.tick - b.tick);
    if (all.length === 0) return '<span class="replay-clean">clean run — no contacts</span>';
    return all
      .map((m) => {
        const seconds = frameAt(recording, m.frameIndex).time.toFixed(1);
        const glyph = m.kind === 'contact' ? severityGlyph(m.severity) : '[]';
        const cls = m.kind === 'contact' ? `replay-jump sev-${m.severity}` : 'replay-jump gear';
        return `<button class="${cls}" data-frame="${m.frameIndex}">${glyph} ${m.label} @${seconds}s</button>`;
      })
      .join('');
  }

  private draw(): void {
    const recording = this.recording;
    if (recording === null) return;
    const context = this.context;
    // In the driver's seat there is no diagram to draw — the readout below still
    // reports the scrubbed frame, and the WebGL pass draws the car's-eye view.
    if (this.viewMode === 'first-person') {
      this.updateReadout(frameAt(recording, this.index));
      return;
    }
    this.resize();
    // Before the browser has laid the canvas out there is nothing to fit to; the
    // next display frame calls `update` and draws properly.
    if (this.canvas.width <= 1 || this.canvas.height <= 1) return;
    this.transform = this.fit(recording);

    context.fillStyle = '#181a1e';
    context.fillRect(0, 0, this.canvas.width, this.canvas.height);

    if (recording.scenario.kerb) this.drawKerb(recording.scenario.kerb);
    if (recording.scenario.bay) this.drawBay(recording.scenario.bay);
    for (const obstacle of recording.scenario.obstacles) this.drawObstacle(obstacle);

    // Under the traces: guidance is a backdrop to the player's own path, never a
    // line drawn on top of it.
    if (this.referenceOn) this.drawReference();

    const upTo = Math.floor(this.index) + 1;
    for (const id of WHEEL_IDS) {
      this.drawTrace(wheelTrace(recording, id).slice(0, upTo), TRACE_COLOUR[id], 1.4);
    }
    this.drawTrace(bodyTrace(recording).slice(0, upTo), 'rgba(230,230,230,0.85)', 2);
    this.drawDirectionArrows(recording, upTo);
    for (const marker of this.gearMarkers) this.drawGearMarker(marker);

    this.drawCar(frameAt(recording, this.index));
    // Contacts last: the spot the player came to study must never end up under the
    // car it is being studied through.
    for (const marker of this.markers) this.drawContactMarker(marker);
    this.updateReadout(frameAt(recording, this.index));
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  /**
   * An orthographic fit around THE MANOEUVRE — every pose the car held, plus the
   * target bay — and not around the whole scenario: the kerb runs the length of the
   * street and a lane-wide fit would shrink the traces to a scribble. Whatever of
   * the street falls outside simply draws off the edges. World +y is drawn up.
   */
  private fit(recording: Recording): ViewTransform {
    const points: Vec2[] = [];
    if (recording.scenario.bay) points.push(...recording.scenario.bay.polygon);
    for (const frame of recording.frames) points.push(...bodyPolygon(frame.pose, VEHICLE));
    if (points.length === 0) points.push({ x: 0, y: 0 });

    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const minX = Math.min(...xs) - VIEW_MARGIN;
    const maxX = Math.max(...xs) + VIEW_MARGIN;
    const minY = Math.min(...ys) - VIEW_MARGIN;
    const maxY = Math.max(...ys) + VIEW_MARGIN;
    const scale = Math.min(
      this.canvas.width / Math.max(0.1, maxX - minX),
      this.canvas.height / Math.max(0.1, maxY - minY),
    );
    return {
      scale,
      originX: this.canvas.width / 2 - ((minX + maxX) / 2) * scale,
      originY: this.canvas.height / 2 + ((minY + maxY) / 2) * scale,
    };
  }

  private toScreen(p: Vec2): Vec2 {
    return { x: this.transform.originX + p.x * this.transform.scale, y: this.transform.originY - p.y * this.transform.scale };
  }

  private drawKerb(kerb: Kerb): void {
    const sign = kerb.raisedSide === 'left' ? 1 : -1;
    const context = this.context;
    for (let i = 1; i < kerb.polyline.length; i++) {
      const a = kerb.polyline[i - 1] as Vec2;
      const b = kerb.polyline[i] as Vec2;
      const yaw = Math.atan2(b.y - a.y, b.x - a.x);
      const nx = -Math.sin(yaw) * sign * kerb.pavementWidth;
      const ny = Math.cos(yaw) * sign * kerb.pavementWidth;
      const quad = [a, b, { x: b.x + nx, y: b.y + ny }, { x: a.x + nx, y: a.y + ny }];
      this.path(quad, true);
      context.fillStyle = '#2c2e33';
      context.fill();
      // The kerb line itself: the surface a rim strikes.
      context.strokeStyle = '#8b8f98';
      context.lineWidth = 2;
      this.path([a, b], false);
      context.stroke();
    }
  }

  private drawBay(bay: Bay): void {
    const context = this.context;
    this.path(bay.polygon, true);
    context.strokeStyle = '#edd95c';
    context.lineWidth = 2;
    context.setLineDash([8, 6]);
    context.stroke();
    context.setLineDash([]);
    // The bay's waist: where the middle of the car belongs.
    const half = bay.width / 2 - 0.1;
    const cos = Math.cos(bay.axisYaw);
    const sin = Math.sin(bay.axisYaw);
    this.path(
      [
        { x: bay.centre.x + half * sin, y: bay.centre.y - half * cos },
        { x: bay.centre.x - half * sin, y: bay.centre.y + half * cos },
      ],
      false,
    );
    context.strokeStyle = 'rgba(237,217,92,0.55)';
    context.stroke();
  }

  private drawObstacle(obstacle: Obstacle): void {
    const context = this.context;
    this.path(obstaclePolygon(obstacle), true);
    context.fillStyle = obstacle.kind === 'parked-car' ? '#3b4757' : '#4a4a50';
    context.fill();
    context.strokeStyle = 'rgba(255,255,255,0.28)';
    context.lineWidth = 1;
    context.stroke();
  }

  /**
   * The clean path, dashed so it reads as a reference rather than as something
   * that happened. It comes from the pure core (`referenceLine`), so it is the
   * same shape whatever draws it.
   */
  private drawReference(): void {
    if (this.reference.length < 2) return;
    const context = this.context;
    context.setLineDash([10, 8]);
    this.drawTrace(this.reference, REFERENCE_COLOUR, 2.5);
    context.setLineDash([]);
  }

  private drawTrace(points: readonly Vec2[], colour: string, width: number): void {
    if (points.length < 2) return;
    const context = this.context;
    this.path(points, false);
    context.strokeStyle = colour;
    context.lineWidth = width;
    context.stroke();
  }

  /**
   * Chevrons along the body trace pointing the way the car was actually going —
   * from the recorded signed speed, so a reversing stretch points backwards.
   */
  private drawDirectionArrows(recording: Recording, upTo: number): void {
    const context = this.context;
    context.strokeStyle = 'rgba(255,255,255,0.75)';
    context.lineWidth = 1.5;
    for (let i = ARROW_EVERY; i < upTo; i += ARROW_EVERY) {
      const frame = recording.frames[i] as Frame;
      if (Math.abs(frame.speed) < 0.05) continue;
      const heading = frame.pose.yaw + (frame.speed < 0 ? Math.PI : 0);
      const tip = this.toScreen(frame.centre);
      const size = Math.max(5, this.transform.scale * 0.22);
      for (const spread of [2.5, -2.5]) {
        const angle = heading + spread;
        context.beginPath();
        context.moveTo(tip.x, tip.y);
        context.lineTo(tip.x + Math.cos(angle) * size, tip.y - Math.sin(angle) * size);
        context.stroke();
      }
    }
  }

  /** A gear change: a hollow square, shape-distinct from every contact glyph. */
  private drawGearMarker(marker: GearChangeMarker): void {
    const context = this.context;
    const p = this.toScreen(marker.position);
    const r = Math.max(4, this.transform.scale * 0.12);
    context.strokeStyle = '#9be36f';
    context.lineWidth = 2;
    context.strokeRect(p.x - r, p.y - r, r * 2, r * 2);
  }

  /**
   * A contact, at the exact world position it was recorded at. Severity is a
   * SHAPE — triangle, diamond, cross — as well as a colour.
   */
  private drawContactMarker(marker: ContactMarker): void {
    const context = this.context;
    const p = this.toScreen(marker.position);
    const r = Math.max(5, this.transform.scale * 0.16);
    context.strokeStyle = SEVERITY_COLOUR[marker.severity];
    context.fillStyle = SEVERITY_COLOUR[marker.severity];
    context.lineWidth = 2;
    context.beginPath();
    if (marker.severity === 'graze') {
      context.moveTo(p.x, p.y - r);
      context.lineTo(p.x + r, p.y + r);
      context.lineTo(p.x - r, p.y + r);
      context.closePath();
      context.stroke();
    } else if (marker.severity === 'knock') {
      context.moveTo(p.x, p.y - r);
      context.lineTo(p.x + r, p.y);
      context.lineTo(p.x, p.y + r);
      context.lineTo(p.x - r, p.y);
      context.closePath();
      context.fill();
    } else {
      context.moveTo(p.x - r, p.y - r);
      context.lineTo(p.x + r, p.y + r);
      context.moveTo(p.x + r, p.y - r);
      context.lineTo(p.x - r, p.y + r);
      context.stroke();
      context.beginPath();
      context.arc(p.x, p.y, r, 0, Math.PI * 2);
      context.stroke();
    }
  }

  /** The car at the scrubbed frame: bodywork outline plus the four road wheels. */
  private drawCar(frame: Frame): void {
    const context = this.context;
    this.path(bodyPolygon(frame.pose, VEHICLE), true);
    context.fillStyle = 'rgba(199,61,55,0.55)';
    context.fill();
    context.strokeStyle = '#ff8a80';
    context.lineWidth = 2;
    context.stroke();

    for (const id of WHEEL_IDS) {
      const local = wheelPosition(id, VEHICLE);
      const angle = frame.pose.yaw + frame.wheels[id].steerAngle;
      const centre = frame.wheels[id].contactPatch;
      const half = { x: VEHICLE.wheelRadius, y: VEHICLE.wheelWidth / 2 };
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const corners = [
        { x: half.x, y: half.y },
        { x: -half.x, y: half.y },
        { x: -half.x, y: -half.y },
        { x: half.x, y: -half.y },
      ].map((p) => ({ x: centre.x + p.x * cos - p.y * sin, y: centre.y + p.x * sin + p.y * cos }));
      this.path(corners, true);
      context.fillStyle = local.x > 0 ? '#e9e9ec' : '#b9bcc4';
      context.fill();
    }

    // A nose pip, so heading is unambiguous when the car is nearly square.
    const nose = {
      x: frame.pose.x + Math.cos(frame.pose.yaw) * (VEHICLE.wheelbase / 2 + VEHICLE.frontOverhang),
      y: frame.pose.y + Math.sin(frame.pose.yaw) * (VEHICLE.wheelbase / 2 + VEHICLE.frontOverhang),
    };
    const p = this.toScreen(nose);
    context.fillStyle = '#f4e58a';
    context.beginPath();
    context.arc(p.x, p.y, Math.max(3, this.transform.scale * 0.09), 0, Math.PI * 2);
    context.fill();
  }

  private path(points: readonly Vec2[], close: boolean): void {
    const context = this.context;
    context.beginPath();
    points.forEach((point, i) => {
      const p = this.toScreen(point);
      if (i === 0) context.moveTo(p.x, p.y);
      else context.lineTo(p.x, p.y);
    });
    if (close) context.closePath();
  }

  /** What the player came for: their input at the moment they are looking at. */
  private updateReadout(frame: Frame): void {
    const recording = this.recording;
    if (recording === null) return;
    const last = recording.frames.length - 1;
    const lock =
      Math.abs(frame.rack) < 0.005
        ? 'centred'
        : `${Math.round(Math.abs(frame.rack) * 100)}% ${frame.rack > 0 ? 'left' : 'right'}`;
    const direction = frame.speed > 0.05 ? 'forward' : frame.speed < -0.05 ? 'reversing' : 'stopped';
    this.readout.textContent =
      `REPLAY (${this.viewMode === 'top-down' ? 'top-down' : "driver's seat"})  ` +
      `frame ${Math.round(this.index)} / ${last}   t ${frame.time.toFixed(2)} s   ${this.rate}x\n` +
      `gear ${frame.gear}   rack ${frame.rack.toFixed(2)} (${lock})\n` +
      `speed ${Math.abs(frame.speed * 3.6).toFixed(1)} km/h ${direction}`;
  }
}

function severityGlyph(severity: ContactMarker['severity']): string {
  return severity === 'graze' ? '/\\' : severity === 'knock' ? '<>' : 'XX';
}

function requireElement<T extends Element>(
  root: HTMLElement,
  selector: string,
  type: { new (): T } | Function,
): T {
  const found = root.querySelector(selector);
  if (!(found instanceof (type as Function))) {
    throw new Error(`Replay screen is missing ${selector}.`);
  }
  return found as T;
}
