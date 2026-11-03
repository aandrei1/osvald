<script setup lang="ts">
import {
  IonBackButton,
  IonBadge,
  IonButton,
  IonButtons,
  IonChip,
  IonContent,
  IonFooter,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonPage,
  IonProgressBar,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  alertController,
} from '@ionic/vue';
import { isRehearsableStage } from '@osvald/shared';
import { playCircleOutline, refreshOutline, trashOutline } from 'ionicons/icons';
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';

import { describeLoss } from '@/lib/loss-summary';
import { STAGE_COLORS, STAGE_LABELS } from '@/lib/stage';
import { useScriptStore } from '@/stores/scriptStore';

/**
 * One script: its cast and its scenes.
 *
 * This is also where an extraction is watched. A script arrives here moments
 * after upload, still `extracting`, so the page has to be useful while there is
 * nothing to show yet — and has to explain a failure well enough to act on.
 */
const props = defineProps<{ id: string }>();

const router = useRouter();
const scriptStore = useScriptStore();

const script = computed(() => scriptStore.currentScript);
const isPending = computed(() => script.value?.stage === 'extracting');
const isReady = computed(() => script.value !== null && isRehearsableStage(script.value.stage));

const lineTotal = computed(() =>
  (script.value?.scenes ?? []).reduce((total, scene) => total + scene.lines.length, 0),
);

onMounted(() => {
  void scriptStore.fetchScriptDetail(props.id, { force: true });

  // A reload while a parse is running must pick the watch back up.
  scriptStore.watchParsing(props.id);
});

/**
 * Opens the rehearsal view, either over the whole script or over one scene.
 *
 * The scene travels in the query rather than the path: it is a mode the same
 * rehearsal runs in, and keeping one route means a shared link, a reload or a
 * back-navigation all land in the same place.
 */
function startRehearsal(sceneId?: string): void {
  void router.push({
    name: 'rehearsal',
    params: { id: props.id },
    query: sceneId === undefined ? {} : { scene: sceneId },
  });
}

/** Every reparse is confirmed against what it would replace, whatever the stage. */
async function confirmReparse(): Promise<void> {
  const summary = await scriptStore.previewLoss(props.id, 'reparse');
  if (summary === null) {
    return;
  }

  const alert = await alertController.create({
    header: 'Parse the PDF again?',
    message: describeLoss(summary, 'reparse').join(' '),
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Parse again',
        handler: () => {
          void scriptStore.reparseScript(props.id);
        },
      },
    ],
  });

  await alert.present();
}

async function confirmDelete(): Promise<void> {
  const summary = await scriptStore.previewLoss(props.id, 'delete');
  if (summary === null) {
    return;
  }

  const alert = await alertController.create({
    header: 'Delete this script?',
    message: [...describeLoss(summary, 'delete'), 'This cannot be undone.'].join(' '),
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Delete',
        role: 'destructive',
        handler: () => {
          void scriptStore.deleteScript(props.id).then((ok) => {
            if (ok) {
              void router.replace({ name: 'home' });
            }
          });
        },
      },
    ],
  });

  await alert.present();
}
</script>

<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/" />
        </ion-buttons>
        <ion-title>{{ script?.title ?? 'Script' }}</ion-title>
        <ion-buttons slot="end">
          <ion-button fill="clear" size="small" @click="confirmDelete">
            <ion-icon slot="icon-only" :icon="trashOutline" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <div v-if="scriptStore.isLoading && script === null" class="centered">
        <ion-spinner name="crescent" />
      </div>

      <ion-text v-else-if="script === null" color="danger">
        <p class="pad">{{ scriptStore.error ?? 'This script could not be loaded.' }}</p>
      </ion-text>

      <template v-else>
        <!-- Parsing in progress: the only thing worth showing is progress. -->
        <div v-if="isPending" class="status-panel">
          <ion-progress-bar type="indeterminate" />
          <h2>Reading the script</h2>
          <p>Extracting the text and splitting it into scenes and lines.</p>
          <ion-note>
            A scanned PDF goes through OCR, which can take a few minutes. This page updates itself.
          </ion-note>
        </div>

        <div v-else-if="script.stage === 'failed'" class="status-panel status-panel--error">
          <h2>Parsing failed</h2>
          <p>{{ script.parseError ?? 'No further detail was recorded.' }}</p>
          <ion-button fill="outline" size="small" @click="confirmReparse">
            <ion-icon slot="start" :icon="refreshOutline" />
            Try again
          </ion-button>
        </div>

        <ion-list v-else :inset="true">
          <ion-item lines="none">
            <ion-label>
              <h2>{{ script.title }}</h2>
              <p v-if="script.author !== null">{{ script.author }}</p>
              <ion-note>
                {{ script.scenes.length }} scenes · {{ lineTotal }} lines ·
                {{ script.characters.length }} characters
                <template v-if="script.pageCount !== null">
                  · {{ script.pageCount }} {{ script.pageCount === 1 ? 'page' : 'pages' }}
                </template>
              </ion-note>
            </ion-label>
            <ion-badge slot="end" :color="STAGE_COLORS[script.stage]">
              {{ STAGE_LABELS[script.stage] }}
            </ion-badge>
          </ion-item>
        </ion-list>

        <template v-if="isReady">
          <section v-if="script.characters.length > 0" class="cast">
            <h3>Cast</h3>
            <div class="cast__chips">
              <ion-chip v-for="character in script.characters" :key="character.id" outline>
                {{ character.name }}
              </ion-chip>
            </div>
          </section>

          <section class="scenes-head">
            <h3>Scenes</h3>
            <ion-note>Tap one to rehearse it on its own.</ion-note>
          </section>

          <ion-list :inset="true">
            <ion-item
              v-for="scene in script.scenes"
              :key="scene.id"
              button
              :detail="false"
              lines="inset"
              @click="startRehearsal(scene.id)"
            >
              <ion-label class="scene">
                <h3>{{ scene.number }}</h3>
                <p v-if="scene.title !== scene.number">{{ scene.title }}</p>
                <ion-note>
                  {{ scene.lines.length }} lines
                  <template v-if="scene.pageStart !== null">
                    · p.{{ scene.pageStart
                    }}<template v-if="scene.pageEnd !== scene.pageStart"
                      >–{{ scene.pageEnd }}</template
                    >
                  </template>
                </ion-note>
              </ion-label>
              <ion-icon
                slot="end"
                :icon="playCircleOutline"
                color="primary"
                aria-hidden="true"
                class="scene__play"
              />
            </ion-item>
          </ion-list>

          <div class="secondary">
            <ion-button
              v-if="script.sourceFileName !== null && script.description === null"
              fill="clear"
              size="small"
              @click="confirmReparse"
            >
              <ion-icon slot="start" :icon="refreshOutline" />
              Parse again
            </ion-button>
          </div>
        </template>
      </template>
    </ion-content>

    <ion-footer v-if="isReady">
      <ion-toolbar>
        <ion-button expand="block" class="ion-margin-horizontal" @click="startRehearsal()">
          <ion-icon slot="start" :icon="playCircleOutline" />
          Rehearse the whole script
        </ion-button>
      </ion-toolbar>
    </ion-footer>
  </ion-page>
</template>

<style scoped>
.centered {
  display: flex;
  justify-content: center;
  padding: 3rem 0;
}

.pad {
  padding: 1.5rem;
}

.status-panel {
  margin: 1rem;
  padding: 1.5rem;
  border-radius: 0.75rem;
  background: var(--ion-color-step-50);
  text-align: center;
}

.status-panel h2 {
  margin: 1rem 0 0.5rem;
  font-size: 1.125rem;
}

.status-panel p {
  margin: 0 0 0.5rem;
  color: var(--ion-color-medium);
  font-size: 0.9375rem;
}

.status-panel--error h2 {
  color: var(--ion-color-danger);
  margin-top: 0;
}

.status-panel--error p {
  word-break: break-word;
}

.cast {
  padding: 0 1.5rem;
}

.cast h3 {
  margin: 0 0 0.5rem;
  font-size: 0.8125rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ion-color-medium);
}

.cast__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.scenes-head {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  flex-wrap: wrap;
  padding: 0.5rem 1.5rem 0;
}

.scenes-head h3 {
  margin: 0;
  font-size: 0.8125rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ion-color-medium);
}

.scene h3 {
  font-weight: 600;
}

.scene__play {
  font-size: 1.375rem;
}

.secondary {
  display: flex;
  justify-content: center;
  padding-bottom: 1rem;
}
</style>
