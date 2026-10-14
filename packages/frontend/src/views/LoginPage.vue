<script setup lang="ts">
import {
  IonButton,
  IonContent,
  IonInput,
  IonItem,
  IonList,
  IonNote,
  IonPage,
  IonSegment,
  IonSegmentButton,
  IonText,
} from '@ionic/vue';
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { useAuthStore } from '@/stores/authStore';

/**
 * Sign in or create an account.
 *
 * One screen for both: the fields are nearly identical, and a prototype that
 * asks people to hunt for a separate registration page loses them.
 */

const DEMO_EMAIL = 'demo@osvald.app';
const DEMO_PASSWORD = 'osvald-demo-2026';

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();

type Mode = 'signIn' | 'signUp';

const mode = ref<Mode>('signIn');
const email = ref('');
const password = ref('');
const displayName = ref('');

const isSignUp = computed(() => mode.value === 'signUp');

const canSubmit = computed(
  () =>
    email.value.trim().length > 0 &&
    // The API requires at least 8 characters for a new account.
    password.value.length >= (isSignUp.value ? 8 : 1) &&
    !auth.isSubmitting,
);

/** Honour `?redirect=` so a guarded link lands where it was aimed. */
function afterAuth(): void {
  const redirect = route.query.redirect;
  void router.replace(typeof redirect === 'string' && redirect.length > 0 ? redirect : '/');
}

async function submit(): Promise<void> {
  if (!canSubmit.value) {
    return;
  }

  const ok = isSignUp.value
    ? await auth.signUp(
        email.value.trim(),
        password.value,
        displayName.value.trim() === '' ? null : displayName.value.trim(),
      )
    : await auth.signIn(email.value.trim(), password.value);

  if (ok) {
    afterAuth();
  }
}

async function useDemoAccount(): Promise<void> {
  mode.value = 'signIn';
  email.value = DEMO_EMAIL;
  password.value = DEMO_PASSWORD;

  if (await auth.signIn(DEMO_EMAIL, DEMO_PASSWORD)) {
    afterAuth();
  }
}
</script>

<template>
  <ion-page>
    <ion-content :fullscreen="true" class="ion-padding">
      <div class="login">
        <header class="login__header">
          <h1>Osvald</h1>
          <p>Upload a script, pick your role, rehearse against the rest of the cast.</p>
        </header>

        <ion-segment v-model="mode" class="login__mode">
          <ion-segment-button value="signIn">Sign in</ion-segment-button>
          <ion-segment-button value="signUp">Create account</ion-segment-button>
        </ion-segment>

        <form @submit.prevent="submit">
          <ion-list :inset="true">
            <ion-item>
              <ion-input
                v-model="email"
                label="Email"
                label-placement="stacked"
                type="email"
                inputmode="email"
                autocomplete="email"
                placeholder="actor@example.com"
                :disabled="auth.isSubmitting"
              />
            </ion-item>

            <ion-item>
              <ion-input
                v-model="password"
                label="Password"
                label-placement="stacked"
                type="password"
                :autocomplete="isSignUp ? 'new-password' : 'current-password'"
                :helper-text="isSignUp ? 'At least 8 characters' : undefined"
                :disabled="auth.isSubmitting"
              />
            </ion-item>

            <ion-item v-if="isSignUp">
              <ion-input
                v-model="displayName"
                label="Name (optional)"
                label-placement="stacked"
                autocomplete="name"
                :disabled="auth.isSubmitting"
              />
            </ion-item>
          </ion-list>

          <div class="login__actions">
            <ion-button expand="block" type="submit" :disabled="!canSubmit">
              {{ auth.isSubmitting ? 'Working…' : isSignUp ? 'Create account' : 'Sign in' }}
            </ion-button>

            <ion-text v-if="auth.error !== null" color="danger">
              <p class="login__error">{{ auth.error }}</p>
            </ion-text>
          </div>
        </form>

        <div class="login__demo">
          <ion-button
            fill="clear"
            size="small"
            :disabled="auth.isSubmitting"
            @click="useDemoAccount"
          >
            Use the demo account
          </ion-button>
          <ion-note>
            Three Molière plays, already parsed. Created by <code>pnpm db:seed</code>.
          </ion-note>
        </div>
      </div>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.login {
  max-width: 28rem;
  margin: 0 auto;
  padding-top: 2rem;
}

.login__header {
  text-align: center;
  margin-bottom: 1.5rem;
}

.login__header h1 {
  margin: 0 0 0.25rem;
  font-size: 2rem;
  font-weight: 700;
}

.login__header p {
  margin: 0;
  color: var(--ion-color-medium);
}

.login__mode {
  margin-bottom: 0.5rem;
}

.login__actions {
  padding: 0 1rem;
}

.login__error {
  margin: 0.75rem 0 0;
  font-size: 0.875rem;
}

.login__demo {
  margin-top: 1.5rem;
  text-align: center;
}

.login__demo ion-note {
  display: block;
  font-size: 0.8rem;
}
</style>
