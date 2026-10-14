<script setup lang="ts">
import { IonApp, IonRouterOutlet } from '@ionic/vue';

/**
 * Root component.
 *
 * Deliberately bare: the session is restored by the router guard
 * (`router/index.ts`), which has to happen before the first route resolves, and
 * backend diagnostics are fetched by `HealthStatusCard` when it is opened.
 *
 * TODO(app): wire up error reporting (Sentry or similar) before shipping.
 */
</script>

<template>
  <ion-app>
    <ion-router-outlet />
  </ion-app>
</template>
