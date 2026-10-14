<script setup lang="ts">
import type { Line } from '@osvald/shared';
import { computed } from 'vue';

/**
 * One line of a scene in the rehearsal transcript.
 *
 * Three states have to be distinguishable at a glance while the actor is
 * looking up from the page: whose line it is, whether it is the current one,
 * and — for the actor's own lines — whether the text is being withheld as a
 * cue. Stage directions are set apart so they are never mistaken for dialogue.
 */
const props = defineProps<{
  line: Line;
  speakerName: string | null;
  isCurrent: boolean;
  isMine: boolean;
  /** Withhold the text and show `cue` instead. */
  isHidden: boolean;
  cue: string;
}>();

defineEmits<{ select: [] }>();

const isDirection = computed(() => props.line.type === 'direction');
</script>

<template>
  <button
    type="button"
    class="line"
    :class="{
      'line--current': isCurrent,
      'line--mine': isMine,
      'line--direction': isDirection,
    }"
    @click="$emit('select')"
  >
    <span v-if="isDirection" class="line__direction">{{ line.text }}</span>

    <template v-else>
      <span class="line__speaker">{{ speakerName ?? line.speakerLabel ?? 'Unknown' }}</span>

      <span v-if="isHidden" class="line__hidden">
        <span class="line__cue">{{ cue }}</span>
        <span class="line__hidden-note">your line — hidden</span>
      </span>
      <span v-else class="line__text">{{ line.text }}</span>
    </template>
  </button>
</template>

<style scoped>
.line {
  display: block;
  width: 100%;
  margin: 0;
  padding: 0.625rem 1.25rem;
  border: 0;
  border-left: 3px solid transparent;
  background: none;
  font: inherit;
  text-align: left;
  color: var(--ion-text-color);
  cursor: pointer;
}

.line--current {
  background: var(--ion-color-step-100);
  border-left-color: var(--ion-color-primary);
}

.line--mine {
  border-left-color: var(--ion-color-step-350);
}

.line--current.line--mine {
  border-left-color: var(--ion-color-warning);
}

.line__speaker {
  display: block;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ion-color-medium);
  margin-bottom: 0.125rem;
}

.line--mine .line__speaker {
  color: var(--ion-color-warning-shade);
}

.line__text {
  display: block;
  line-height: 1.5;
}

.line__direction {
  display: block;
  font-style: italic;
  font-size: 0.875rem;
  color: var(--ion-color-medium);
  line-height: 1.45;
}

.line__hidden {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.line__cue {
  font-style: italic;
  color: var(--ion-color-medium);
}

.line__hidden-note {
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ion-color-step-450);
}
</style>
