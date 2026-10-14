import { IonicVue } from '@ionic/vue';
import { createPinia } from 'pinia';
import { createApp } from 'vue';

// Ionic core styles. Order matters: core -> structure -> utilities.
import '@ionic/vue/css/core.css';
import '@ionic/vue/css/normalize.css';
import '@ionic/vue/css/structure.css';
import '@ionic/vue/css/typography.css';
import '@ionic/vue/css/padding.css';
import '@ionic/vue/css/float-elements.css';
import '@ionic/vue/css/text-alignment.css';
import '@ionic/vue/css/text-transformation.css';
import '@ionic/vue/css/flex-utils.css';
import '@ionic/vue/css/display.css';
// Follows the OS light/dark preference. Use dark.always.css to force dark.
import '@ionic/vue/css/palettes/dark.system.css';
// App theme tokens (see the file for the TODO on the real palette).
import './theme/variables.css';

import App from './App.vue';
import { router } from './router';

const app = createApp(App);

app.use(IonicVue);
app.use(createPinia());
app.use(router);

// TODO(app): wire up error reporting (Sentry or similar) before shipping.

void router.isReady().then(() => {
  app.mount('#app');
});
