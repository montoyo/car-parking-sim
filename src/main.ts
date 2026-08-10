/**
 * Entry point: the fixed-timestep accumulator loop.
 *
 * The core is stepped at exactly `FIXED_DT` however fast the display runs; the
 * renderer draws an interpolation between the two most recent states. This is
 * what makes the physics frame-rate independent and the picture smooth.
 */

import type { SimEvent, WorldState } from './core/index';
import { FIXED_DT, Recorder, canFinish, createWorld, resetWorld, scoreAttempt, step } from './core/index';
import { Bindings, assertNoDuplicateBindings, keyLabel } from './input/bindings';
import { combineInputs } from './input/combine';
import { GamepadAdapter } from './input/gamepad';
import { KeyboardAdapter } from './input/keyboard';
import { LookController } from './input/look';
import { MirrorAimController } from './input/mirror-aim';
import { Renderer } from './render/renderer';
import { interpolateVehicle } from './render/interpolate';
import { AudioSettings } from './ui/audio';
import { BestScores } from './ui/bests';
import { ContactCue } from './ui/contact-cue';
import { ControlsPanel } from './ui/controls-panel';
import { DriveModeSetting } from './ui/drive-mode';
import { FinishButton } from './ui/finish-button';
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
  const controlsRoot = document.getElementById('controls');
  const finishRoot = document.getElementById('finish');
  if (
    !(canvas instanceof HTMLCanvasElement) ||
    !hudRoot ||
    !cueRoot ||
    !cardRoot ||
    !replayRoot ||
    !selectRoot ||
    !controlsRoot ||
    !finishRoot
  ) {
    throw new Error(
      'Expected #viewport, #hud, #cue, #scorecard, #replay, #select, #controls and ' +
        '#finish elements in the document.',
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
  // One registry owns EVERY key — driving, head, mirrors and session alike — so no
  // two actions can claim the same code. That is checked here at startup as well as
  // in the test suite, because a double-booked key (KeyR was once both gear-reverse
  // and restart) is invisible until a player hits it.
  const bindings = new Bindings();
  assertNoDuplicateBindings(bindings.snapshot());

  // Audio preferences, remembered between sessions and pushed into the cue below.
  const audio = new AudioSettings();
  audio.onChange((state) => {
    cue.setMuted(state.muted);
    cue.setVolume(state.volume);
  });

  // EV or gearbox, remembered between sessions. The adapters are handed a getter,
  // so switching it takes effect on the next key press.
  const driveMode = new DriveModeSetting();

  // The control reference IS the remapping screen: one list, generated from the
  // registry, so what it shows is what the adapters listen for.
  const controls = new ControlsPanel(controlsRoot, bindings, audio, driveMode);
  controls.attach(window);

  // Both adapters are handed a getter, not a snapshot, so a rebind takes effect on
  // the next key press rather than on the next reload.
  const keyboard = new KeyboardAdapter(() => bindings.keyBindings(), () => driveMode.mode);
  keyboard.attach(window);
  // The analogue device: stick straight to rack target, triggers to pedals. It
  // produces the same normalised `ControlInput` the keyboard does.
  const gamepad = new GamepadAdapter();
  // The head is a device adapter like any other: mouse look plus one-button
  // shoulder checks in, two angles out.
  const look = new LookController(() => bindings.lookBindings());
  look.attach(canvas, window);
  // Mirror aim is a device adapter too: pick a mirror with M, trim it with IJKL.
  const mirrors = new MirrorAimController(() => bindings.mirrorAimBindings());
  mirrors.attach(window);

  /**
   * The player's declaration that the attempt is over. Latched here rather than
   * read straight off a key or a click, because the request has to survive until
   * the next FIXED tick consumes it — a click between two ticks must not be lost,
   * and it must not be applied twice.
   */
  let finishRequested = false;
  const requestFinish = (): void => {
    if (current.completion.status === 'driving') finishRequested = true;
  };
  const finishButton = new FinishButton(finishRoot, requestFinish);

  window.addEventListener('keydown', (e) => {
    // The panels are modal: while one is up its own keys are the ones that matter.
    if (bindings.matches('controlsToggle', e.code) && !e.repeat) {
      e.preventDefault();
      controls.toggle();
      return;
    }
    if (bindings.matches('audioMute', e.code) && !e.repeat) audio.toggleMuted();
    if (bindings.matches('volumeDown', e.code)) audio.nudgeVolume(-1);
    if (bindings.matches('volumeUp', e.code)) audio.nudgeVolume(1);
    if (select.visible || controls.visible) return;
    // The live debug camera; while the replay owns the viewport its own view
    // toggle is the one that matters.
    if (
      bindings.matches('viewToggle', e.code) &&
      !(replay.visible && replay.view === 'first-person')
    ) {
      renderer.setViewMode(renderer.mode === 'first-person' ? 'top-down' : 'first-person');
    }
    // The other half of the finish button: same action, same latch.
    if (bindings.matches('finishAttempt', e.code) && !e.repeat && !replay.visible) {
      e.preventDefault();
      requestFinish();
    }
    // Instant restart: back to the scenario's approach pose, same layout, same
    // tuning, so a botched approach costs nothing but the attempt.
    if (bindings.matches('restart', e.code) && !e.repeat) restart();
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
  /** The steering target the last tick was given, for the HUD's keycaps. */
  let steerTarget = 0;
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
    finishRequested = false;
    // The world resets into neutral, so the ADAPTERS have to as well: a keyboard
    // still holding "reverse" from the last attempt would drive the car straight
    // back out of the reset pose without the player touching anything.
    keyboard.reset();
    gamepad.reset();
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
    finishRequested = false;
    keyboard.reset();
    gamepad.reset();
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

    // A pad's state is polled, not evented, so it is read once per displayed frame
    // and held across the fixed ticks that frame drives.
    const padInput = gamepad.sample();
    controls.setPadStatus(gamepad.connected, gamepad.inUse);

    // The menu and the control panel are pauses: the player is reading pass criteria
    // or rebinding keys, not driving.
    if (!paused && !select.visible && !controls.visible) {
      accumulator = Math.min(accumulator + elapsed, MAX_CATCHUP_SECONDS);
      // A finished attempt is frozen: the player is reading their score, not
      // driving. Backspace restarts.
      while (accumulator >= FIXED_DT && current.completion.status === 'driving') {
        // Two devices, one normalised input: the core never learns which was used.
        // EV mode needs the road speed to tell "go the other way" from "stop
        // first", so the adapter is handed the state the core just produced.
        const merged = combineInputs(
          {
            input: keyboard.sample(
              FIXED_DT,
              current.vehicle.longitudinalVelocity,
              current.vehicle.rack,
            ),
            gearRequest: keyboard.gearRequest,
          },
          padInput === null ? null : { input: padInput, gearRequest: gamepad.gearRequest },
        );
        // The latch is consumed by exactly one tick, whether or not the core
        // accepts it — a request the car was still rolling for is a no, not a
        // standing order that fires the moment it stops.
        const input = finishRequested ? { ...merged, finishRequested: true } : merged;
        finishRequested = false;
        steerTarget = input.steer;
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
    finishButton.update({
      driving: current.completion.status === 'driving' && !select.visible && !controls.visible,
      ready: canFinish(current.vehicle, current.scenario),
      key: keyLabel(bindings.codes('finishAttempt')[0] ?? 'Enter'),
    });
    hud.update(current, {
      fps: smoothedFps,
      pointerLocked: look.locked,
      adjustingMirror: mirrors.selected,
      mirrorAim,
      audio: audio.describe(),
      controlsKey: keyLabel(bindings.codes('controlsToggle')[0] ?? 'KeyH'),
      gamepad: gamepad.connected,
      evMode: driveMode.mode === 'ev',
      steerInput: steerTarget,
      steerKeys: {
        left: keyLabel(bindings.codes('steerLeft')[0] ?? 'ArrowLeft'),
        right: keyLabel(bindings.codes('steerRight')[0] ?? 'ArrowRight'),
      },
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
