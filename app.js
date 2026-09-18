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
  limit,
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
auth.languageCode = "pt"; // força o e-mail de confirmação a vir em português
const db = getFirestore(app);
const PROCESSO_ID = "principal";

// ---------------------------------------------------------------------------
// Navegação entre telas (login/cadastro/app) e, dentro do app, entre páginas
// (feed/prazos/inscrição/config). Tudo via classe CSS (nunca via "hidden"),
// pra nunca mais acontecer de duas telas ficarem visíveis ao mesmo tempo.
// ---------------------------------------------------------------------------
const TELAS = ["carregando", "login", "cadastro", "verificar-email", "app"];

function mostrarTela(nome) {
  TELAS.forEach((t) => {
    const el = document.getElementById("tela-" + t);
    if (el) el.classList.toggle("oculto", t !== nome);
  });
  window.scrollTo(0, 0);
}

const PAGINAS = ["feed", "prazos", "inscricao", "config"];

function mostrarPagina(nome) {
  PAGINAS.forEach((p) => {
    const pag = document.getElementById("pagina-" + p);
    if (pag) pag.classList.toggle("ativa", p === nome);
    const navBtn = document.getElementById("nav-" + p);
    if (navBtn) navBtn.classList.toggle("nav-ativo", p === nome);
  });
  window.scrollTo(0, 0);
  if (nome === "inscricao") carregarInscricao();
  if (nome === "config") carregarConfig();
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
    if (pararDeOuvirPrazos) { pararDeOuvirPrazos(); pararDeOuvirPrazos = null; }
    if (pararDeOuvirConfirmacoes) { pararDeOuvirConfirmacoes(); pararDeOuvirConfirmacoes = null; }
    if (pararDeOuvirFeed) { pararDeOuvirFeed(); pararDeOuvirFeed = null; }
    mostrarTela("login");
    return;
  }
  await reload(user);
  if (!user.emailVerified) {
    document.getElementById("verificar-email-endereco").textContent = user.email;
    mostrarTela("verificar-email");
    return;
  }
  await garantirPerfil(user);
  registrarPush(user); // não bloqueia a navegação se o push falhar
  entrarNoApp();
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

document.getElementById("btn-ir-cadastro").addEventListener("click", () => mostrarTela("cadastro"));
document.getElementById("btn-ir-login").addEventListener("click", () => mostrarTela("login"));

document.getElementById("btn-ja-confirmei").addEventListener("click", async () => {
  const user = auth.currentUser;
  if (!user) return;
  await reload(user);
  if (user.emailVerified) {
    await garantirPerfil(user);
    registrarPush(user);
    entrarNoApp();
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
// Entrar no app: liga a navegação lateral e os "escutadores" do Firestore
// ---------------------------------------------------------------------------
let pararDeOuvirPrazos = null;
let pararDeOuvirConfirmacoes = null;
let pararDeOuvirFeed = null;
let navegacaoConfigurada = false;
let chipsConfigurados = false;
let chipsPrazosConfigurados = false;

function entrarNoApp() {
  mostrarTela("app");
  ouvirPrazos();
  ouvirConfirmacoes();
  ouvirFeed();
  mostrarPagina("feed");

  if (!navegacaoConfigurada) {
    navegacaoConfigurada = true;
    PAGINAS.forEach((p) => {
      const btn = document.getElementById("nav-" + p);
      if (btn) btn.addEventListener("click", () => mostrarPagina(p));
    });
  }
}

// ---------------------------------------------------------------------------
// Feed: últimas notícias e páginas monitoradas da UFC e do IFCE
// ---------------------------------------------------------------------------
let filtroFeedAtual = "todos";
let ultimosItensFeed = [];

function formatarDataHora(ts) {
  const data = ts?.toDate ? ts.toDate() : null;
  if (!data) return "";
  return data.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function ehRecente(ts) {
  const data = ts?.toDate ? ts.toDate() : null;
  if (!data) return false;
  return Date.now() - data.getTime() < 24 * 60 * 60 * 1000;
}

function nomeArquivoDeUrl(url) {
  try {
    return decodeURIComponent(url.split("/").pop().split("?")[0]);
  } catch {
    return url;
  }
}

function renderizarFeed() {
  const lista = document.getElementById("feed-lista");
  const itens =
    filtroFeedAtual === "todos" ?
      ultimosItensFeed :
      ultimosItensFeed.filter((it) => it.fonte === filtroFeedAtual);

  lista.innerHTML = "";
  if (itens.length === 0) {
    lista.innerHTML =
      '<p class="vazio">Nada por aqui ainda. Assim que o robô encontrar novidades na UFC ou no IFCE, elas aparecem aqui.</p>';
    return;
  }

  itens.forEach((item) => {
    const marcadorNovo = ehRecente(item.mudouEm) || ehRecente(item.novoEm);
    const imagens = Array.isArray(item.imagens) ? item.imagens : [];
    const anexos = Array.isArray(item.anexos) ? item.anexos : [];
    const dataExibida = formatarDataHora(item.mudouEm || item.novoEm || item.atualizadoEm);
    const corpoLongo = (item.corpo || "").length > 320;

    const cartao = document.createElement("article");
    cartao.className = "cartao-noticia";
    cartao.innerHTML = `
      <div class="cartao-topo-noticia">
        <span class="etiqueta etiqueta-fonte-${escapeHtml(item.fonte || "")}">${escapeHtml(item.fonte || "")}</span>
        <span class="etiqueta">${item.categoria === "noticia" ? "Notícia" : "Documento"}</span>
        ${marcadorNovo ? '<span class="etiqueta etiqueta-novo">Atualizado</span>' : ""}
      </div>
      <h3>${escapeHtml(item.titulo || "Sem título")}</h3>
      ${
        imagens[0]
          ? `<div class="cartao-imagem"><img src="${escapeHtml(imagens[0])}" alt="" loading="lazy" /></div>`
          : ""
      }
      <div class="cartao-corpo ${corpoLongo ? "recolhido" : ""}">${escapeHtml(item.corpo || "")}</div>
      ${corpoLongo ? '<button class="botao-ver-mais" type="button">Ver mais</button>' : ""}
      ${
        anexos.length > 0
          ? `<ul class="lista-anexos">${anexos
              .map((a) => `<li>📎 <a href="${escapeHtml(a)}" target="_blank" rel="noopener">${escapeHtml(nomeArquivoDeUrl(a))}</a></li>`)
              .join("")}</ul>`
          : ""
      }
      <div class="cartao-rodape">
        <span class="cartao-data">${escapeHtml(dataExibida || item.publicadoEmTexto || "")}</span>
        ${item.link ? `<a href="${escapeHtml(item.link)}" target="_blank" rel="noopener">Ver publicação original →</a>` : ""}
      </div>
    `;

    const botaoVerMais = cartao.querySelector(".botao-ver-mais");
    if (botaoVerMais) {
      botaoVerMais.addEventListener("click", () => {
        const corpo = cartao.querySelector(".cartao-corpo");
        const recolhido = corpo.classList.toggle("recolhido");
        botaoVerMais.textContent = recolhido ? "Ver mais" : "Ver menos";
      });
      // Começa mostrando fechado; clique alterna. Ajusta o texto certo já de saída.
      botaoVerMais.textContent = "Ver mais";
    }

    lista.appendChild(cartao);
  });
}

function ouvirFeed() {
  if (pararDeOuvirFeed) pararDeOuvirFeed();
  const q = query(collection(db, "noticias"), orderBy("atualizadoEm", "desc"), limit(60));
  pararDeOuvirFeed = onSnapshot(q, (snap) => {
    ultimosItensFeed = snap.docs.map((d) => d.data());
    renderizarFeed();
  });

  if (!chipsConfigurados) {
    chipsConfigurados = true;
    document.querySelectorAll("#pagina-feed .chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        document.querySelectorAll("#pagina-feed .chip").forEach((c) => c.classList.remove("chip-ativo"));
        chip.classList.add("chip-ativo");
        filtroFeedAtual = chip.dataset.filtro;
        renderizarFeed();
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Prazos — a lista é global (tudo que aparece no calendário da UFC e do IFCE,
// mesmo o que não é do seu processo). O que é seu: a marcação de "já
// providenciei isso", guardada em usuarios/{uid}/confirmacoes.
// ---------------------------------------------------------------------------
let todosOsPrazos = [];
let prazosConfirmados = new Set();
let filtroPrazoAtual = "proximos";

const UM_DIA = 24 * 60 * 60 * 1000;

function inicioDoDia(data) {
  const d = new Date(data);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function situacaoDoPrazo(quando) {
  const hoje = inicioDoDia(new Date());
  const dia = inicioDoDia(quando);
  const dias = Math.round((dia - hoje) / UM_DIA);
  if (dias < 0) return { estado: "passou", dias, texto: dias === -1 ? "Foi ontem" : `Passou há ${Math.abs(dias)} dias` };
  if (dias === 0) return { estado: "hoje", dias, texto: "É hoje" };
  if (dias === 1) return { estado: "perto", dias, texto: "É amanhã" };
  if (dias <= 15) return { estado: "perto", dias, texto: `Faltam ${dias} dias` };
  return { estado: "longe", dias, texto: `Faltam ${dias} dias` };
}

function renderizarPrazos() {
  const lista = document.getElementById("lista-eventos");
  if (!lista) return;

  const hoje = inicioDoDia(new Date());
  let itens = todosOsPrazos.filter((p) => p.quando);

  if (filtroPrazoAtual === "proximos") {
    itens = itens.filter((p) => inicioDoDia(p.quando) >= hoje).sort((a, b) => a.quando - b.quando);
  } else if (filtroPrazoAtual === "passados") {
    itens = itens.filter((p) => inicioDoDia(p.quando) < hoje).sort((a, b) => b.quando - a.quando);
  } else {
    itens = itens.sort((a, b) => a.quando - b.quando);
  }

  lista.innerHTML = "";
  if (itens.length === 0) {
    lista.innerHTML =
      '<p class="vazio">Nada aqui ainda. O robô lê as páginas da UFC e do IFCE de hora em hora e coloca nesta lista toda data que encontrar — chamada regular, lista de espera, suplentes, matrícula e documentação.</p>';
    return;
  }

  itens.forEach((p) => {
    const sit = situacaoDoPrazo(p.quando);
    const novo = p.criadoEm?.toDate && Date.now() - p.criadoEm.toDate().getTime() < 2 * UM_DIA;
    const confirmado = prazosConfirmados.has(p.id);
    const dataFormatada = p.quando.toLocaleDateString("pt-BR", { timeZone: "UTC" });

    const cartao = document.createElement("article");
    cartao.className = "cartao-evento";
    cartao.innerHTML = `
      <div class="cartao-topo-noticia">
        <span class="etiqueta etiqueta-fonte-${escapeHtml(p.fonte || "")}">${escapeHtml(p.fonte || "")}</span>
        <span class="etiqueta">${escapeHtml(p.categoria || "Calendário")}</span>
        <span class="etiqueta etiqueta-${sit.estado}">${escapeHtml(sit.texto)}</span>
        ${novo ? '<span class="etiqueta etiqueta-novo">Novo</span>' : ""}
      </div>
      <div class="cartao-topo"><strong>${escapeHtml(dataFormatada)}</strong></div>
      <div class="cartao-corpo">${escapeHtml(p.descricao || "")}</div>
      <div class="cartao-rodape">
        <span class="cartao-data">${escapeHtml(p.fonteTitulo || "")}</span>
        ${p.link ? `<a href="${escapeHtml(p.link)}" target="_blank" rel="noopener">Ver página →</a>` : ""}
      </div>
      ${
        confirmado
          ? '<div class="confirmado">✓ Você marcou como providenciado</div>'
          : `<button class="botao-secundario botao-confirmar" data-id="${escapeHtml(p.id)}">Já providenciei isso</button>`
      }
    `;
    lista.appendChild(cartao);
  });

  lista.querySelectorAll(".botao-confirmar").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const u = auth.currentUser;
      if (!u) return;
      btn.disabled = true;
      await setDoc(doc(db, "usuarios", u.uid, "confirmacoes", btn.dataset.id), {
        confirmadoEm: serverTimestamp(),
      });
    });
  });
}

function ouvirPrazos() {
  if (pararDeOuvirPrazos) pararDeOuvirPrazos();
  const q = query(collection(db, "prazos"), orderBy("data", "asc"), limit(400));
  pararDeOuvirPrazos = onSnapshot(q, (snap) => {
    todosOsPrazos = snap.docs.map((d) => {
      const dados = d.data();
      return { id: d.id, ...dados, quando: dados.data?.toDate ? dados.data.toDate() : null };
    });
    renderizarPrazos();
  });

  if (!chipsPrazosConfigurados) {
    chipsPrazosConfigurados = true;
    document.querySelectorAll(".chip-prazo").forEach((chip) => {
      chip.addEventListener("click", () => {
        document.querySelectorAll(".chip-prazo").forEach((c) => c.classList.remove("chip-ativo"));
        chip.classList.add("chip-ativo");
        filtroPrazoAtual = chip.dataset.prazoFiltro;
        renderizarPrazos();
      });
    });
  }
}

function ouvirConfirmacoes() {
  const user = auth.currentUser;
  if (!user) return;
  if (pararDeOuvirConfirmacoes) pararDeOuvirConfirmacoes();
  pararDeOuvirConfirmacoes = onSnapshot(
    collection(db, "usuarios", user.uid, "confirmacoes"),
    (snap) => {
      prazosConfirmados = new Set(snap.docs.map((d) => d.id));
      renderizarPrazos();
    }
  );
}

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
