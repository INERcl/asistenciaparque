import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

// Tipado del scope del service worker + inyección de manifest de precache que
// hace @serwist/next en build (self.__SW_MANIFEST).
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: false, // conservador: no activar sobre técnicos con jornada offline (STACK.md §5)
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
  // Sin red y sin runtime cache, cualquier navegación cae al "/" precacheado
  // (app de una sola página): la PWA abre offline en vez del error del browser.
  fallbacks: {
    entries: [
      {
        url: "/",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

serwist.addEventListeners();
