<script setup lang="ts">
import type { Invitation, WorkspaceMember } from '@osvald/shared';
import {
  IonBackButton,
  IonBadge,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonPage,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  alertController,
} from '@ionic/vue';
import { computed, onMounted, ref } from 'vue';

import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

/**
 * One workspace's people: its members, and for the editor the invitations
 * and the actions on members (remove, hand over the editor role).
 *
 * Every action is also checked by the server; the role only decides what
 * this page offers.
 */
const props = defineProps<{ id: string }>();

const auth = useAuthStore();
const workspaceStore = useWorkspaceStore();

const workspace = computed(
  () => workspaceStore.workspaces.find((candidate) => candidate.id === props.id) ?? null,
);
const canInvite = computed(() => workspaceStore.canIn(props.id, 'workspace:invite'));
const canManage = computed(() => workspaceStore.canIn(props.id, 'workspace:remove_member'));

const inviteEmail = ref('');
const isInviting = ref(false);
/** What happened to the last invitation, shown under the form. */
const inviteNotice = ref<string | null>(null);

onMounted(async () => {
  await workspaceStore.ensureLoaded();
  await workspaceStore.fetchPeople(props.id);
});

function memberName(member: WorkspaceMember): string {
  return member.displayName ?? member.email;
}

function noticeFor(email: string, outcome: { emailSent: boolean }): string {
  return outcome.emailSent
    ? `Invitation sent to ${email}.`
    : `The invitation to ${email} is saved, but the e-mail could not be sent. Try "Resend" later.`;
}

async function sendInvite(): Promise<void> {
  const email = inviteEmail.value.trim();
  if (email.length === 0 || isInviting.value) {
    return;
  }

  isInviting.value = true;
  inviteNotice.value = null;

  try {
    const outcome = await workspaceStore.invite(props.id, email);
    if (outcome !== null) {
      inviteNotice.value = noticeFor(email, outcome);
      inviteEmail.value = '';
    }
  } finally {
    isInviting.value = false;
  }
}

async function resend(invitation: Invitation): Promise<void> {
  const outcome = await workspaceStore.resendInvitation(props.id, invitation.id);
  if (outcome !== null) {
    inviteNotice.value = noticeFor(invitation.email, outcome);
  }
}

async function revoke(invitation: Invitation): Promise<void> {
  await workspaceStore.revokeInvitation(props.id, invitation.id);
}

async function confirm(header: string, message: string, action: string): Promise<boolean> {
  const alert = await alertController.create({
    header,
    message,
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      { text: action, role: 'confirm' },
    ],
  });
  await alert.present();
  const { role } = await alert.onDidDismiss();
  return role === 'confirm';
}

async function rename(): Promise<void> {
  const alert = await alertController.create({
    header: 'Rename workspace',
    inputs: [{ name: 'name', type: 'text', value: workspace.value?.name ?? '' }],
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Rename',
        handler: (data: { name?: string }) => {
          const name = data.name?.trim() ?? '';
          if (name.length === 0) {
            return false;
          }
          void workspaceStore.renameWorkspace(props.id, name);
          return true;
        },
      },
    ],
  });
  await alert.present();
}

async function remove(member: WorkspaceMember): Promise<void> {
  const ok = await confirm(
    `Remove ${memberName(member)}?`,
    'They will no longer see the scripts of this workspace. You can invite them again later.',
    'Remove',
  );
  if (ok) {
    await workspaceStore.removeMember(props.id, member.userId);
  }
}

async function makeEditor(member: WorkspaceMember): Promise<void> {
  const ok = await confirm(
    `Make ${memberName(member)} the editor?`,
    'A workspace has one editor. You become a member: you can still read and rehearse, but no longer upload, edit or manage people.',
    'Hand over',
  );
  if (ok) {
    await workspaceStore.transferEditor(props.id, member.userId);
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}
</script>

<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/" />
        </ion-buttons>
        <ion-title>{{ workspace?.name ?? 'Workspace' }}</ion-title>
        <ion-buttons v-if="canManage" slot="end">
          <ion-button fill="clear" size="small" @click="rename">Rename</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <div v-if="workspaceStore.isLoading && workspaceStore.members.length === 0" class="centered">
        <ion-spinner name="crescent" />
      </div>

      <template v-else>
        <ion-list :inset="true">
          <ion-list-header>
            <ion-label>Members</ion-label>
          </ion-list-header>
          <ion-item v-for="member in workspaceStore.members" :key="member.userId">
            <ion-label>
              <h3>
                {{ memberName(member) }}
                <template v-if="member.userId === auth.user?.id"> (you)</template>
              </h3>
              <p v-if="member.displayName !== null">{{ member.email }}</p>
            </ion-label>
            <ion-badge v-if="member.role === 'editor'" slot="end" color="primary">editor</ion-badge>
            <ion-buttons v-else-if="canManage" slot="end">
              <ion-button fill="clear" size="small" @click="makeEditor(member)">
                Make editor
              </ion-button>
              <ion-button fill="clear" size="small" color="danger" @click="remove(member)">
                Remove
              </ion-button>
            </ion-buttons>
          </ion-item>
        </ion-list>

        <template v-if="canInvite">
          <ion-list :inset="true">
            <ion-list-header>
              <ion-label>Invite</ion-label>
            </ion-list-header>
            <ion-item>
              <ion-input
                v-model="inviteEmail"
                type="email"
                inputmode="email"
                autocomplete="email"
                label="E-mail"
                label-placement="stacked"
                placeholder="actor@example.com"
                @keyup.enter="sendInvite"
              />
              <ion-button
                slot="end"
                :disabled="inviteEmail.trim().length === 0 || isInviting"
                @click="sendInvite"
              >
                {{ isInviting ? 'Sending…' : 'Invite' }}
              </ion-button>
            </ion-item>
            <ion-item v-if="inviteNotice !== null" lines="none">
              <ion-note>{{ inviteNotice }}</ion-note>
            </ion-item>
          </ion-list>

          <ion-list v-if="workspaceStore.invitations.length > 0" :inset="true">
            <ion-list-header>
              <ion-label>Waiting for an answer</ion-label>
            </ion-list-header>
            <ion-item v-for="invitation in workspaceStore.invitations" :key="invitation.id">
              <ion-label>
                <h3>{{ invitation.email }}</h3>
                <p>
                  <template v-if="invitation.status === 'expired'">
                    Expired on {{ formatDate(invitation.expiresAt) }}
                  </template>
                  <template v-else
                    >Link works until {{ formatDate(invitation.expiresAt) }}</template
                  >
                </p>
              </ion-label>
              <ion-buttons slot="end">
                <ion-button fill="clear" size="small" @click="resend(invitation)"
                  >Resend</ion-button
                >
                <ion-button fill="clear" size="small" color="danger" @click="revoke(invitation)">
                  Revoke
                </ion-button>
              </ion-buttons>
            </ion-item>
          </ion-list>
        </template>

        <ion-note v-else class="pad">
          Only the editor of this workspace uploads scripts and invites people.
        </ion-note>
      </template>

      <ion-text v-if="workspaceStore.error !== null" color="danger">
        <p class="pad">{{ workspaceStore.error }}</p>
      </ion-text>
    </ion-content>
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
  padding: 0 1.5rem;
  font-size: 0.875rem;
}
</style>
