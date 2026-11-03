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
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  alertController,
} from '@ionic/vue';
import { addOutline, cloudUploadOutline, logOutOutline, peopleOutline } from 'ionicons/icons';
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import HealthStatusCard from '@/components/HealthStatusCard.vue';
import ScriptListItem from '@/components/ScriptListItem.vue';
import { useAuthStore } from '@/stores/authStore';
import { useScriptStore } from '@/stores/scriptStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

/**
 * The library of the current workspace, the switch between workspaces, and,
 * for the workspace's editor, the upload entry point.
 *
 * A freshly uploaded script is parsed on a queue worker, so the store keeps
 * polling it and the row shows a spinner until it is ready to rehearse.
 */
const router = useRouter();
const auth = useAuthStore();
const scriptStore = useScriptStore();
const workspaceStore = useWorkspaceStore();

const fileInput = ref<HTMLInputElement | null>(null);
const showDiagnostics = ref(false);

const canUpload = computed(() => workspaceStore.canHere('script:import'));

onMounted(() => {
  void workspaceStore.ensureLoaded();
});

// Every switch, including the first choice after loading, reloads the library.
watch(
  () => workspaceStore.currentWorkspaceId,
  (id) => {
    if (id === null) {
      scriptStore.clear();
    } else {
      void scriptStore.fetchScripts(id);
    }
  },
  { immediate: true },
);

async function promptNewWorkspace(): Promise<void> {
  const alert = await alertController.create({
    header: 'New workspace',
    message: 'You will be its editor and can invite the cast.',
    inputs: [{ name: 'name', type: 'text', placeholder: 'e.g. Teatrul Mic — Salem' }],
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Create',
        handler: (data: { name?: string }) => {
          const name = data.name?.trim() ?? '';
          if (name.length === 0) {
            return false;
          }
          void workspaceStore.createWorkspace(name);
          return true;
        },
      },
    ],
  });

  await alert.present();
}

function openPeople(): void {
  const id = workspaceStore.currentWorkspaceId;
  if (id !== null) {
    void router.push({ name: 'workspace', params: { id } });
  }
}

function openScript(script: Script): void {
  void router.push({ name: 'script-detail', params: { id: script.id } });
}

function pickFile(): void {
  fileInput.value?.click();
}

async function onFileSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  const workspaceId = workspaceStore.currentWorkspaceId;

  if (file !== undefined && workspaceId !== null) {
    const uploaded = await scriptStore.uploadScript({ workspaceId, file });
    if (uploaded !== null) {
      // Go straight to the detail page: that is where parsing progress shows.
      openScript(uploaded);
    }
  }

  // Allow re-selecting the same file next time.
  input.value = '';
}

async function refresh(event?: CustomEvent<unknown>): Promise<void> {
  // The role may have changed (a transfer, a removal) since the list was loaded.
  await workspaceStore.fetchWorkspaces();
  const id = workspaceStore.currentWorkspaceId;
  if (id !== null) {
    await scriptStore.fetchScripts(id);
  }

  // Ionic's <ion-refresher> needs to be told when to stop spinning.
  const target = event?.target as { complete?: () => Promise<void> } | null | undefined;
  await target?.complete?.();
}

function signOut(): void {
  scriptStore.clear();
  workspaceStore.clear();
  auth.signOut();
  void router.replace({ name: 'login' });
}
</script>

<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-title>Scripts</ion-title>
        <ion-buttons slot="end">
          <ion-button fill="clear" size="small" @click="refresh()">Reload</ion-button>
          <ion-button fill="clear" size="small" aria-label="Sign out" @click="signOut">
            <ion-icon slot="icon-only" :icon="logOutOutline" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
      <ion-toolbar>
        <ion-select
          class="workspace-select"
          aria-label="Workspace"
          interface="popover"
          :value="workspaceStore.currentWorkspaceId"
          :placeholder="workspaceStore.isLoading ? 'Loading workspaces…' : 'No workspace'"
          @ion-change="workspaceStore.select($event.detail.value)"
        >
          <ion-select-option
            v-for="workspace in workspaceStore.workspaces"
            :key="workspace.id"
            :value="workspace.id"
          >
            {{ workspace.name }}{{ workspace.role === 'editor' ? ' (editor)' : '' }}
          </ion-select-option>
        </ion-select>
        <ion-buttons slot="end">
          <ion-button
            fill="clear"
            size="small"
            aria-label="Members"
            :disabled="workspaceStore.currentWorkspace === null"
            @click="openPeople"
          >
            <ion-icon slot="start" :icon="peopleOutline" />
            {{ workspaceStore.currentWorkspace?.memberCount ?? '' }}
          </ion-button>
          <ion-button
            fill="clear"
            size="small"
            aria-label="New workspace"
            @click="promptNewWorkspace"
          >
            <ion-icon slot="icon-only" :icon="addOutline" />
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

      <div v-else-if="scriptStore.isEmpty && canUpload" class="empty">
        <h2>No scripts yet</h2>
        <p>
          Upload a PDF of a play. Osvald reads it — using the embedded text where there is one and
          OCR where there is not — then splits it into scenes, characters and lines so you can
          rehearse against the cast.
        </p>
      </div>

      <div v-else-if="scriptStore.isEmpty" class="empty">
        <h2>No scripts yet</h2>
        <p>The editor of this workspace has not uploaded a script yet.</p>
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
      <ion-text v-if="workspaceStore.error !== null" color="danger">
        <p class="error">{{ workspaceStore.error }}</p>
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
          v-if="canUpload"
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
.workspace-select {
  padding-inline: 1rem;
  font-weight: 600;
}

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
