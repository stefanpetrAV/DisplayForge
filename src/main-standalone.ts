import { createApp } from "vue";
import "./styles.css";
import App from "./App.vue";
import { createStore } from "./state/store";

createApp(App, { mode: "standalone", store: createStore("standalone") }).mount("#app");
