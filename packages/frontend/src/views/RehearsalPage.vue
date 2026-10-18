<script setup lang="ts">
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonFooter,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonModal,
  IonNote,
  IonPage,
  IonProgressBar,
  IonRange,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonText,
  IonTitle,
  IonToggle,
  IonToolbar,
} from '@ionic/vue';
import {
  chevronBackOutline,
  chevronForwardOutline,
  eyeOutline,
  pauseOutline,
  playOutline,
  settingsOutline,
  volumeHighOutline,
} from 'ionicons/icons';
import { LANGUAGE_LABELS, supportedLanguageSchema, type SupportedLanguage } from '@osvald/shared';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import LineRow from '@/components/LineRow.vue';
import { buildCue, useRehearsalStore } from '@/stores/rehearsalStore';
import { useScriptStore } from '@/stores/scriptStore';

/**
 * The rehearsal view.
 *
 * Two phases. First the actor casts themselves — picking a role is what makes
 * the rest meaningful. Then the scene runs: other characters are read aloud,
 * and on the actor's own lines everything stops, the text stays hidden behind a
 * short cue, and they tap when they have delivered it.
 */
const props = defineProps<{ id: string }>();

const scriptStore = useScriptStore();
const rehearsal = useRehearsalStore();

const isSettingsOpen = ref(false);
const transcript = ref<HTMLElement | null>(null);

const script = computed(() => scriptStore.currentScript);
const hasChosenRole = computed(() => rehearsal.myCharacterId !== null);

onMounted(async () => {
  rehearsal.reset();
  await scriptStore.fetchScriptDetail(props.id);
  await rehearsal.loadVoices();
});

// Leaving the page must silence the engine; speech otherwise keeps going.
onBeforeUnmount(() => {
  rehearsal.reset();
});

/** Keeps the current line in view as the scene advances. */
watch(
  () => [rehearsal.sceneIndex, rehearsal.lineIndex],
  () => {
    requestAnimationFrame(() => {
      const current = transcript.value?.querySelector('[data-current="true"]');
      current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  },
);

function chooseRole(characterId: string): void {
  rehearsal.chooseCharacter(characterId);
  rehearsal.jumpToMyFirstScene();
}

function onRateChange(
  event: CustomEvent<{ value: number | { lower: number; upper: number } }>,
): void {
  const value = event.detail.value;
  rehearsal.setRate(typeof value === 'number' ? value : value.lower);
}

const languageOptions = supportedLanguageSchema.options;

/**
 * Voices for the script's language first.
 *
 * The list a browser reports is long and ordered by nothing useful; the handful
 * that can actually read this script belong at the top of the picker.
 */
const pickableVoices = computed(() => {
  const matching = new Set(rehearsal.voicesForCurrentLanguage.map((voice) => voice.id));
  return [
    ...rehearsal.voicesForCurrentLanguage,
    ...rehearsal.voices.filter((voice) => !matching.has(voice.id)),
  ];
});

/** `'auto'` stands for "keep detecting" — the select cannot hold `null`. */
function onLanguageChange(value: SupportedLanguage | 'auto'): void {
  rehearsal.setLanguage(value === 'auto' ? null : value);
}

const sceneLabel = computed(() => {
  const scene = rehearsal.currentScene;
  if (scene === null) {
    return 'No scene';
  }
  return scene.title === scene.number ? scene.number : `${scene.number} — ${scene.title}`;
});
</script>

<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button :default-href="`/scripts/${props.id}`" />
        </ion-buttons>
        <ion-title>{{ script?.title ?? 'Rehearsal' }}</ion-title>
        <ion-buttons v-if="hasChosenRole" slot="end">
          <ion-button fill="clear" size="small" @click="isSettingsOpen = true">
            <ion-icon slot="icon-only" :icon="settingsOutline" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <div v-if="scriptStore.isLoading && script === null" class="centered">
        <ion-spinner name="crescent" />
      </div>

      <!-- Phase 1: cast yourself. -->
      <template v-else-if="!hasChosenRole">
        <div class="intro">
          <h2>Which role are you playing?</h2>
          <p>
            Osvald reads everyone else aloud and stops on your lines, showing only the first few
            words as a cue.
          </p>
        </div>

        <ion-list :inset="true">
          <ion-item
            v-for="character in rehearsal.characters"
            :key="character.id"
            button
            :detail="true"
            @click="chooseRole(character.id)"
          >
            <ion-label>
              <h3>{{ character.name }}</h3>
              <p v-if="character.description !== null">{{ character.description }}</p>
              <ion-note>
                {{ rehearsal.lineCountsByCharacterId[character.id] ?? 0 }} lines
              </ion-note>
            </ion-label>
          </ion-item>
        </ion-list>

        <ion-note v-if="rehearsal.characters.length === 0" class="pad">
          This script has no characters yet — it may still be parsing.
        </ion-note>

        <ion-text v-if="!rehearsal.isSpeechSupported" color="warning">
          <p class="pad">
            This platform cannot read lines aloud, so the scene will run silently. You can still
            step through it line by line.
          </p>
        </ion-text>
      </template>

      <!-- Phase 2: run the scene. -->
      <template v-else>
        <div class="scene-bar">
          <ion-select
            :value="rehearsal.sceneIndex"
            interface="popover"
            label="Scene"
            label-placement="stacked"
            @ion-change="rehearsal.selectScene($event.detail.value)"
          >
            <ion-select-option
              v-for="(scene, index) in rehearsal.scenes"
              :key="scene.id"
              :value="index"
            >
              {{ scene.number }} ({{ scene.lines.length }})
            </ion-select-option>
          </ion-select>

          <div class="scene-bar__role">
            <ion-note>playing</ion-note>
            <strong>{{ rehearsal.myCharacter?.name }}</strong>
            <ion-button fill="clear" size="small" @click="rehearsal.chooseCharacter(null)">
              change
            </ion-button>
          </div>
        </div>

        <ion-progress-bar :value="rehearsal.progress" />

        <!--
          Server speech is what makes the app sound the same everywhere, so
          losing it is not a detail to bury in a settings screen: without this
          banner a stale API URL just sounds like "the voices are wrong".
        -->
        <ion-text v-if="rehearsal.isSpeechDegraded" color="warning">
          <p class="pad">
            Speech server unavailable — using this device's own voices, which may read
            {{ LANGUAGE_LABELS[rehearsal.language] }} with the wrong accent.
          </p>
        </ion-text>

        <ion-text v-if="rehearsal.error !== null" color="danger">
          <p class="pad">{{ rehearsal.error }}</p>
        </ion-text>

        <div ref="transcript" class="transcript">
          <LineRow
            v-for="(line, index) in rehearsal.lines"
            :key="line.id"
            :data-current="index === rehearsal.lineIndex"
            :line="line"
            :speaker-name="
              line.characterId === null
                ? null
                : (rehearsal.characterNamesById[line.characterId] ?? null)
            "
            :is-current="index === rehearsal.lineIndex"
            :is-mine="line.characterId === rehearsal.myCharacterId && line.type === 'dialogue'"
            :is-hidden="
              rehearsal.hideMyLines &&
              line.characterId === rehearsal.myCharacterId &&
              line.type === 'dialogue' &&
              !(index === rehearsal.lineIndex && rehearsal.isRevealed)
            "
            :cue="buildCue(line.text)"
            @select="rehearsal.goToLine(index)"
          />

          <div v-if="rehearsal.lines.length === 0" class="pad">
            <ion-note>This scene has no lines.</ion-note>
          </div>

          <!-- Space so the last line can scroll clear of the footer. -->
          <div class="transcript__tail" />
        </div>
      </template>
    </ion-content>

    <ion-footer v-if="hasChosenRole">
      <!-- The actor's turn: the scene waits for them, not the other way round. -->
      <ion-toolbar v-if="rehearsal.isWaitingForMe || rehearsal.isMyTurn" class="your-turn">
        <div class="your-turn__inner">
          <ion-note class="your-turn__label">Your line</ion-note>

          <div class="your-turn__actions">
            <ion-button
              v-if="rehearsal.hideMyLines && !rehearsal.isRevealed"
              fill="outline"
              size="small"
              @click="rehearsal.reveal()"
            >
              <ion-icon slot="start" :icon="eyeOutline" />
              Show it
            </ion-button>

            <ion-button fill="outline" size="small" @click="rehearsal.speakMyLine()">
              <ion-icon slot="icon-only" :icon="volumeHighOutline" />
            </ion-button>

            <ion-button size="small" @click="rehearsal.confirmMyLine()">
              Said it — continue
            </ion-button>
          </div>
        </div>
      </ion-toolbar>

      <ion-toolbar>
        <div class="transport">
          <ion-button fill="clear" @click="rehearsal.previousLine()">
            <ion-icon slot="icon-only" :icon="chevronBackOutline" />
          </ion-button>

          <ion-button class="transport__play" @click="rehearsal.toggle()">
            <ion-icon slot="start" :icon="rehearsal.isRunning ? pauseOutline : playOutline" />
            {{ rehearsal.isRunning ? 'Pause' : 'Run scene' }}
          </ion-button>

          <ion-button fill="clear" @click="rehearsal.nextLine()">
            <ion-icon slot="icon-only" :icon="chevronForwardOutline" />
          </ion-button>
        </div>
        <ion-note class="scene-caption">{{ sceneLabel }}</ion-note>
      </ion-toolbar>
    </ion-footer>

    <ion-modal :is-open="isSettingsOpen" @did-dismiss="isSettingsOpen = false">
      <ion-header>
        <ion-toolbar>
          <ion-title>Rehearsal settings</ion-title>
          <ion-buttons slot="end">
            <ion-button @click="isSettingsOpen = false">Done</ion-button>
          </ion-buttons>
        </ion-toolbar>
      </ion-header>

      <ion-content class="ion-padding">
        <ion-list>
          <ion-item>
            <ion-toggle v-model="rehearsal.hideMyLines">
              <ion-label>
                <h3>Hide my lines</h3>
                <p>Show only the first few words as a cue.</p>
              </ion-label>
            </ion-toggle>
          </ion-item>

          <ion-item>
            <ion-toggle v-model="rehearsal.speakDirections">
              <ion-label>
                <h3>Read stage directions</h3>
                <p>Off by default — they are printed, not spoken.</p>
              </ion-label>
            </ion-toggle>
          </ion-item>

          <ion-item>
            <ion-toggle v-model="rehearsal.autoAdvanceScene">
              <ion-label>
                <h3>Continue into the next scene</h3>
                <p>Run the whole act without stopping.</p>
              </ion-label>
            </ion-toggle>
          </ion-item>

          <ion-item>
            <ion-label>
              <h3>Speed</h3>
              <p>{{ rehearsal.rate.toFixed(2) }}×</p>
            </ion-label>
          </ion-item>
          <ion-item lines="none">
            <ion-range
              :value="rehearsal.rate"
              :min="0.5"
              :max="2"
              :step="0.05"
              snaps
              :ticks="false"
              @ion-change="onRateChange"
            />
          </ion-item>
        </ion-list>

        <h3 class="voices__title">Language &amp; voices</h3>

        <ion-list>
          <ion-item>
            <ion-select
              :value="rehearsal.languageOverride ?? 'auto'"
              label="Language"
              label-placement="stacked"
              interface="popover"
              @ion-change="onLanguageChange($event.detail.value)"
            >
              <ion-select-option value="auto">
                Detect automatically ({{ LANGUAGE_LABELS[rehearsal.detectedLanguage] }})
              </ion-select-option>
              <ion-select-option v-for="code in languageOptions" :key="code" :value="code">
                {{ LANGUAGE_LABELS[code] }}
              </ion-select-option>
            </ion-select>
          </ion-item>
        </ion-list>

        <ion-text v-if="rehearsal.isSpeechDegraded" color="warning">
          <p class="pad">
            The speech server could not be reached, so this device's own voices are being used. They
            depend on what your operating system has installed — on a machine with no
            {{ LANGUAGE_LABELS[rehearsal.language] }} voice, lines will sound wrong.
          </p>
        </ion-text>

        <ion-text v-else-if="rehearsal.isMissingVoiceForLanguage" color="warning">
          <p class="pad">
            No {{ LANGUAGE_LABELS[rehearsal.language] }} voice is available, so lines will be read
            by the default engine and may sound wrong. Pick a voice below by hand.
          </p>
        </ion-text>

        <ion-note v-if="rehearsal.voices.length === 0" class="pad">
          No speech voices were reported by this platform.
        </ion-note>

        <ion-list v-else>
          <ion-item v-for="character in rehearsal.characters" :key="character.id">
            <ion-select
              :value="rehearsal.voiceByCharacterId[character.id]"
              :label="character.name"
              label-placement="stacked"
              interface="popover"
              @ion-change="rehearsal.setVoiceForCharacter(character.id, $event.detail.value)"
            >
              <ion-select-option v-for="voice in pickableVoices" :key="voice.id" :value="voice.id">
                {{ voice.name }} ({{ voice.lang }}) ·
                {{ voice.source === 'server' ? 'server' : 'this device' }}
              </ion-select-option>
            </ion-select>
          </ion-item>
        </ion-list>
      </ion-content>
    </ion-modal>
  </ion-page>
</template>

<style scoped>
.centered {
  display: flex;
  justify-content: center;
  padding: 3rem 0;
}

.pad {
  display: block;
  padding: 1rem 1.5rem;
}

.intro {
  padding: 1.5rem 1.5rem 0.5rem;
}

.intro h2 {
  margin: 0 0 0.5rem;
  font-size: 1.25rem;
}

.intro p {
  margin: 0;
  color: var(--ion-color-medium);
  font-size: 0.9375rem;
  line-height: 1.5;
}

.scene-bar {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.5rem 1.25rem;
}

.scene-bar__role {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.875rem;
  white-space: nowrap;
}

.transcript {
  padding-top: 0.5rem;
}

.transcript__tail {
  height: 4rem;
}

.transport {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.transport__play {
  min-width: 11rem;
}

.scene-caption {
  display: block;
  padding: 0 1rem 0.375rem;
  text-align: center;
  font-size: 0.75rem;
}

.your-turn {
  --background: var(--ion-color-warning-tint);
}

.your-turn__inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.375rem 0.75rem;
  flex-wrap: wrap;
}

.your-turn__label {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ion-color-warning-contrast);
}

.your-turn__actions {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}
</style>
