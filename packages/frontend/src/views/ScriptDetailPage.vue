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
  IonListHeader,
  IonNote,
  IonPage,
  IonProgressBar,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  alertController,
} from '@ionic/vue';
import { playCircleOutline, refreshOutline, trashOutline } from 'ionicons/icons';
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';

import { useScriptStore } from '@/stores/scriptStore';

/**
 * One script: its cast and its scenes.
 *
 * This is also where a parse is watched. A script arrives here moments after
 * upload, still `queued`, so the page has to be useful while there is nothing
 * to show yet — and has to explain a failure well enough to act on.
 */
const props = defineProps<{ id: string }>();

const router = useRouter();
const scriptStore = useScriptStore();

const script = computed(() => scriptStore.currentScript);
const isPending = computed(
  () => script.value !== null && ['uploaded', 'parsing'].includes(script.value.status),
);
const isReady = computed(() => script.value?.status === 'parsed');

const lineTotal = computed(() =>
  (script.value?.scenes ?? []).reduce((total, scene) => total + scene.lines.length, 0),
);

onMounted(() => {
  void scriptStore.fetchScriptDetail(props.id, { force: true });

  // A reload while a parse is running must pick the watch back up.
  scriptStore.watchParsing(props.id);
});

function startRehearsal(): void {
  void router.push({ name: 'rehearsal', params: { id: props.id } });
}

async function reparse(): Promise<void> {
  await scriptStore.reparseScript(props.id);
}

async function confirmDelete(): Promise<void> {
  const alert = await alertController.create({
    header: 'Delete this script?',
    message: 'Its scenes, characters and lines will be removed. This cannot be undone.',
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
          <p>
            {{
              script.status === 'uploaded'
                ? 'Queued — waiting for the parsing worker to pick it up.'
                : 'Extracting the text and splitting it into scenes and lines.'
            }}
          </p>
          <ion-note>
            A scanned PDF goes through OCR, which can take a few minutes. This page updates itself.
          </ion-note>
        </div>

        <div v-else-if="script.status === 'failed'" class="status-panel status-panel--error">
          <h2>Parsing failed</h2>
          <p>{{ script.parseError ?? 'No further detail was recorded.' }}</p>
          <ion-button fill="outline" size="small" @click="reparse">
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
            <ion-badge slot="end" color="success">ready</ion-badge>
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

          <ion-list :inset="true">
            <ion-list-header>Scenes</ion-list-header>
            <ion-item v-for="scene in script.scenes" :key="scene.id" lines="inset">
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
            </ion-item>
          </ion-list>

          <div class="secondary">
            <ion-button
              v-if="script.sourceFileName !== null && script.description === null"
              fill="clear"
              size="small"
              @click="reparse"
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
        <ion-button expand="block" class="ion-margin-horizontal" @click="startRehearsal">
          <ion-icon slot="start" :icon="playCircleOutline" />
          Rehearse
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

.scene h3 {
  font-weight: 600;
}

.secondary {
  display: flex;
  justify-content: center;
  padding-bottom: 1rem;
}
</style>
