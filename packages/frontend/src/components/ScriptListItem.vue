<script setup lang="ts">
import type { Script } from '@osvald/shared';
import { IonBadge, IonItem, IonLabel, IonNote, IonSpinner } from '@ionic/vue';
import { computed } from 'vue';

/**
 * One row of the script library. Presentation only — navigation is the parent's
 * job, which keeps this component reusable (list, search results, recents).
 */
const props = defineProps<{ script: Script; isParsing?: boolean }>();

const emit = defineEmits<{ select: [script: Script] }>();

/** The states that matter to an actor: is it ready to rehearse yet? */
const statusColor = computed(() => {
  switch (props.script.status) {
    case 'parsed':
      return 'success';
    case 'failed':
      return 'danger';
    case 'parsing':
      return 'warning';
    default:
      return 'medium';
  }
});

const statusLabel = computed(() => {
  switch (props.script.status) {
    case 'parsed':
      return 'ready';
    case 'parsing':
      return 'reading…';
    case 'uploaded':
      return 'queued';
    default:
      return props.script.status;
  }
});

const subtitle = computed(() => {
  const parts: string[] = [];

  if (props.script.author !== null) {
    parts.push(props.script.author);
  }
  if (props.script.pageCount !== null) {
    parts.push(`${props.script.pageCount} ${props.script.pageCount === 1 ? 'page' : 'pages'}`);
  }

  return parts.join(' · ');
});
</script>

<template>
  <ion-item button :detail="true" @click="emit('select', script)">
    <ion-label>
      <h2>{{ script.title }}</h2>
      <p v-if="subtitle.length > 0">{{ subtitle }}</p>
      <ion-note v-if="script.status === 'failed' && script.parseError !== null" color="danger">
        {{ script.parseError }}
      </ion-note>
      <ion-note v-else-if="script.sourceFileName !== null">
        {{ script.sourceFileName }}
      </ion-note>
    </ion-label>

    <div slot="end" class="status">
      <ion-spinner v-if="isParsing === true" name="crescent" class="status__spinner" />
      <ion-badge :color="statusColor">{{ statusLabel }}</ion-badge>
    </div>
  </ion-item>
</template>

<style scoped>
.status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.status__spinner {
  width: 1rem;
  height: 1rem;
}
</style>
