import {
  type Character,
  type Line,
  type SceneWithLines,
  type SupportedLanguage,
} from '@osvald/shared';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import { buildCue } from '@/lib/cue';
import { buildCharacterNames, countLinesByCharacter } from '@/lib/script';
import { toErrorMessage } from '@/services/api';
import { getSpeechService, voicesForLanguage, type SpeechVoice } from '@/services/speech';
import {
  assignVoicesForNewCharacters,
  detectScriptLanguage,
  voiceForLine,
} from '@/services/voice-casting';
import { useScriptStore } from '@/stores/scriptStore';

/**
 * The rehearsal engine.
 *
 * What it models: an actor runs a scene with the app playing everyone else.
 * The engine walks the scene's lines in order, speaks the ones belonging to
 * other characters, and stops dead on the actor's own lines — that pause is the
 * whole point, because it is where the actor practises. The line stays hidden
 * (only a short cue is shown) until they ask for it, then they tap to continue.
 *
 * A rehearsal covers either the whole script or a single scene (`setScope`).
 * Both are real working modes: an actor drills tomorrow's scene over and over,
 * then runs the full script to find out whether it holds together.
 *
 * All speech goes through the `SpeechService` interface, so the native build can
 * swap the engine without touching this file.
 */

export const useRehearsalStore = defineStore('rehearsal', () => {
  const scriptStore = useScriptStore();
  const speech = getSpeechService();

  const myCharacterId = ref<string | null>(null);
  /** Scene the rehearsal is confined to; `null` runs the whole script. */
  const scopeSceneId = ref<string | null>(null);
  const sceneIndex = ref(0);
  const lineIndex = ref(0);

  /**
   * Ends (inclusive line indices in the current scene) of the A/B loop, used to
   * drill a difficult passage. Both must be set for the loop to take effect.
   * Tied to one scene, so every scene change clears them.
   */
  const loopStart = ref<number | null>(null);
  const loopEnd = ref<number | null>(null);

  const isRunning = ref(false);
  /** Stopped on one of the actor's lines, waiting for them to deliver it. */
  const isWaitingForMe = ref(false);
  /** The actor asked to see their hidden line. Reset on every new line. */
  const isRevealed = ref(false);

  const rate = ref(1);
  const voices = ref<SpeechVoice[]>([]);
  const voiceByCharacterId = ref<Record<string, string>>({});

  /** Set only when the actor overrides the detected language by hand. */
  const languageOverride = ref<SupportedLanguage | null>(null);

  /**
   * True when the server voices are unreachable and the device's own engine is
   * being used instead.
   *
   * Mirrored into a ref because the engine reports it as a plain property: the
   * UI has to re-render when it flips, and that only happens at the few points
   * below where speech is actually attempted.
   */
  const isSpeechDegraded = ref(false);

  /** Show only a cue for the actor's own lines, instead of the full text. */
  const hideMyLines = ref(true);
  /** Read stage directions aloud as well as dialogue. */
  const speakDirections = ref(false);
  /** Roll straight into the next scene when one ends. */
  const autoAdvanceScene = ref(false);

  const error = ref<string | null>(null);

  /**
   * Invalidates in-flight speech loops.
   *
   * `speak()` is awaited, so a loop can resume after the user has already
   * paused or jumped elsewhere. Every loop captures the token it started with
   * and exits as soon as it no longer matches.
   */
  let runToken = 0;

  /* ---------------------------------------------------------------------- */
  /* Derived view of the script                                             */
  /* ---------------------------------------------------------------------- */

  /** Every scene in the open script, regardless of what is being rehearsed. */
  const allScenes = computed<SceneWithLines[]>(() => scriptStore.currentScript?.scenes ?? []);

  /**
   * The scene the rehearsal is pinned to, or `null` for the whole script.
   *
   * An id that no longer resolves — a stale link, or a script reparsed into
   * different scenes — falls back to the whole script rather than leaving the
   * actor on an empty page.
   */
  const scopedScene = computed<SceneWithLines | null>(() =>
    scopeSceneId.value === null
      ? null
      : (allScenes.value.find((scene) => scene.id === scopeSceneId.value) ?? null),
  );

  const isSceneScoped = computed(() => scopedScene.value !== null);

  /**
   * The scenes this rehearsal runs over.
   *
   * Scoping narrows this list instead of being checked at every use site, so
   * the transport, the progress bar and `hasNextScene` confine themselves to
   * the chosen scene without knowing that scoping exists.
   */
  const scenes = computed<SceneWithLines[]>(() =>
    scopedScene.value === null ? allScenes.value : [scopedScene.value],
  );

  const characters = computed<Character[]>(() => scriptStore.currentScript?.characters ?? []);

  const currentScene = computed<SceneWithLines | null>(
    () => scenes.value[sceneIndex.value] ?? null,
  );
  const lines = computed<Line[]>(() => currentScene.value?.lines ?? []);
  const currentLine = computed<Line | null>(() => lines.value[lineIndex.value] ?? null);

  const myCharacter = computed<Character | null>(
    () => characters.value.find((character) => character.id === myCharacterId.value) ?? null,
  );

  const characterNamesById = computed(() => buildCharacterNames(characters.value));

  /** Line counts per character, so the cast picker can show role sizes. */
  const lineCountsByCharacterId = computed(() => countLinesByCharacter(scenes.value));

  /**
   * The roles worth offering, counted over what is being rehearsed.
   *
   * One scene rarely uses the whole cast, and a character who says nothing in
   * it is a dead end: picking it leaves the actor with no line to practise. The
   * full cast is kept when the narrowing finds nobody, so a script whose lines
   * carry no character ids still yields a usable picker.
   */
  const cast = computed<Character[]>(() => {
    const counts = lineCountsByCharacterId.value;
    const speaking = characters.value.filter((character) => (counts[character.id] ?? 0) > 0);

    return speaking.length > 0 ? speaking : characters.value;
  });

  function isMine(line: Line | null): boolean {
    return (
      line !== null &&
      line.type === 'dialogue' &&
      myCharacterId.value !== null &&
      line.characterId === myCharacterId.value
    );
  }

  const isMyTurn = computed(() => isMine(currentLine.value));

  /** First few words of the actor's line, shown while the rest is hidden. */
  const cue = computed(() => (currentLine.value === null ? '' : buildCue(currentLine.value.text)));

  const progress = computed(() =>
    lines.value.length > 0 ? Math.min(lineIndex.value / lines.value.length, 1) : 0,
  );

  /**
   * The A/B loop as the engine sees it, or `null` when there is nothing to loop.
   *
   * A range with no line the engine would stop on or speak — only stage
   * directions that are not read aloud — is dropped here rather than looped:
   * `run()` would skip every line without awaiting and spin forever.
   */
  const loopRange = computed<{ start: number; end: number } | null>(() => {
    if (loopStart.value === null || loopEnd.value === null) {
      return null;
    }

    const start = loopStart.value;
    const end = Math.min(loopEnd.value, lines.value.length - 1);
    const hasContent = lines.value
      .slice(start, end + 1)
      .some((line) => isMine(line) || line.type !== 'direction' || speakDirections.value);

    return hasContent ? { start, end } : null;
  });

  const isLooping = computed(() => loopRange.value !== null);

  const hasNextScene = computed(() => sceneIndex.value < scenes.value.length - 1);
  const isSpeechSupported = computed(() => speech.isSupported());

  /* ---------------------------------------------------------------------- */
  /* Language                                                               */
  /* ---------------------------------------------------------------------- */

  const detectedLanguage = computed<SupportedLanguage>(() => detectScriptLanguage(scenes.value));

  /** The language lines are spoken in: the actor's choice, else the detection. */
  const language = computed<SupportedLanguage>(
    () => languageOverride.value ?? detectedLanguage.value,
  );

  /** Voices this platform has for the current language. Often empty for `ro`. */
  const voicesForCurrentLanguage = computed(() => voicesForLanguage(voices.value, language.value));

  /**
   * True when the engine has nothing for the current language.
   *
   * Worth surfacing: the scene still runs, but a Romanian script read by an
   * engine with no Romanian voice installed is what "sounds wrong" in practice,
   * and the fix is outside the app (install a voice / use another browser).
   */
  const isMissingVoiceForLanguage = computed(
    () => voices.value.length > 0 && voicesForCurrentLanguage.value.length === 0,
  );

  /** Records whether the engine is currently falling back to local voices. */
  function syncDegraded(): void {
    isSpeechDegraded.value = speech.isDegraded ?? false;
  }

  /** The voice and tag to speak `line` with. */
  function voicingFor(line: Line): { voiceId: string | null; lang: string } {
    return voiceForLine(line, {
      scriptLanguage: language.value,
      voices: voices.value,
      voiceByCharacterId: voiceByCharacterId.value,
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Setup                                                                  */
  /* ---------------------------------------------------------------------- */

  /**
   * Loads the voice list and gives every character one.
   *
   * Safe to call repeatedly: an existing assignment is kept, so a voice the
   * actor chose by hand is not overwritten when the page is revisited.
   */
  async function loadVoices(): Promise<void> {
    try {
      voices.value = await speech.listVoices();
    } catch (caught) {
      error.value = toErrorMessage(caught);
      return;
    }

    syncDegraded();
    assignMissingVoices();
  }

  /** Gives a voice to every character that has none, in the script's language. */
  function assignMissingVoices(): void {
    const assignments = assignVoicesForNewCharacters(
      characters.value,
      voices.value,
      language.value,
      voiceByCharacterId.value,
    );

    if (Object.keys(assignments).length > 0) {
      voiceByCharacterId.value = { ...voiceByCharacterId.value, ...assignments };
    }
  }

  function setVoiceForCharacter(characterId: string, voiceId: string): void {
    voiceByCharacterId.value = { ...voiceByCharacterId.value, [characterId]: voiceId };
  }

  /**
   * Overrides the detected language, or returns to detection with `null`.
   *
   * Every assignment is dropped, including hand-picked ones: a voice chosen
   * for the old language is the wrong engine for the new one, and keeping it
   * would be the exact problem the override was used to fix.
   */
  function setLanguage(next: SupportedLanguage | null): void {
    if (next === languageOverride.value) {
      return;
    }

    pause();
    languageOverride.value = next;
    voiceByCharacterId.value = {};
    assignMissingVoices();
  }

  /** Picks the actor's role and rewinds, since cues depend on who they play. */
  function chooseCharacter(characterId: string | null): void {
    myCharacterId.value = characterId;
    goToLine(0);
  }

  /** Jumps to the first scene the chosen character actually appears in. */
  function jumpToMyFirstScene(): void {
    if (myCharacterId.value === null) {
      return;
    }

    const index = scenes.value.findIndex((scene) =>
      scene.lines.some((line) => line.characterId === myCharacterId.value),
    );

    if (index >= 0) {
      selectScene(index);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Transport                                                              */
  /* ---------------------------------------------------------------------- */

  /** Stops speech and invalidates any loop that is mid-utterance. */
  function halt(): void {
    runToken += 1;
    speech.cancel();
  }

  function pause(): void {
    isRunning.value = false;
    isWaitingForMe.value = false;
    halt();
  }

  function clearLoop(): void {
    loopStart.value = null;
    loopEnd.value = null;
  }

  /** Clamps a line index into the current scene. */
  function clampLine(index: number): number {
    return Math.min(Math.max(index, 0), Math.max(lines.value.length - 1, 0));
  }

  /** Marks point A. Point B is pushed forward if it would end up before it. */
  function setLoopStart(index: number): void {
    const start = clampLine(index);
    loopStart.value = start;

    if (loopEnd.value !== null && loopEnd.value < start) {
      loopEnd.value = start;
    }
  }

  /** Marks point B. With no point A yet, the loop starts at the same line. */
  function setLoopEnd(index: number): void {
    const end = clampLine(index);
    loopEnd.value = end;

    if (loopStart.value === null || loopStart.value > end) {
      loopStart.value = end;
    }
  }

  function selectScene(index: number): void {
    pause();
    clearLoop();
    sceneIndex.value = Math.min(Math.max(index, 0), Math.max(scenes.value.length - 1, 0));
    lineIndex.value = 0;
    isRevealed.value = false;
  }

  /**
   * Confines the rehearsal to one scene, or opens it up to the whole script.
   *
   * The two modes differ in more than range. Running the whole script has to
   * roll from one scene into the next by itself, or the actor is tapping play
   * every few minutes; a single scene is being drilled, and stopping at its end
   * is what lets them run it again. So the scope sets `autoAdvanceScene` rather
   * than leaving it to be toggled by hand — it can still be overridden after.
   */
  function setScope(sceneId: string | null): void {
    pause();
    clearLoop();
    scopeSceneId.value = sceneId;
    autoAdvanceScene.value = sceneId === null;
    sceneIndex.value = 0;
    lineIndex.value = 0;
    isRevealed.value = false;
  }

  function goToLine(index: number): void {
    const wasRunning = isRunning.value;
    pause();

    lineIndex.value = Math.min(Math.max(index, 0), Math.max(lines.value.length - 1, 0));
    isRevealed.value = false;

    if (wasRunning) {
      void start();
    }
  }

  function nextLine(): void {
    goToLine(lineIndex.value + 1);
  }

  function previousLine(): void {
    goToLine(lineIndex.value - 1);
  }

  function reveal(): void {
    isRevealed.value = true;
  }

  /**
   * The actor has delivered their line; carry on with the scene.
   *
   * Advancing is explicit rather than timed: how long a line takes is the
   * actor's business, and a timer would either rush them or stall the scene.
   */
  function confirmMyLine(): void {
    isWaitingForMe.value = false;
    isRevealed.value = false;
    lineIndex.value += 1;

    if (isRunning.value) {
      void run(++runToken);
      return;
    }

    // Reached from a standing start — the actor opened on one of their own
    // lines and delivered it. "Continue" means continue, and the tap itself is
    // the user gesture browsers require before speech may begin.
    void start();
  }

  /** Reads the actor's own line aloud, for when they want to hear it. */
  async function speakMyLine(): Promise<void> {
    const line = currentLine.value;
    if (line === null) {
      return;
    }

    isRevealed.value = true;

    try {
      await speech.speak({
        text: line.text,
        ...voicingFor(line),
        rate: rate.value,
      });
    } catch (caught) {
      error.value = toErrorMessage(caught);
    } finally {
      syncDegraded();
    }
  }

  /**
   * Renders the next line the engine will be asked for, while this one plays.
   *
   * Server-side synthesis costs between a third of a second and a second and a
   * half per line, which would be a silence before every cue. Only one line is
   * prefetched: the scene stops at the actor's own lines anyway, and queueing
   * further ahead would compete for the same CPU that is rendering the line
   * actually being waited on.
   */
  function prefetchFrom(index: number): void {
    for (let cursor = index; cursor < lines.value.length; cursor += 1) {
      const line = lines.value[cursor];

      if (line === undefined || isMine(line)) {
        return;
      }

      if (line.type === 'direction' && !speakDirections.value) {
        continue;
      }

      speech.prefetch?.({ text: line.text, ...voicingFor(line), rate: rate.value });
      return;
    }
  }

  /**
   * Walks the scene until it needs the actor, the scene ends, or it is stopped.
   *
   * `token` guards against a stale loop resuming: every await is a chance for
   * the user to have paused or jumped since.
   */
  async function run(token: number): Promise<void> {
    while (isRunning.value && token === runToken) {
      // Past point B: back to point A. Checked before the end-of-scene branch so
      // a loop ending on the scene's last line never rolls into the next scene.
      const range = loopRange.value;
      if (range !== null && lineIndex.value > range.end) {
        lineIndex.value = range.start;
        isRevealed.value = false;
      }

      const line = lines.value[lineIndex.value];

      if (line === undefined) {
        // End of the scene.
        if (autoAdvanceScene.value && hasNextScene.value) {
          sceneIndex.value += 1;
          lineIndex.value = 0;
          continue;
        }

        isRunning.value = false;
        return;
      }

      if (isMine(line)) {
        isWaitingForMe.value = true;
        isRevealed.value = !hideMyLines.value;
        return;
      }

      if (line.type === 'direction' && !speakDirections.value) {
        lineIndex.value += 1;
        continue;
      }

      let outcome: 'completed' | 'interrupted';

      // Start rendering the next line before waiting on this one, so the two
      // overlap instead of queueing.
      prefetchFrom(lineIndex.value + 1);

      try {
        outcome = await speech.speak({
          text: line.text,
          ...voicingFor(line),
          rate: rate.value,
        });
      } catch (caught) {
        error.value = toErrorMessage(caught);
        isRunning.value = false;
        return;
      } finally {
        syncDegraded();
      }

      // Something else already decided what happens next.
      if (token !== runToken || !isRunning.value || outcome === 'interrupted') {
        return;
      }

      lineIndex.value += 1;
    }
  }

  /**
   * Starts (or resumes) the scene.
   *
   * Must be called from a user gesture the first time: browsers reject speech
   * that was not initiated by one.
   */
  async function start(): Promise<void> {
    if (!speech.isSupported()) {
      error.value =
        'This platform cannot read lines aloud yet. You can still step through the scene manually.';
      return;
    }

    error.value = null;
    halt();
    isRunning.value = true;
    isWaitingForMe.value = false;

    await run(runToken);
  }

  async function toggle(): Promise<void> {
    if (isRunning.value) {
      pause();
      return;
    }

    await start();
  }

  function setRate(next: number): void {
    rate.value = next;

    // The in-flight utterance keeps its old rate, so restart the line to make
    // the change audible immediately.
    if (isRunning.value && !isWaitingForMe.value) {
      goToLine(lineIndex.value);
    }
  }

  /** Clears everything tied to the open script. Called when leaving the page. */
  function reset(): void {
    pause();
    myCharacterId.value = null;
    scopeSceneId.value = null;
    clearLoop();
    sceneIndex.value = 0;
    lineIndex.value = 0;
    isRevealed.value = false;
    error.value = null;
    // Both are per-script: the cast is gone, and so is the language it was in.
    languageOverride.value = null;
    voiceByCharacterId.value = {};
  }

  /*
   * TODO(rehearsal):
   *   - remember the role, scene and rate per script (Capacitor Preferences) so
   *     a rehearsal resumes where it stopped
   *   - keep the screen awake while a scene is running (needs a Capacitor
   *     keep-awake plugin — dependency decision pending)
   *   - speech recognition to detect that the actor finished their line, so the
   *     scene advances without a tap
   */

  return {
    // state
    myCharacterId,
    scopeSceneId,
    sceneIndex,
    lineIndex,
    loopStart,
    loopEnd,
    isRunning,
    isWaitingForMe,
    isRevealed,
    rate,
    voices,
    voiceByCharacterId,
    languageOverride,
    isSpeechDegraded,
    hideMyLines,
    speakDirections,
    autoAdvanceScene,
    error,
    // derived
    allScenes,
    scenes,
    scopedScene,
    isSceneScoped,
    characters,
    cast,
    currentScene,
    lines,
    currentLine,
    myCharacter,
    characterNamesById,
    lineCountsByCharacterId,
    isMyTurn,
    cue,
    progress,
    loopRange,
    isLooping,
    hasNextScene,
    isSpeechSupported,
    detectedLanguage,
    language,
    voicesForCurrentLanguage,
    isMissingVoiceForLanguage,
    // actions
    loadVoices,
    setLanguage,
    setVoiceForCharacter,
    chooseCharacter,
    jumpToMyFirstScene,
    setScope,
    selectScene,
    setLoopStart,
    setLoopEnd,
    clearLoop,
    goToLine,
    nextLine,
    previousLine,
    reveal,
    confirmMyLine,
    speakMyLine,
    start,
    pause,
    toggle,
    setRate,
    reset,
  };
});
