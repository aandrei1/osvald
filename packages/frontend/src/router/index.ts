import { createRouter, createWebHashHistory, createWebHistory } from '@ionic/vue-router';
import type { RouteRecordRaw } from 'vue-router';

import HomePage from '@/views/HomePage.vue';
import { useAuthStore } from '@/stores/authStore';

/**
 * Routes.
 *
 * Ionic needs its own router (`@ionic/vue-router`) — it keeps a view stack per
 * tab so animations and back navigation behave like native apps.
 */

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: HomePage,
    meta: { requiresAuth: true },
  },
  {
    path: '/scripts/:id',
    name: 'script-detail',
    component: () => import('@/views/ScriptDetailPage.vue'),
    props: true,
    meta: { requiresAuth: true },
  },
  {
    path: '/scripts/:id/rehearse',
    name: 'rehearsal',
    component: () => import('@/views/RehearsalPage.vue'),
    props: true,
    meta: { requiresAuth: true },
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginPage.vue'),
  },
  {
    // Catch-all: keep the app inside the router.
    path: '/:pathMatch(.*)*',
    redirect: { name: 'home' },
  },
];

/**
 * NOTE: the web build uses history mode. If a Capacitor platform ever serves
 * the bundle from a `file://` origin (where path routing breaks), swap
 * `createWebHistory` for `createWebHashHistory` — it is imported above for that
 * reason.
 */
export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

/**
 * Auth guard.
 *
 * A reload arrives with a token in storage but no user yet, so the guard waits
 * for `restoreSession()` before deciding — otherwise every refresh would bounce
 * the actor to the sign-in screen.
 */
router.beforeEach(async (to) => {
  const auth = useAuthStore();

  if (auth.token !== null && auth.user === null) {
    await auth.restoreSession();
  }

  if (to.meta.requiresAuth === true && !auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }

  // Nothing to do on the sign-in page when already signed in.
  if (to.name === 'login' && auth.isAuthenticated) {
    return { name: 'home' };
  }

  return true;
});

export { createWebHashHistory };
