<script setup lang="ts">
import type { InvitationPreview } from '@osvald/shared';
import {
  IonButton,
  IonContent,
  IonHeader,
  IonNote,
  IonPage,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/vue';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { useAuthStore } from '@/stores/authStore';
import { useScriptStore } from '@/stores/scriptStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

/**
 * Where the link in an invitation e-mail lands.
 *
 * It opens without an account, so the invitee sees what they were invited to
 * before signing up. Only the account with the invited address can accept;
 * anyone else is told which address to sign in with.
 *
 * TODO: [Capacitor] Open these links in the native app (universal links / app links).
 */
const props = defineProps<{ token: string }>();

const router = useRouter();
const auth = useAuthStore();
const scriptStore = useScriptStore();
const workspaceStore = useWorkspaceStore();

const preview = ref<InvitationPreview | null>(null);
const isLoading = ref(true);
const isAccepting = ref(false);

const isForMe = computed(
  () => auth.user !== null && auth.user.email === preview.value?.email.toLowerCase(),
);

onMounted(async () => {
  preview.value = await workspaceStore.previewInvitation(props.token);
  isLoading.value = false;
});

function signIn(): void {
  void router.push({
    name: 'login',
    query: { redirect: `/invitations/${props.token}`, email: preview.value?.email },
  });
}

function switchAccount(): void {
  scriptStore.clear();
  workspaceStore.clear();
  auth.signOut();
  signIn();
}

async function accept(): Promise<void> {
  isAccepting.value = true;

  try {
    const workspace = await workspaceStore.acceptInvitation(props.token);
    if (workspace !== null) {
      void router.replace({ name: 'home' });
    }
  } finally {
    isAccepting.value = false;
  }
}
</script>

<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-title>Invitation</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true" class="ion-padding">
      <div v-if="isLoading" class="centered">
        <ion-spinner name="crescent" />
      </div>

      <ion-text v-else-if="preview === null" color="danger">
        <h2>This link does not work</h2>
        <p>{{ workspaceStore.error ?? 'The invitation could not be found.' }}</p>
      </ion-text>

      <template v-else>
        <h2>{{ preview.invitedBy }} invited you to “{{ preview.workspaceName }}”</h2>

        <template v-if="preview.status === 'pending'">
          <p>
            You will be able to read and rehearse the scripts of this workspace. The invitation is
            for <strong>{{ preview.email }}</strong
            >.
          </p>

          <ion-button v-if="isForMe" expand="block" :disabled="isAccepting" @click="accept">
            {{ isAccepting ? 'Joining…' : 'Join the workspace' }}
          </ion-button>

          <template v-else-if="auth.user !== null">
            <ion-note class="block">
              You are signed in as {{ auth.user.email }}. Sign in with {{ preview.email }} to
              accept.
            </ion-note>
            <ion-button expand="block" fill="outline" @click="switchAccount">
              Switch account
            </ion-button>
          </template>

          <ion-button v-else expand="block" @click="signIn">
            Sign in or create an account
          </ion-button>
        </template>

        <ion-note v-else-if="preview.status === 'accepted'" class="block">
          This invitation was already used. Ask the editor for a new one if you still need it.
        </ion-note>
        <ion-note v-else-if="preview.status === 'revoked'" class="block">
          The editor withdrew this invitation, or sent a newer one. Check your e-mail for the latest
          link.
        </ion-note>
        <ion-note v-else class="block">
          This invitation expired. Ask the editor to send it again.
        </ion-note>

        <ion-text v-if="workspaceStore.error !== null" color="danger">
          <p>{{ workspaceStore.error }}</p>
        </ion-text>
      </template>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.centered {
  display: flex;
  justify-content: center;
  padding: 3rem 0;
}

.block {
  display: block;
  margin: 1rem 0;
}
</style>
