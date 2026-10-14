<script setup lang="ts">
import type { Script } from '@osvald/shared';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonFooter,
  IonHeader,
  IonIcon,
  IonList,
  IonNote,
  IonPage,
  IonRefresher,
  IonRefresherContent,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/vue';
import { cloudUploadOutline, logOutOutline } from 'ionicons/icons';
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import HealthStatusCard from '@/components/HealthStatusCard.vue';
import ScriptListItem from '@/components/ScriptListItem.vue';
import { useAuthStore } from '@/stores/authStore';
import { useScriptStore } from '@/stores/scriptStore';

/**
 * The script library: everything the signed-in actor has uploaded, plus the
 * upload entry point.
 *
 * A freshly uploaded script is parsed on a queue worker, so the store keeps
 * polling it and the row shows a spinner until it is ready to rehearse.
 */
const router = useRouter();
const auth = useAuthStore();
const scriptStore = useScriptStore();

const fileInput = ref<HTMLInputElement | null>(null);
const showDiagnostics = ref(false);

onMounted(() => {
  void scriptStore.fetchScripts();
});

function openScript(script: Script): void {
  void router.push({ name: 'script-detail', params: { id: script.id } });
}

function pickFile(): void {
  fileInput.value?.click();
}

async function onFileSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (file !== undefined) {
    const uploaded = await scriptStore.uploadScript({ file });
    if (uploaded !== null) {
      // Go straight to the detail page: that is where parsing progress shows.
      openScript(uploaded);
    }
  }

  // Allow re-selecting the same file next time.
  input.value = '';
}

async function refresh(event?: CustomEvent<unknown>): Promise<void> {
  await scriptStore.fetchScripts();

  // Ionic's <ion-refresher> needs to be told when to stop spinning.
  const target = event?.target as { complete?: () => Promise<void> } | null | undefined;
  await target?.complete?.();
}

function signOut(): void {
  scriptStore.clear();
  auth.signOut();
  void router.replace({ name: 'login' });
}
</script>

<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-title>Your scripts</ion-title>
        <ion-buttons slot="end">
          <ion-button fill="clear" size="small" @click="refresh()">Reload</ion-button>
          <ion-button fill="clear" size="small" @click="signOut">
            <ion-icon slot="icon-only" :icon="logOutOutline" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <ion-refresher slot="fixed" @ion-refresh="refresh($event)">
        <ion-refresher-content />
      </ion-refresher>

      <div v-if="scriptStore.isLoading && scriptStore.isEmpty" class="centered">
        <ion-spinner name="crescent" />
      </div>

      <div v-else-if="scriptStore.isEmpty" class="empty">
        <h2>No scripts yet</h2>
        <p>
          Upload a PDF of a play. Osvald reads it — using the embedded text where there is one and
          OCR where there is not — then splits it into scenes, characters and lines so you can
          rehearse against the cast.
        </p>
      </div>

      <ion-list v-else :inset="true">
        <ScriptListItem
          v-for="script in scriptStore.scripts"
          :key="script.id"
          :script="script"
          :is-parsing="scriptStore.parsingIds.includes(script.id)"
          @select="openScript"
        />
      </ion-list>

      <ion-text v-if="scriptStore.error !== null" color="danger">
        <p class="error">{{ scriptStore.error }}</p>
      </ion-text>

      <div class="diagnostics">
        <ion-button fill="clear" size="small" @click="showDiagnostics = !showDiagnostics">
          {{ showDiagnostics ? 'Hide' : 'Show' }} backend status
        </ion-button>
        <HealthStatusCard v-if="showDiagnostics" />
      </div>

      <input
        ref="fileInput"
        class="file-input"
        type="file"
        accept="application/pdf,.pdf"
        @change="onFileSelected"
      />
    </ion-content>

    <ion-footer>
      <ion-toolbar>
        <ion-button
          expand="block"
          class="ion-margin-horizontal"
          :disabled="scriptStore.isUploading"
          @click="pickFile"
        >
          <ion-icon slot="start" :icon="cloudUploadOutline" />
          {{ scriptStore.isUploading ? 'Uploading…' : 'Upload a script (PDF)' }}
        </ion-button>
        <ion-note v-if="auth.user !== null" class="signed-in">
          Signed in as {{ auth.user.email }}
        </ion-note>
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

.empty {
  padding: 2rem 1.5rem;
  text-align: center;
  color: var(--ion-color-medium);
}

.empty h2 {
  margin: 0 0 0.5rem;
  color: var(--ion-text-color);
}

.empty p {
  margin: 0;
  font-size: 0.9375rem;
  line-height: 1.5;
}

.error {
  padding: 0 1.5rem;
  font-size: 0.875rem;
}

.diagnostics {
  padding: 0 1rem 2rem;
  text-align: center;
}

.file-input {
  display: none;
}

.signed-in {
  display: block;
  padding: 0.25rem 1rem 0.5rem;
  text-align: center;
  font-size: 0.75rem;
}
</style>
