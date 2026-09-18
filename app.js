import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  onAuthStateChanged,
  signOut,
  reload,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import {
  getMessaging,
  getToken,
  isSupported,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging.js";

const firebaseConfig = {
  apiKey: "AIzaSyDuG755MrvWbhSRPaPtSuVM_K8QNNkopHU",
  authDomain: "vai-ter-federal-sim.firebaseapp.com",
  projectId: "vai-ter-federal-sim",
  storageBucket: "vai-ter-federal-sim.firebasestorage.app",
  messagingSenderId: "332108710289",
  appId: "1:332108710289:web:89f5ce2681c8e8f4015a30",
  measurementId: "G-LT8YYTEQDY",
};
const VAPID_KEY =
  "BGHMUlmyuhUqOIPajywOZBX-ZfwSRwObp_GGt7lVgo4-RYWsr2RcdQMeIwtVaZxOm18-mp3FhQlycfja42SpvKQ";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const PROCESSO_ID = "principal";

// ---------------------------------------------------------------------------
// Navegação entre telas
// ---------------------------------------------------------------------------
const VIEWS = ["carregando", "login", "cadastro", "verificar-email", "home", "inscricao", "config"];

function showView(nome) {
  VIEWS.forEach((v) => {
    const el = document.getElementById("view-" + v);
    if (el) el.hidden = v !== nome;
  });
  window.scrollTo(0, 0);
}

function showMsg(id, texto) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = texto;
  el.hidden = !texto;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// ---------------------------------------------------------------------------
// Estado de autenticação
// ---------------------------------------------------------------------------
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    showView("login");
    return;
  }
  await reload(user);
  if (!user.emailVerified) {
    document.getElementById("verificar-email-endereco").textContent = user.email;
    showView("verificar-email");
    return;
  }
  await garantirPerfil(user);
  registrarPush(user); // não bloqueia a navegação se o push falhar
  irParaHome();
});

async function garantirPerfil(user) {
  const ref = doc(db, "usuarios", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      email: user.email,
      criadoEm: serverTimestamp(),
      preferenciasNotificacao: {
        push: true,
        email: true,
        alertaUrgente: true,
        antecedenciaDias: [5, 2],
      },
    });
  }
}

function traduzErro(err) {
  const mapa = {
    "auth/email-already-in-use": "Esse e-mail já tem uma conta cadastrada.",
    "auth/invalid-email": "Esse e-mail não parece válido.",
    "auth/weak-password": "A senha precisa ter pelo menos 6 caracteres.",
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/wrong-password": "E-mail ou senha incorretos.",
    "auth/user-not-found": "E-mail ou senha incorretos.",
    "auth/too-many-requests": "Muitas tentativas seguidas. Espere um pouco e tente de novo.",
  };
  return mapa[err.code] || "Algo deu errado. Tente de novo em instantes.";
}

// ---------------------------------------------------------------------------
// Cadastro / login / verificação de e-mail
// ---------------------------------------------------------------------------
document.getElementById("form-cadastro").addEventListener("submit", async (e) => {
  e.preventDefault();
  showMsg("erro-cadastro", "");
  const email = document.getElementById("cadastro-email").value.trim();
  const senha = document.getElementById("cadastro-senha").value;
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, senha);
    await sendEmailVerification(cred.user);
    await garantirPerfil(cred.user);
  } catch (err) {
    showMsg("erro-cadastro", traduzErro(err));
  }
});

document.getElementById("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  showMsg("erro-login", "");
  const email = document.getElementById("login-email").value.trim();
  const senha = document.getElementById("login-senha").value;
  try {
    await signInWithEmailAndPassword(auth, email, senha);
  } catch (err) {
    showMsg("erro-login", traduzErro(err));
  }
});

document.getElementById("btn-ir-cadastro").addEventListener("click", () => showView("cadastro"));
document.getElementById("btn-ir-login").addEventListener("click", () => showView("login"));

document.getElementById("btn-ja-confirmei").addEventListener("click", async () => {
  const user = auth.currentUser;
  if (!user) return;
  await reload(user);
  if (user.emailVerified) {
    await garantirPerfil(user);
    registrarPush(user);
    irParaHome();
  } else {
    showMsg("erro-verificar", "Ainda não chegou a confirmação. Clique no link do e-mail e tente de novo.");
  }
});

document.getElementById("btn-reenviar-email").addEventListener("click", async () => {
  const user = auth.currentUser;
  if (!user) return;
  await sendEmailVerification(user);
  showMsg("erro-verificar", "E-mail de confirmação reenviado.");
});

document.getElementById("btn-logout").addEventListener("click", () => signOut(auth));
document.getElementById("btn-logout-config").addEventListener("click", () => signOut(auth));

// ---------------------------------------------------------------------------
// Tela inicial: lista de prazos/eventos
// ---------------------------------------------------------------------------
let pararDeOuvirEventos = null;

function irParaHome() {
  showView("home");
  const user = auth.currentUser;
  if (!user) return;
  if (pararDeOuvirEventos) pararDeOuvirEventos();

  const q = query(collection(db, "usuarios", user.uid, "eventos"), orderBy("dataPrevista", "asc"));
  pararDeOuvirEventos = onSnapshot(q, (snap) => {
    const lista = document.getElementById("lista-eventos");
    lista.innerHTML = "";
    if (snap.empty) {
      lista.innerHTML =
        '<p class="vazio">Nenhum prazo cadastrado ainda. O robô adiciona os prazos automaticamente conforme o calendário do Sisu/UFC.</p>';
      return;
    }
    snap.forEach((docSnap) => {
      const ev = docSnap.data();
      const data = ev.dataPrevista?.toDate ? ev.dataPrevista.toDate() : null;
      const cartao = document.createElement("div");
      cartao.className = "cartao-evento";
      cartao.innerHTML = `
        <div class="cartao-topo">
          <strong>${escapeHtml(ev.titulo || "Prazo")}</strong>
          <span class="etiqueta">${escapeHtml(ev.tipo || "")}</span>
        </div>
        <div class="cartao-data">${data ? data.toLocaleDateString("pt-BR") : "Data a definir"}</div>
        ${
          ev.confirmado
            ? '<div class="confirmado">✓ Você já confirmou</div>'
            : `<button class="botao-secundario botao-confirmar" data-id="${docSnap.id}">Já providenciei isso</button>`
        }
      `;
      lista.appendChild(cartao);
    });
    lista.querySelectorAll(".botao-confirmar").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const u = auth.currentUser;
        if (!u) return;
        btn.disabled = true;
        await updateDoc(doc(db, "usuarios", u.uid, "eventos", btn.dataset.id), { confirmado: true });
      });
    });
  });
}

document.getElementById("btn-ir-inscricao").addEventListener("click", () => {
  carregarInscricao();
  showView("inscricao");
});
document.getElementById("btn-ir-config").addEventListener("click", () => {
  carregarConfig();
  showView("config");
});
document.getElementById("btn-voltar-home-1").addEventListener("click", irParaHome);
document.getElementById("btn-voltar-home-2").addEventListener("click", irParaHome);

// ---------------------------------------------------------------------------
// Inscrição Enem/Sisu (edição manual)
// ---------------------------------------------------------------------------
function formatarDataInput(ts) {
  if (!ts?.toDate) return "";
  return ts.toDate().toISOString().slice(0, 10);
}

function paraData(valorInput) {
  if (!valorInput) return null;
  return new Date(valorInput + "T12:00:00");
}

async function carregarInscricao() {
  const user = auth.currentUser;
  if (!user) return;
  const ref = doc(db, "usuarios", user.uid, "processos", PROCESSO_ID);
  const snap = await getDoc(ref);
  const d = snap.exists() ? snap.data() : {};
  document.getElementById("insc-enem-inscricao").value = d.numeroInscricaoEnem || "";
  document.getElementById("insc-enem-local").value = d.localProva || "";
  document.getElementById("insc-enem-dia1").value = formatarDataInput(d.dataProva1);
  document.getElementById("insc-enem-dia2").value = formatarDataInput(d.dataProva2);
  document.getElementById("insc-sisu-curso").value = d.cursoPretendido || "";
  document.getElementById("insc-sisu-turno").value = d.turno || "";
  document.getElementById("insc-sisu-inscricao").value = d.numeroInscricaoSisu || "";
  document.getElementById("insc-sisu-status").value = d.statusGeral || "classificado";
  document.getElementById("insc-sisu-posicao").value =
    d.posicaoAtualListaEspera === undefined || d.posicaoAtualListaEspera === null
      ? ""
      : d.posicaoAtualListaEspera;
}

document.getElementById("form-inscricao").addEventListener("submit", async (e) => {
  e.preventDefault();
  const user = auth.currentUser;
  if (!user) return;

  const ref = doc(db, "usuarios", user.uid, "processos", PROCESSO_ID);
  const snapAntes = await getDoc(ref);
  const antes = snapAntes.exists() ? snapAntes.data() : {};

  const posicaoStr = document.getElementById("insc-sisu-posicao").value;
  const novaPosicao = posicaoStr === "" ? null : Number(posicaoStr);

  const dados = {
    numeroInscricaoEnem: document.getElementById("insc-enem-inscricao").value.trim(),
    localProva: document.getElementById("insc-enem-local").value.trim(),
    dataProva1: paraData(document.getElementById("insc-enem-dia1").value),
    dataProva2: paraData(document.getElementById("insc-enem-dia2").value),
    cursoPretendido: document.getElementById("insc-sisu-curso").value.trim(),
    turno: document.getElementById("insc-sisu-turno").value.trim(),
    numeroInscricaoSisu: document.getElementById("insc-sisu-inscricao").value.trim(),
    statusGeral: document.getElementById("insc-sisu-status").value,
    posicaoAtualListaEspera: novaPosicao,
    atualizadoEm: serverTimestamp(),
  };

  await setDoc(ref, dados, { merge: true });

  const posicaoMudou =
    typeof antes.posicaoAtualListaEspera === "number" &&
    novaPosicao !== null &&
    antes.posicaoAtualListaEspera !== novaPosicao;

  if (posicaoMudou) {
    await addDoc(collection(ref, "historicoPosicao"), {
      data: serverTimestamp(),
      posicao: novaPosicao,
      variacao: novaPosicao - antes.posicaoAtualListaEspera,
    });
    await addDoc(collection(db, "usuarios", user.uid, "notificacoes"), {
      tipo: "posicao_atualizada",
      titulo: "Posição atualizada",
      corpo: `Sua posição na lista de espera mudou de ${antes.posicaoAtualListaEspera} para ${novaPosicao}.`,
      criadoEm: serverTimestamp(),
      confirmada: false,
    });
  }

  showMsg("msg-inscricao-salva", "Salvo!");
  setTimeout(() => showMsg("msg-inscricao-salva", ""), 3000);
});

// ---------------------------------------------------------------------------
// Configurações
// ---------------------------------------------------------------------------
async function carregarConfig() {
  const user = auth.currentUser;
  if (!user) return;
  document.getElementById("config-email").textContent = user.email;
  const snap = await getDoc(doc(db, "usuarios", user.uid));
  const prefs = snap.data()?.preferenciasNotificacao || {};
  document.getElementById("config-push").checked = prefs.push !== false;
  document.getElementById("config-email-toggle").checked = prefs.email !== false;
  document.getElementById("config-urgente").checked = prefs.alertaUrgente !== false;
}

document.getElementById("form-config").addEventListener("submit", async (e) => {
  e.preventDefault();
  const user = auth.currentUser;
  if (!user) return;
  await updateDoc(doc(db, "usuarios", user.uid), {
    preferenciasNotificacao: {
      push: document.getElementById("config-push").checked,
      email: document.getElementById("config-email-toggle").checked,
      alertaUrgente: document.getElementById("config-urgente").checked,
      antecedenciaDias: [5, 2],
    },
  });
  showMsg("msg-config-salvo", "Preferências salvas!");
  setTimeout(() => showMsg("msg-config-salvo", ""), 3000);
});

// ---------------------------------------------------------------------------
// Notificações push (Web)
// ---------------------------------------------------------------------------
async function registrarPush(user) {
  try {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) return;
    const suportado = await isSupported().catch(() => false);
    if (!suportado) return;

    const registration = await navigator.serviceWorker.register("firebase-messaging-sw.js");
    const permissao = await Notification.requestPermission();
    if (permissao !== "granted") return;

    const messaging = getMessaging(app);
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
    if (token) {
      await setDoc(doc(db, "usuarios", user.uid, "fcmTokens", token), {
        criadoEm: serverTimestamp(),
      });
    }
  } catch (err) {
    console.warn("Push não disponível neste navegador:", err);
  }
}
