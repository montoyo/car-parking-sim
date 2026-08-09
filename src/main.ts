/**
 * Entry point: the fixed-timestep accumulator loop.
 *
 * The core is stepped at exactly `FIXED_DT` however fast the display runs; the
 * renderer draws an interpolation between the two most recent states. This is
 * what makes the physics frame-rate independent and the picture smooth.
 */

import type { SimEvent, WorldState } from './core/index';
import { FIXED_DT, Recorder, createWorld, resetWorld, scoreAttempt, step } from './core/index';
import { KeyboardAdapter } from './input/keyboard';
import { LookController } from './input/look';
import { MirrorAimController } from './input/mirror-aim';
import { Renderer } from './render/renderer';
import { interpolateVehicle } from './render/interpolate';
import { BestScores } from './ui/bests';
import { ContactCue } from './ui/contact-cue';
import { Hud } from './ui/hud';
import { ReplayScreen } from './ui/replay';
import type { ScenarioChoice } from './ui/scenario-select';
import { ScenarioSelect } from './ui/scenario-select';
import { ScorecardScreen } from './ui/scorecard';

const MAX_CATCHUP_SECONDS = 0.25;
/**
 * Frame rate below which the renderer is told it is over budget and starts
 * updating the less important mirrors at a reduced rate.
 */
const FRAME_BUDGET_FPS = 50;

function main(): void {
  const canvas = document.getElementById('viewport');
  const hudRoot = document.getElementById('hud');
  const cueRoot = document.getElementById('cue');
  const cardRoot = document.getElementById('scorecard');
  const replayRoot = document.getElementById('replay');
  const selectRoot = document.getElementById('select');
  if (
    !(canvas instanceof HTMLCanvasElement) ||
    !hudRoot ||
    !cueRoot ||
    !cardRoot ||
    !replayRoot ||
    !selectRoot
  ) {
    throw new Error(
      'Expected #viewport, #hud, #cue, #scorecard, #replay and #select elements in the document.',
    );
  }

  const renderer = new Renderer(canvas);
  const hud = new Hud(hudRoot);
  // The contact cue reads the same event stream scoring and replay will: hitting
  // something is announced in the moment, not just tallied afterwards.
  const cue = new ContactCue(cueRoot);
  // The breakdown screen and the persisted bests: both fed by the pure scoring
  // function over the world the attempt ended in and the log it produced.
  const scorecard = new ScorecardScreen(cardRoot);
  const bests = new BestScores();
  // The replay reads the recording the loop below appends to every tick — playback
  // of what happened, never a re-simulation of it. Retry comes straight off the
  // replay screen so the loop from mistake to next attempt is one click.
  const replay = new ReplayScreen(replayRoot, () => restart());
  replay.attach(window);
  // The menu the player picks a manoeuvre from: difficulty and pass criteria shown
  // before the attempt starts, tunable parameters on sliders, and the best score for
  // the exact parameter set currently dialled in.
  const select = new ScenarioSelect(selectRoot, bests, (choice) => begin(choice));
  select.attach(window);
  const keyboard = new KeyboardAdapter();
  keyboard.attach(window);
  // The head is a device adapter like any other: mouse look plus one-button
  // shoulder checks in, two angles out.
  const look = new LookController();
  look.attach(canvas, window);
  // Mirror aim is a device adapter too: pick a mirror with M, trim it with IJKL.
  const mirrors = new MirrorAimController();
  mirrors.attach(window);

  // V swaps between the driver's seat and the top-down debug camera.
  window.addEventListener('keydown', (e) => {
    // V is the live debug camera; while the replay owns the viewport its own T
    // toggle is the one that matters.
    if (select.visible) return;
    if (e.code === 'KeyV' && !(replay.visible && replay.view === 'first-person')) {
      renderer.setViewMode(renderer.mode === 'first-person' ? 'top-down' : 'first-person');
    }
    // Instant restart: back to the scenario's approach pose, same layout, same
    // tuning, so a botched approach costs nothing but the attempt.
    // Not KeyR — that is gear-reverse in the keyboard adapter's bindings.
    if (e.code === 'Backspace' && !e.repeat) restart();
  });

  let previous: WorldState = createWorld(select.choice().id, {
    parameters: select.choice().parameters,
  });
  let current: WorldState = previous;
  /** The whole attempt's event log — what scoring and the replay markers consume. */
  let log: SimEvent[] = [];
  /** One frame per fixed tick: the recording the replay plays back. */
  let recorder = new Recorder(current);
  let accumulator = 0;
  let lastFrameMs: number | null = null;
  let paused = false;
  const fps = new FrameRateMeter();

  // The tab losing focus must not let time (or physics) run away.
  window.addEventListener('blur', () => {
    paused = true;
  });
  window.addEventListener('focus', () => {
    paused = false;
    lastFrameMs = null;
  });
  document.addEventListener('visibilitychange', () => {
    paused = document.hidden;
    lastFrameMs = null;
  });

  const restart = (): void => {
    current = resetWorld(current);
    previous = current;
    accumulator = 0;
    log = [];
    recorder = new Recorder(current);
    scorecard.hide();
    replay.hide();
  };

  /**
   * Start a fresh attempt at a chosen scenario and tuning. Everything a restart
   * clears is cleared here too — including the replay, which would otherwise keep
   * the viewport it takes over in first-person.
   */
  const begin = (choice: ScenarioChoice): void => {
    current = createWorld(choice.id, { parameters: choice.parameters });
    previous = current;
    accumulator = 0;
    log = [];
    recorder = new Recorder(current);
    scorecard.hide();
    replay.hide();
  };

  /**
   * The attempt is over: score it, remember it if it is a best, and show the
   * breakdown. The core has already latched `completion`, so the loop below simply
   * stops stepping.
   */
  const finish = (): void => {
    const card = scoreAttempt(current, log);
    scorecard.show(card, bests.submit(card));
    // And straight into the top-down replay of the attempt just driven.
    replay.show(recorder.snapshot());
  };

  const frame = (nowMs: number): void => {
    requestAnimationFrame(frame);

    const elapsed = lastFrameMs === null ? 0 : (nowMs - lastFrameMs) / 1000;
    lastFrameMs = nowMs;

    // The menu is a pause: the player is reading pass criteria, not driving.
    if (!paused && !select.visible) {
      accumulator = Math.min(accumulator + elapsed, MAX_CATCHUP_SECONDS);
      // A finished attempt is frozen: the player is reading their score, not
      // driving. Backspace restarts.
      while (accumulator >= FIXED_DT && current.completion.status === 'driving') {
        const input = keyboard.sample(FIXED_DT);
        const result = step(current, input, FIXED_DT);
        previous = current;
        current = result.world;
        accumulator -= FIXED_DT;
        log.push(...result.events);
        // A frame per fixed tick, with this tick's events: the recording IS the
        // replay, so it is appended here and nowhere else.
        recorder.record(current, result.events);
        report(result.events);
        cue.report(result.events);
        if (current.completion.status !== 'driving') finish();
      }
    }

    const t = accumulator / FIXED_DT;
    // The head advances on the display clock, not the fixed timestep: it is a
    // camera, not simulation state, so it must never feed back into the core.
    const gaze = look.sample(paused ? 0 : elapsed);
    const mirrorAim = mirrors.sample(paused ? 0 : elapsed);
    const smoothedFps = fps.sample(elapsed);
    // The banner fades on the display clock — it is a cue, not simulation state.
    cue.update(paused ? 0 : elapsed);
    // Replay playback also runs on the display clock: its frame index advances at
    // the chosen rate against the recording's fixed timestep.
    replay.update(paused ? 0 : elapsed);
    // Three extra passes have to be affordable on a laptop: if the display clock
    // says they are not, the mirror schedule thins them out rather than the
    // whole frame stuttering.
    const overBudget = smoothedFps > 0 && smoothedFps < FRAME_BUDGET_FPS;
    // While the replay is being watched from the driver's seat, the WebGL pass
    // draws the RECORDED frame the player has scrubbed to instead of the live
    // world — same camera, same mirrors, playback rather than re-simulation. The
    // replay screen keeps its scrub position across the toggle, so the two views
    // are two windows on one moment.
    const replayed = replay.visible && replay.view === 'first-person' ? replay.vehicleAtScrub() : null;
    if (replayed) {
      renderer.setViewMode('first-person');
      renderer.render(replayed, gaze, {
        scenario: replay.scenario ?? current.scenario,
        mirrorAim,
        overBudget,
        reversingCamera: (replay.scenario ?? current.scenario).reversingCamera,
      });
    } else {
      renderer.render(interpolateVehicle(previous.vehicle, current.vehicle, t), gaze, {
        scenario: current.scenario,
        mirrorAim,
        overBudget,
        // Data, not a code path: the scenario says whether the car has a camera.
        reversingCamera: current.scenario.reversingCamera,
      });
    }
    hud.update(current, {
      fps: smoothedFps,
      pointerLocked: look.locked,
      adjustingMirror: mirrors.selected,
      mirrorAim,
    });
  };

  requestAnimationFrame(frame);
}

/**
 * Smoothed frames per second, shown in the HUD. The first-person pass has to
 * hold the refresh rate on a laptop, and a number on screen is how that gets
 * checked by eye.
 */
class FrameRateMeter {
  private smoothed = 0;

  sample(elapsedSeconds: number): number {
    if (elapsedSeconds <= 0) return this.smoothed;
    const instant = 1 / elapsedSeconds;
    this.smoothed = this.smoothed === 0 ? instant : this.smoothed + (instant - this.smoothed) * 0.1;
    return this.smoothed;
  }
}

function report(events: readonly SimEvent[]): void {
  for (const event of events) {
    if (event.kind === 'gearChange') {
      console.info(`[sim] gear ${event.from} -> ${event.to} at tick ${event.tick}`);
    }
    if (event.kind === 'contact') {
      console.info(
        `[sim] ${event.severity} ${event.part} contact with ${event.surface} at ` +
          `${event.closingSpeed.toFixed(2)} m/s (tick ${event.tick})`,
      );
    }
  }
}

main();
