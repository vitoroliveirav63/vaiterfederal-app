/* Service worker do "Vai ter federal, sim!" — cuida das notificações push
   quando o app não está aberto na tela, e deixa o site instalável. */

importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDuG755MrvWbhSRPaPtSuVM_K8QNNkopHU",
  authDomain: "vai-ter-federal-sim.firebaseapp.com",
  projectId: "vai-ter-federal-sim",
  storageBucket: "vai-ter-federal-sim.firebasestorage.app",
  messagingSenderId: "332108710289",
  appId: "1:332108710289:web:89f5ce2681c8e8f4015a30",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const titulo = payload.notification?.title || "Vai ter federal, sim!";
  const corpo = payload.notification?.body || "";
  self.registration.showNotification(titulo, {
    body: corpo,
    icon: "icon-192.png",
  });
});

// Presença mínima de um handler de fetch: alguns navegadores só oferecem
// "adicionar à tela inicial" se o service worker responder por requisições.
self.addEventListener("fetch", () => {});
