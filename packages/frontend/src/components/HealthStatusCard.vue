<script setup lang="ts">
import {
  IonBadge,
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonCardTitle,
  IonChip,
  IonLabel,
  IonNote,
  IonSpinner,
} from '@ionic/vue';
import { onMounted } from 'vue';

import { useHealth } from '@/composables/useHealth';

/**
 * Backend diagnostics, shown on demand from the library screen.
 *
 * A dependency that is down does not fail the request (the backend reports
 * `status: "degraded"`), which is what lets this card show a useful diagnosis —
 * e.g. "the OCR service is not running" in a plain `pnpm dev` setup.
 */
const { health, isLoading, error, refreshHealth } = useHealth();

onMounted(() => {
  // Module-level state is shared, so skip the fetch if it already ran.
  if (health.value === null) {
    void refreshHealth();
  }
});
</script>

<template>
  <ion-card>
    <ion-card-header>
      <ion-card-title>Backend</ion-card-title>
      <ion-card-subtitle>GET /health</ion-card-subtitle>
    </ion-card-header>

    <ion-card-content>
      <ion-spinner v-if="isLoading && health === null" name="crescent" />

      <p v-else-if="error !== null" class="osvald-health__error">{{ error }}</p>

      <template v-else-if="health !== null">
        <p class="osvald-health__summary">
          <ion-badge :color="health.status === 'ok' ? 'success' : 'warning'">
            {{ health.status }}
          </ion-badge>
          <ion-note>
            {{ health.service }} v{{ health.version }} · up {{ health.uptimeSeconds }}s
          </ion-note>
        </p>

        <ul class="osvald-health__dependencies">
          <li v-for="dependency in health.dependencies" :key="dependency.name">
            <ion-chip :color="dependency.status === 'up' ? 'success' : 'danger'" outline>
              <ion-label>{{ dependency.name }}: {{ dependency.status }}</ion-label>
            </ion-chip>
            <ion-note v-if="dependency.latencyMs !== null">{{ dependency.latencyMs }} ms</ion-note>
            <ion-note v-if="dependency.message !== null" color="danger">
              {{ dependency.message }}
            </ion-note>
          </li>
        </ul>
      </template>

      <ion-button size="small" fill="outline" :disabled="isLoading" @click="refreshHealth">
        {{ isLoading ? 'Checking…' : 'Re-check' }}
      </ion-button>
    </ion-card-content>
  </ion-card>
</template>

<style scoped>
.osvald-health__summary {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.osvald-health__dependencies {
  margin: 0.5rem 0;
  padding: 0;
  list-style: none;
}

.osvald-health__dependencies li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.osvald-health__error {
  color: var(--ion-color-danger);
  word-break: break-word;
}
</style>
