/* Service worker do "Vai ter federal, sim!" — cuida das notificações push
   quando o app não está aberto na tela, e deixa o site instalável.
   Versão 20261016a: clicar na notificação abre a página oficial do aviso
   (site da UFC/IFCE); sem link, abre o app. */

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

// Endereço do app (a pasta onde este arquivo está), ex.: .../vaiterfederal-app/
const RAIZ = new URL("./", self.location.href).href;

// Endereço que o clique vai abrir. Aceita o site oficial (http/https) porque
// quem manda o aviso é o nosso robô; qualquer outra coisa cai no app.
function alvoDoAviso(url) {
  try {
    const u = new URL(url || RAIZ, RAIZ);
    return /^https?:$/.test(u.protocol) ? u.href : RAIZ;
  } catch {
    return RAIZ;
  }
}

function ehDoApp(url) {
  return String(url || "").startsWith(RAIZ);
}

messaging.onBackgroundMessage((payload) => {
  // Mensagens com "notification" o próprio Firebase já mostra; aqui só as de dados.
  if (payload.notification) return;
  const d = payload.data || {};
  return self.registration.showNotification(d.titulo || "Vai ter federal, sim!", {
    body: d.corpo || "",
    icon: "icon-192.png",
    badge: "badge-96.png",
    tag: d.tag || undefined,
    data: { url: alvoDoAviso(d.url), urlApp: alvoDoAviso(d.urlApp || RAIZ) },
  });
});

// Clique na notificação: foca o app se já estiver aberto (e troca de aba),
// senão abre uma janela nova já na aba certa.
self.addEventListener("notificationclick", (event) => {
  const n = event.notification;
  // As que o próprio Firebase mostrou guardam o link em FCM_MSG.
  const fcm = n.data && n.data.FCM_MSG;
  const alvo = alvoDoAviso((n.data && n.data.url) || (fcm && (fcm.data?.url || fcm.notification?.click_action)));
  n.close();
  event.stopImmediatePropagation();
  event.waitUntil((async () => {
    // Link do site oficial: abre direto, sem passar pelo app.
    if (!ehDoApp(alvo)) {
      await clients.openWindow(alvo);
      return;
    }
    const janelas = await clients.matchAll({ type: "window", includeUncontrolled: true });
    const doApp = janelas.find((c) => c.url.startsWith(RAIZ));
    if (doApp) {
      await doApp.focus();
      doApp.postMessage({ tipo: "abrir-notificacao", url: alvo });
      return;
    }
    await clients.openWindow(alvo);
  })());
});

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(clients.claim()));

// Presença mínima de um handler de fetch: alguns navegadores só oferecem
// "adicionar à tela inicial" se o service worker responder por requisições.
self.addEventListener("fetch", () => {});
