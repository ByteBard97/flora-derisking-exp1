import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
(window as any).__APP_START__ = performance.now();
const app = createApp(App);
app.use(createPinia());
app.mount('#app');
