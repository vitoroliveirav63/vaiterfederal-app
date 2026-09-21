import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
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
  deleteDoc,
  collection,
  query,
  orderBy,
  limit,
  where,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import {
  getMessaging,
  getToken,
  isSupported,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging.js";
import { lerPdfDoEnem } from "./leitor-pdf.js?v=20260922b";
import * as DICAS from "./dicas-enem.js?v=20260922b";

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

// ---------------------------------------------------------------------------
// Atualização automática: o navegador guarda os arquivos do app por um tempo
// e pode continuar mostrando a versão velha depois de um upload. Aqui o app
// busca o index.html mais novo (sem cache) e, se a versão do app.js citada
// lá for outra, recarrega sozinho uma vez.
// ---------------------------------------------------------------------------
const VERSAO_CARREGADA = new URL(import.meta.url).searchParams.get("v") || "";
async function conferirVersao() {
  try {
    const html = await (await fetch("./index.html?nocache=" + Date.now(), { cache: "no-store" })).text();
    const nova = (html.match(/app\.js\?v=([\w.-]+)/) || [])[1];
    if (!nova || nova === VERSAO_CARREGADA) return;
    const chave = "recarregouPara:" + nova;
    if (sessionStorage.getItem(chave)) return; // já tentou, não entra em laço
    sessionStorage.setItem(chave, "1");
    location.reload();
  } catch {
    /* sem internet ou sem sessionStorage: segue com o que tem */
  }
}
conferirVersao();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") conferirVersao();
});

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
auth.languageCode = "pt"; // e-mails de confirmação e de troca de senha em português
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Navegação — telas (login/cadastro/app) e, dentro do app, páginas.
// Tudo via classe CSS, pra nunca ficarem duas telas visíveis ao mesmo tempo.
// ---------------------------------------------------------------------------
const TELAS = ["carregando", "login", "cadastro", "verificar-email", "app"];
const PAGINAS = ["feed", "prazos", "inscricao", "config", "perfil"];
const TITULOS = { feed: "Feed", prazos: "Prazos", inscricao: "Inscrição", config: "Ajustes", perfil: "Perfil" };

function mostrarTela(nome) {
  TELAS.forEach((t) => {
    const el = $("tela-" + t);
    if (el) el.classList.toggle("oculto", t !== nome);
  });
  window.scrollTo(0, 0);
}

function mostrarPagina(nome) {
  PAGINAS.forEach((p) => {
    const pag = $("pagina-" + p);
    if (pag) pag.classList.toggle("ativa", p === nome);
    const navBtn = $("nav-" + p);
    if (navBtn) navBtn.classList.toggle("nav-ativo", p === nome);
  });
  document.title = `${TITULOS[nome] || "Início"} · Vai ter federal, sim!`;
  fecharMenuPerfil();
  window.scrollTo(0, 0);
  if (nome === "config") carregarConfig();
  if (nome === "inscricao") mostrarSubaba(subabaAtual || (todasInscricoes.length ? "acompanhamento" : "cadastro"));
}

function showMsg(id, texto) {
  const el = $(id);
  if (!el) return;
  el.textContent = texto;
  el.hidden = !texto;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// Formato fixo pra tabela alinhar: provas objetivas com 1 casa, redação
// inteira, média com 2 casas (como o Sisu mostra).
function fmtFixo(n, casas) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}
function fmtProva(chave, n) {
  return fmtFixo(n, chave === "redacao" ? 0 : 1);
}
function fmtMedia(n) {
  return fmtFixo(n, 2);
}

function fmtDelta(n) {
  const sinal = n > 0 ? "+" : n < 0 ? "−" : "±";
  return sinal + Math.abs(n).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

function isoParaBr(iso) {
  if (!iso) return "";
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

// ---------------------------------------------------------------------------
// Estado de autenticação
// ---------------------------------------------------------------------------
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    pararTodosOsEscutadores();
    mostrarTela("login");
    return;
  }
  await reload(user);
  if (!user.emailVerified) {
    $("verificar-email-endereco").textContent = user.email;
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
      preferenciasNotificacao: { push: true, email: true, alertaUrgente: true, antecedenciaDias: [5, 2] },
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
$("form-cadastro").addEventListener("submit", async (e) => {
  e.preventDefault();
  showMsg("erro-cadastro", "");
  try {
    const cred = await createUserWithEmailAndPassword(auth, $("cadastro-email").value.trim(), $("cadastro-senha").value);
    await sendEmailVerification(cred.user);
    await garantirPerfil(cred.user);
  } catch (err) {
    showMsg("erro-cadastro", traduzErro(err));
  }
});

$("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  showMsg("erro-login", "");
  try {
    await signInWithEmailAndPassword(auth, $("login-email").value.trim(), $("login-senha").value);
  } catch (err) {
    showMsg("erro-login", traduzErro(err));
  }
});

$("btn-ir-cadastro").addEventListener("click", () => mostrarTela("cadastro"));
$("btn-ir-login").addEventListener("click", () => mostrarTela("login"));

$("btn-ja-confirmei").addEventListener("click", async () => {
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

$("btn-reenviar-email").addEventListener("click", async () => {
  const user = auth.currentUser;
  if (!user) return;
  await sendEmailVerification(user);
  showMsg("erro-verificar", "E-mail de confirmação reenviado.");
});

$("btn-logout").addEventListener("click", () => signOut(auth));
$("btn-logout-config").addEventListener("click", () => signOut(auth));

// ---------------------------------------------------------------------------
// Menu do perfil (avatar no canto superior)
// ---------------------------------------------------------------------------
function abrirMenuPerfil() {
  $("menu-perfil").classList.remove("oculto");
  $("btn-avatar").setAttribute("aria-expanded", "true");
}
function fecharMenuPerfil() {
  $("menu-perfil").classList.add("oculto");
  $("btn-avatar").setAttribute("aria-expanded", "false");
}
$("btn-avatar").addEventListener("click", (e) => {
  e.stopPropagation();
  if ($("menu-perfil").classList.contains("oculto")) abrirMenuPerfil();
  else fecharMenuPerfil();
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".menu-perfil")) fecharMenuPerfil();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") fecharMenuPerfil();
});
$("menu-ver-perfil").addEventListener("click", () => {
  mostrarPagina("perfil");
  modoPerfil("ver");
});
$("menu-editar-perfil").addEventListener("click", () => {
  mostrarPagina("perfil");
  modoPerfil("editar");
});

// ---------------------------------------------------------------------------
// Entrar no app: liga os "escutadores" do Firestore
// ---------------------------------------------------------------------------
const escutadores = {};
let navegacaoConfigurada = false;

function pararTodosOsEscutadores() {
  for (const chave of Object.keys(escutadores)) {
    if (escutadores[chave]) escutadores[chave]();
    escutadores[chave] = null;
  }
  todasInscricoes = [];
  todosOsPrazos = [];
  prazosConfirmados = new Set();
  perfilAtual = {};
  subabaAtual = null;
}

function escutar(chave, alvo, callback) {
  if (escutadores[chave]) escutadores[chave]();
  escutadores[chave] = onSnapshot(alvo, callback, (erro) => console.warn(`Falha ao ouvir ${chave}:`, erro));
}

function entrarNoApp() {
  const user = auth.currentUser;
  if (!user) return;
  mostrarTela("app");

  escutar("perfil", doc(db, "usuarios", user.uid), (snap) => {
    perfilAtual = snap.data() || {};
    atualizarIdentidade();
  });
  escutar("prazos", query(collection(db, "prazos"), where("dataLimite", ">=", new Date(Date.now() - 200 * 24 * 60 * 60 * 1000)), orderBy("dataLimite", "asc"), limit(2000)), (snap) => {
    todosOsPrazos = snap.docs.map((d) => {
      const dados = d.data();
      const quando = dados.data?.toDate ? dados.data.toDate() : null;
      const fim = dados.dataFim?.toDate ? dados.dataFim.toDate() : null;
      const limite = dados.dataLimite?.toDate ? dados.dataLimite.toDate() : fim || quando;
      return { id: d.id, ...dados, quando, fim, limite };
    });
    renderizarPrazos();
    renderizarLateral();
  });
  escutar("confirmacoes", collection(db, "usuarios", user.uid, "confirmacoes"), (snap) => {
    prazosConfirmados = new Set(snap.docs.map((d) => d.id));
    renderizarPrazos();
    renderizarLateral();
  });
  escutar("feed", query(collection(db, "noticias"), orderBy("atualizadoEm", "desc"), limit(60)), (snap) => {
    ultimosItensFeed = snap.docs.map((d) => d.data());
    renderizarFeed();
  });
  escutar("inscricoes", collection(db, "usuarios", user.uid, "inscricoes"), (snap) => {
    todasInscricoes = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.ano - a.ano);
    if (snap.empty) migrarInscricaoAntiga(user);
    renderizarAcompanhamento();
    renderizarLateral();
    renderizarDesempenho();
  });

  mostrarPagina("feed");

  if (!navegacaoConfigurada) {
    navegacaoConfigurada = true;
    ["feed", "prazos", "inscricao", "config"].forEach((p) => {
      $("nav-" + p).addEventListener("click", () => mostrarPagina(p));
    });
  }
}

// ---------------------------------------------------------------------------
// Perfil
// ---------------------------------------------------------------------------
let perfilAtual = {};

function iniciais() {
  const p = perfilAtual.perfil || {};
  const base = (p.apelido || p.nome || "").trim();
  if (base) {
    const partes = base.split(/\s+/);
    return (partes[0][0] + (partes.length > 1 ? partes[partes.length - 1][0] : "")).toUpperCase();
  }
  const email = auth.currentUser?.email || "?";
  return email[0].toUpperCase();
}

function atualizarIdentidade() {
  const user = auth.currentUser;
  const p = perfilAtual.perfil || {};
  const ini = iniciais();
  $("btn-avatar").textContent = ini;
  $("perfil-avatar").textContent = ini;
  $("menu-nome").textContent = p.apelido || p.nome || "Sua conta";
  const chamado = p.apelido || (p.nome ? p.nome.trim().split(/\s+/)[0] : "");
  $("topo-titulo").textContent = chamado ? `Olá, ${chamado}!` : "Olá!";
  $("menu-email").textContent = user?.email || "";
  renderizarPerfil();
}

function renderizarPerfil() {
  const user = auth.currentUser;
  const p = perfilAtual.perfil || {};
  $("perfil-nome-exibicao").textContent = p.nome || p.apelido || "Seu nome ainda não foi preenchido";
  $("perfil-email-exibicao").textContent = user?.email || "";

  const criado = perfilAtual.criadoEm?.toDate ? perfilAtual.criadoEm.toDate().toLocaleDateString("pt-BR") : null;
  const linhas = [
    ["Como prefere ser chamado", p.apelido],
    ["Curso atual", p.curso],
    ["Instituição", p.instituicao],
    ["Cidade", p.cidade],
    ["Conta criada em", criado],
  ];
  $("perfil-dados").innerHTML = linhas
    .map(([rotulo, valor]) => `<dt>${escapeHtml(rotulo)}</dt><dd>${valor ? escapeHtml(valor) : '<span class="texto-suave">não informado</span>'}</dd>`)
    .join("");
}

function modoPerfil(modo) {
  const editar = modo === "editar";
  $("perfil-visualizar").classList.toggle("oculto", editar);
  $("perfil-editar").classList.toggle("oculto", !editar);
  showMsg("msg-perfil", "");
  showMsg("msg-senha", "");
  if (editar) {
    const p = perfilAtual.perfil || {};
    $("perfil-nome").value = p.nome || "";
    $("perfil-apelido").value = p.apelido || "";
    $("perfil-curso").value = p.curso || "";
    $("perfil-instituicao").value = p.instituicao || "";
    $("perfil-cidade").value = p.cidade || "";
    $("perfil-email").value = auth.currentUser?.email || "";
    $("perfil-nome").focus();
  }
}

$("btn-editar-perfil").addEventListener("click", () => modoPerfil("editar"));
$("btn-cancelar-perfil").addEventListener("click", () => modoPerfil("ver"));

$("form-perfil").addEventListener("submit", async (e) => {
  e.preventDefault();
  const user = auth.currentUser;
  if (!user) return;
  await updateDoc(doc(db, "usuarios", user.uid), {
    perfil: {
      nome: $("perfil-nome").value.trim(),
      apelido: $("perfil-apelido").value.trim(),
      curso: $("perfil-curso").value.trim(),
      instituicao: $("perfil-instituicao").value.trim(),
      cidade: $("perfil-cidade").value.trim(),
    },
  });
  modoPerfil("ver");
});

$("btn-trocar-senha").addEventListener("click", async () => {
  const user = auth.currentUser;
  if (!user) return;
  try {
    await sendPasswordResetEmail(auth, user.email);
    showMsg("msg-senha", `Enviamos um link para ${user.email}. Abra o e-mail pra escolher a nova senha.`);
  } catch (err) {
    showMsg("msg-senha", traduzErro(err));
  }
});

// ---------------------------------------------------------------------------
// Feed
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
  return !!data && Date.now() - data.getTime() < 24 * 60 * 60 * 1000;
}

function nomeArquivoDeUrl(url) {
  try {
    return decodeURIComponent(url.split("/").pop().split("?")[0]);
  } catch {
    return url;
  }
}

// Texto de páginas lidas antes da limpeza do robô: tira nomes de ícone
// ("arrow_forward_ios") e o "Página atualizada há…".
function limparCorpo(t) {
  return String(t || "")
    .replace(/\b[a-z]+(?:_[a-z]+)+\b/g, "")
    .replace(/P[áa]gina atualizada h[áa][^(.]*/gi, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

// Monta o corpo em títulos, parágrafos e listas (quando o robô mandou os blocos).
function htmlBlocos(blocos) {
  let html = "";
  let emLista = false;
  for (const b of blocos) {
    if (b.tipo === "item") {
      if (!emLista) { html += "<ul>"; emLista = true; }
      html += `<li>${escapeHtml(b.t)}</li>`;
      continue;
    }
    if (emLista) { html += "</ul>"; emLista = false; }
    html += b.tipo === "titulo" ? `<h4>${escapeHtml(b.t)}</h4>` : `<p>${escapeHtml(b.t)}</p>`;
  }
  if (emLista) html += "</ul>";
  return html;
}

function renderizarFeed() {
  const lista = $("feed-lista");
  const itens = filtroFeedAtual === "todos" ? ultimosItensFeed : ultimosItensFeed.filter((it) => it.fonte === filtroFeedAtual);

  lista.innerHTML = "";
  if (itens.length === 0) {
    lista.innerHTML = '<p class="vazio">Nada por aqui ainda. Assim que o robô encontrar novidades na UFC ou no IFCE, elas aparecem aqui.</p>';
    return;
  }

  itens.forEach((item) => {
    const marcadorNovo = ehRecente(item.mudouEm) || ehRecente(item.novoEm);
    const imagens = Array.isArray(item.imagens) ? item.imagens : [];
    const anexos = Array.isArray(item.anexos) ? item.anexos : [];
    const dataExibida = formatarDataHora(item.mudouEm || item.novoEm || item.atualizadoEm);
    const blocos = Array.isArray(item.blocos) && item.blocos.length ? item.blocos : null;
    const corpoTexto = limparCorpo(item.corpo);
    const corpoLongo = blocos ? blocos.length > 3 || corpoTexto.length > 320 : corpoTexto.length > 320;

    const cartao = document.createElement("article");
    cartao.className = "cartao-noticia";
    cartao.innerHTML = `
      <div class="cartao-topo-noticia">
        <span class="etiqueta etiqueta-fonte-${escapeHtml(item.fonte || "")}">${escapeHtml(item.fonte || "")}</span>
        <span class="etiqueta">${item.categoria === "noticia" ? "Notícia" : item.categoria === "edital" ? "Edital" : "Documento"}</span>
        ${item.origem ? `<span class="etiqueta etiqueta-origem">${escapeHtml(item.origem)}</span>` : ""}
        ${marcadorNovo ? '<span class="etiqueta etiqueta-novo">Atualizado</span>' : ""}
      </div>
      <h3>${escapeHtml(item.titulo || "Sem título")}</h3>
      ${imagens[0] ? `<div class="cartao-imagem"><img src="${escapeHtml(imagens[0])}" alt="" loading="lazy" /></div>` : ""}
      <div class="cartao-corpo ${blocos ? "corpo-blocos" : ""} ${corpoLongo ? "recolhido" : ""}">${blocos ? htmlBlocos(blocos) : escapeHtml(corpoTexto)}</div>
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
        const recolhido = cartao.querySelector(".cartao-corpo").classList.toggle("recolhido");
        botaoVerMais.textContent = recolhido ? "Ver mais" : "Ver menos";
      });
    }
    lista.appendChild(cartao);
  });
}

document.querySelectorAll("#pagina-feed .chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll("#pagina-feed .chip").forEach((c) => c.classList.remove("chip-ativo"));
    chip.classList.add("chip-ativo");
    filtroFeedAtual = chip.dataset.filtro;
    renderizarFeed();
  });
});

// ---------------------------------------------------------------------------
// Prazos — lista global; o "já providenciei" é de cada usuário.
// ---------------------------------------------------------------------------
let todosOsPrazos = [];
let prazosConfirmados = new Set();
const UM_DIA = 24 * 60 * 60 * 1000;

function inicioDoDia(data) {
  const d = new Date(data);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// As datas dos prazos são gravadas ao meio-dia UTC; comparar pelo dia UTC
// evita que um fuso horário empurre a data um dia pra trás ou pra frente.
function diaDoPrazo(quando) {
  return new Date(quando.getUTCFullYear(), quando.getUTCMonth(), quando.getUTCDate()).getTime();
}

// Situação pelo PERÍODO do prazo: antes de começar, "faltam N dias"; durante
// um intervalo (ex.: 9 a 10/09), "em andamento — termina amanhã"; depois do
// último dia, "passou".
function situacaoDoPrazo(p) {
  const hoje = inicioDoDia(new Date());
  const ini = Math.round((diaDoPrazo(p.quando) - hoje) / UM_DIA);
  const fimDias = Math.round((diaDoPrazo(p.limite || p.quando) - hoje) / UM_DIA);
  if (fimDias < 0) return { estado: "passou", texto: fimDias === -1 ? "Foi ontem" : `Passou há ${Math.abs(fimDias)} dias` };
  if (ini <= 0 && p.fim) {
    if (fimDias === 0) return { estado: "hoje", texto: "Último dia hoje" };
    return { estado: "hoje", texto: fimDias === 1 ? "Em andamento · termina amanhã" : `Em andamento · termina em ${fimDias} dias` };
  }
  if (ini === 0) return { estado: "hoje", texto: p.ate ? "Prazo final hoje" : "É hoje" };
  if (ini === 1) return { estado: "perto", texto: p.fim ? "Começa amanhã" : "É amanhã" };
  const txt = p.fim ? `Começa em ${ini} dias` : `Faltam ${ini} dias`;
  return { estado: ini <= 15 ? "perto" : "longe", texto: txt };
}

// "09/09 a 10/09/2026", "até 10/09/2026", "11/09/2026, 8h às 23h59 (previsão)"
function textoQuando(p, comAno = true) {
  const opc = comAno ? { timeZone: "UTC" } : { timeZone: "UTC", day: "2-digit", month: "2-digit" };
  const d = p.quando.toLocaleDateString("pt-BR", opc);
  let t;
  if (p.fim) {
    const ini = p.quando.toLocaleDateString("pt-BR", { timeZone: "UTC", day: "2-digit", month: "2-digit" });
    t = `${ini} a ${p.fim.toLocaleDateString("pt-BR", opc)}`;
  } else {
    t = `${p.ate ? "até " : ""}${d}`;
  }
  if (p.horario) t += `, ${p.horario}`;
  return t;
}

// ---------------------------------------------------------------------------
// Resumo do prazo: transforma a frase solta da página ("Sisu 2026: listados na
// 10ª Convocação de Suplentes têm os dias 9 e 10 de setembro para realizar
// autocadastro no SIGAA") em
//   titulo:   "10ª Convocação de Suplentes"
//   oQueFazer: ["Autocadastro no SIGAA", "Ativação da matrícula"]
// (Mesmo código no robô e no app — se mudar um, mude o outro.)
// ---------------------------------------------------------------------------
function semAcentoResumo(t) {
  return String(t || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

const ACOES_PRAZO = [
  { re: /regulariza/, txt: "Regularizar a documentação indeferida" },
  { re: /recurso/, txt: "Recurso contra o indeferimento" },
  { re: /manifest\w* (de )?interesse/, txt: "Manifestar interesse na lista de espera" },
  { re: /pre-?matricula/, txt: "Pré-matrícula" },
  { re: /autocadastro/, txt: "Autocadastro no SIGAA" },
  { re: /ativa\w*\s+(a\s+|da\s+|de\s+)?matricula/, txt: "Ativação da matrícula" },
  { re: /heteroidentifica/, txt: "Banca de heteroidentificação" },
  { re: /biopsicossocial|pessoa com deficiencia|\bpcd\b/, txt: "Avaliação biopsicossocial (PcD)" },
  { re: /socioecono|comprova\w* de renda/, txt: "Documentação socioeconômica (renda)" },
  { re: /documenta\w* basica|analise documental|envio d[ae]s? document|entrega d[ae]s? document/, txt: "Documentação básica" },
  { re: /rematricula/, txt: "Rematrícula" },
  { re: /ajuste de matricula/, txt: "Ajuste de matrícula" },
  { re: /trancamento/, txt: "Trancamento" },
  { re: /inicio (das|do) (aulas|semestre|periodo)/, txt: "Início das aulas" },
  { re: /(termino|fim|encerramento) (das|do) (aulas|semestre|periodo)/, txt: "Fim do semestre" },
  { re: /feriado|recesso/, txt: "Feriado / recesso" },
  { re: /resultado/, txt: "Resultado" },
  { re: /inscri/, txt: "Inscrição" },
];

function tituloDoPrazo(texto) {
  const t = String(texto || "");
  let m = t.match(/(\d{1,2})\s*[ªaº°]\s*(?:e\s*(\d{1,2})\s*[ªaº°]\s*)?convoca\S*\s+(?:de\s+)?suplentes/i);
  if (m) return m[2] ? `${m[1]}ª e ${m[2]}ª Convocações de Suplentes` : `${m[1]}ª Convocação de Suplentes`;
  m = t.match(/(\d{1,2})\s*[ªaº°]\s*chamada/i);
  if (m) return `${m[1]}ª chamada`;
  const s = semAcentoResumo(t);
  if (/lista de espera/.test(s)) return "Lista de espera";
  if (/chamada regular/.test(s)) return "Chamada regular";
  if (/suplent/.test(s)) return "Suplentes";
  return null;
}

// frase = a frase onde a data aparece; antes = o texto que vem antes dela na
// página (título da notícia etc.), usado só pra achar o título da convocação.
function resumirPrazo(frase, categoria, antes) {
  const s = semAcentoResumo(frase);
  const acoes = [];
  for (const a of ACOES_PRAZO) {
    if (a.re.test(s) && !acoes.includes(a.txt)) acoes.push(a.txt);
  }
  // "Recurso" e "Regularizar" já dizem que é sobre documentação — não repete.
  const sobreIndeferido = acoes.some((a) => /Recurso|Regularizar/.test(a));
  let oQueFazer = sobreIndeferido
    ? acoes.filter((a) => !/^Documentação|^Resultado$/.test(a))
    : acoes;
  if (sobreIndeferido) {
    const qual = [];
    if (/documenta\w* basica/.test(s)) qual.push("básica");
    if (/socioecono/.test(s)) qual.push("socioeconômica");
    if (qual.length) oQueFazer = oQueFazer.map((a) => (/Recurso|Regularizar/.test(a) ? `${a} (documentação ${qual.join(" e/ou ")})` : a));
  }
  if (/somente hoje|apenas hoje|ultimo dia/.test(s)) oQueFazer = oQueFazer.map((a, i) => (i === 0 ? `${a} — último dia` : a));

  let titulo = tituloDoPrazo(frase);
  if (!titulo && antes) {
    // A convocação mais perto da data, olhando pra trás.
    const pedaco = String(antes).slice(-500);
    const todas = [...pedaco.matchAll(/\d{1,2}\s*[ªaº°]\s*(?:e\s*\d{1,2}\s*[ªaº°]\s*)?convoca\S*\s+(?:de\s+)?suplentes|\d{1,2}\s*[ªaº°]\s*chamada|lista de espera|chamada regular/gi)];
    if (todas.length) titulo = tituloDoPrazo(todas[todas.length - 1][0]);
  }
  if (!titulo) titulo = categoria || "Prazo";

  // Sem ação reconhecida: usa o começo da frase, sem o "Sisu 2026:" e sem datas.
  if (oQueFazer.length === 0) {
    const limpa = String(frase || "")
      .replace(/^[…\s]+/, "")
      .replace(/^sisu\s+20\d{2}\s*:\s*/i, "")
      .replace(/\s+/g, " ")
      .trim();
    oQueFazer = limpa ? [limpa.length > 120 ? limpa.slice(0, 118).replace(/\s\S*$/, "") + "…" : limpa] : [];
  }
  return { titulo, oQueFazer };
}

// "Data da publicação: 16 de setembro de 2026" não é prazo — é só quando a
// notícia saiu.
function ehDataDePublicacao(textoAntesDaData) {
  return /(data da publica\w*|publicad[oa] em|atualizad[oa] em|pagina atualizada|postad[oa] em)\s*:?\s*$/.test(
    semAcentoResumo(String(textoAntesDaData || "").slice(-40))
  );
}

// Título e "o que fazer" do prazo: o robô já grava; pra prazos antigos, o app
// calcula na hora a partir da frase.
function infoPrazo(p) {
  if (p.rotulo) return { titulo: p.etapa || p.titulo || p.categoria || "Prazo", oQueFazer: [p.rotulo] };
  if (p.titulo && Array.isArray(p.oQueFazer) && p.oQueFazer.length) return { titulo: p.titulo, oQueFazer: p.oQueFazer };
  return resumirPrazo(p.descricao, p.categoria, "");
}

// Datas que eram só a "Data da publicação" da notícia (o robô apaga, mas até
// ele rodar, o app já esconde).
function prazoEhPublicacao(p) {
  if (!p.quando) return false;
  const t = semAcentoResumo(p.descricao || "");
  const re = /(?:data da publica\S*|publicad[oa] em|atualizad[oa] em)\s*:?\s*(\d{1,2})(?:\s+de\s+([a-z]+)|\/(\d{1,2}))/g;
  const MES = { janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };
  let m;
  while ((m = re.exec(t)) !== null) {
    const mes = m[2] ? MES[m[2]] : Number(m[3]);
    if (Number(m[1]) === p.quando.getUTCDate() && mes === p.quando.getUTCMonth() + 1) return true;
  }
  return false;
}

function prazosValidos() {
  return todosOsPrazos.filter((p) => p.quando && !prazoEhPublicacao(p));
}

// ---------------------------------------------------------------------------
// Filtros da aba Prazos
//   Período: próximos (inclui o que está em andamento), próximos 7/30 dias,
//            este mês, já passaram, tudo ou um intervalo de datas escolhido.
//            Um prazo "cai" no período se QUALQUER dia dele estiver dentro
//            (um intervalo 9–10/09 aparece numa busca de 10/09 a 20/09).
//   Etapa:   de qual página veio (Chamada Regular, 10ª Convocação…).
//   Situação, instituição, busca e "só o que falta providenciar".
// ---------------------------------------------------------------------------
const filtrosPrazo = { periodo: "proximos", de: "", ate: "", etapa: "", busca: "", fonte: "", categoria: "", pendentes: false };

// Ordem natural das etapas: cronograma, chamada regular, lista de espera,
// 1ª…Nª convocação, resultado, remanejamentos; o resto depois, em ordem alfabética.
function pesoEtapa(e) {
  const t = semAcentoResumo(e);
  if (/cronograma/.test(t)) return [0, 0];
  if (/chamada regular/.test(t)) return [1, 0];
  if (/lista de espera/.test(t)) return [2, 0];
  const n = t.match(/(\d{1,2})\s*[ªaº°]?\s*convoca/);
  if (n) return [3, Number(n[1])];
  if (/suplente/.test(t)) return [3, 0];
  if (/resultado/.test(t)) return [4, 0];
  if (/remanejamento/.test(t)) return [5, 0];
  return [6, 0];
}

// Prazos gravados antes das novas fontes não têm "origem".
function origemPadrao(p) {
  if (p.origem) return p.origem;
  if (/sisu\.ufc\.br/.test(p.link || "")) return "Sisu UFC";
  return p.fonte === "IFCE" ? "IFCE" : "UFC";
}

function preencherOpcoesFiltro() {
  const validos = prazosValidos();
  // Origem: UFC (tudo), IFCE (tudo) e cada site/tipo de seleção.
  const porInst = { UFC: new Set(), IFCE: new Set() };
  validos.forEach((p) => (porInst[p.fonte === "IFCE" ? "IFCE" : "UFC"]).add(origemPadrao(p)));
  const selFonte = $("filtro-fonte");
  const grupo = (inst) => porInst[inst].size
    ? `<optgroup label="${inst}"><option value="inst:${inst}">${inst} — tudo</option>${[...porInst[inst]].sort((a, b) => a.localeCompare(b, "pt-BR"))
        .map((o) => `<option value="origem:${escapeHtml(o)}">${escapeHtml(o.replace(/^IFCE · /, ""))}</option>`).join("")}</optgroup>`
    : "";
  selFonte.innerHTML = '<option value="">UFC e IFCE — tudo</option>' + grupo("UFC") + grupo("IFCE");
  selFonte.value = [...selFonte.options].some((o) => o.value === filtrosPrazo.fonte) ? filtrosPrazo.fonte : "";
  const etapas = [...new Set(validos.map((p) => infoPrazo(p).titulo))].sort((a, b) => {
    const [pa, na] = pesoEtapa(a), [pb, nb] = pesoEtapa(b);
    return pa - pb || na - nb || a.localeCompare(b, "pt-BR");
  });
  const selEtapa = $("filtro-etapa");
  selEtapa.innerHTML = '<option value="">Todas as etapas</option>' + etapas.map((e) => `<option>${escapeHtml(e)}</option>`).join("");
  selEtapa.value = etapas.includes(filtrosPrazo.etapa) ? filtrosPrazo.etapa : "";

  const cats = [...new Set(validos.map((p) => p.categoria || "Outros"))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const selCat = $("filtro-categoria");
  selCat.innerHTML = '<option value="">Todas as situações</option>' + cats.map((c) => `<option>${escapeHtml(c)}</option>`).join("");
  selCat.value = cats.includes(filtrosPrazo.categoria) ? filtrosPrazo.categoria : "";
}

function diaDeInput(v) {
  if (!v) return null;
  const [a, m, d] = v.split("-").map(Number);
  return new Date(a, m - 1, d).getTime();
}

// Janela [de, até] (em "dia local") do período escolhido; null = sem limite.
function janelaDoPeriodo() {
  const hoje = inicioDoDia(new Date());
  const agora = new Date();
  switch (filtrosPrazo.periodo) {
    case "proximos": return [hoje, null];
    case "7": return [hoje, hoje + 7 * UM_DIA];
    case "30": return [hoje, hoje + 30 * UM_DIA];
    case "mes": return [new Date(agora.getFullYear(), agora.getMonth(), 1).getTime(), new Date(agora.getFullYear(), agora.getMonth() + 1, 0).getTime()];
    case "passados": return [null, hoje - UM_DIA];
    case "datas": return [diaDeInput(filtrosPrazo.de), diaDeInput(filtrosPrazo.ate)];
    default: return [null, null];
  }
}

function passaNosFiltros(p, janela) {
  const [de, ate] = janela;
  const ini = diaDoPrazo(p.quando);
  const fim = diaDoPrazo(p.limite || p.quando);
  if (filtrosPrazo.periodo === "passados") {
    if (fim >= inicioDoDia(new Date())) return false;
  } else {
    if (de !== null && fim < de) return false;
    if (ate !== null && ini > ate) return false;
  }
  if (filtrosPrazo.etapa && infoPrazo(p).titulo !== filtrosPrazo.etapa) return false;
  if (filtrosPrazo.fonte) {
    const [tipo, valor] = filtrosPrazo.fonte.split(":");
    if (tipo === "inst" && p.fonte !== valor) return false;
    if (tipo === "origem" && (p.origem || origemPadrao(p)) !== valor) return false;
  }
  if (filtrosPrazo.categoria && (p.categoria || "Outros") !== filtrosPrazo.categoria) return false;
  if (filtrosPrazo.pendentes && prazosConfirmados.has(p.id)) return false;
  if (filtrosPrazo.busca) {
    const info = infoPrazo(p);
    const alvo = semAcentoResumo([info.titulo, info.oQueFazer.join(" "), p.secao, p.publico, p.descricao, p.categoria, p.fonte, origemPadrao(p), p.fonteTitulo, textoQuando(p)].join(" "));
    const termos = semAcentoResumo(filtrosPrazo.busca).split(/\s+/).filter(Boolean);
    if (!termos.every((t) => alvo.includes(t))) return false;
  }
  return true;
}

const NOMES_MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function renderizarPrazos() {
  const lista = $("lista-eventos");
  const hoje = inicioDoDia(new Date());
  preencherOpcoesFiltro();
  $("filtro-datas").classList.toggle("oculto", filtrosPrazo.periodo !== "datas");

  const janela = janelaDoPeriodo();
  const itens0 = prazosValidos().filter((p) => passaNosFiltros(p, janela));
  // O que está em andamento ou vem aí fica em cima, do mais perto pro mais
  // longe; o que já passou vem depois, do mais recente pro mais antigo.
  const abertos = itens0.filter((p) => diaDoPrazo(p.limite || p.quando) >= hoje)
    .sort((a, b) => a.quando - b.quando || (a.limite || a.quando) - (b.limite || b.quando));
  const passados = itens0.filter((p) => diaDoPrazo(p.limite || p.quando) < hoje)
    .sort((a, b) => (b.limite || b.quando) - (a.limite || a.quando));
  const itens = [...abertos, ...passados];

  const padrao = filtrosPrazo.periodo === "proximos";
  const algumFiltro = !padrao || filtrosPrazo.etapa || filtrosPrazo.busca || filtrosPrazo.fonte || filtrosPrazo.categoria || filtrosPrazo.pendentes;
  $("prazos-contagem").textContent = `${itens.length} prazo${itens.length === 1 ? "" : "s"}${algumFiltro ? " com esses filtros" : " daqui pra frente"}`;
  $("filtro-limpar").classList.toggle("oculto", !algumFiltro);

  lista.innerHTML = "";
  if (itens.length === 0) {
    lista.innerHTML = algumFiltro
      ? '<p class="vazio">Nenhum prazo com esses filtros. Tente outro período ou tire algum filtro.</p>'
      : '<p class="vazio">Nenhum prazo daqui pra frente. Para ver os anteriores, escolha "Já passaram" ou "Tudo" no período.</p>';
    return;
  }

  // Cabeçalhos: "Em andamento", depois um por mês.
  let grupoAtual = null;
  itens.forEach((p) => {
    const ini = diaDoPrazo(p.quando);
    const fim = diaDoPrazo(p.limite || p.quando);
    const grupo = ini < hoje && fim >= hoje
      ? "Em andamento"
      : `${NOMES_MESES[p.quando.getUTCMonth()]} de ${p.quando.getUTCFullYear()}${fim < hoje ? " · já passou" : ""}`;
    if (grupo !== grupoAtual) {
      grupoAtual = grupo;
      const h = document.createElement("h3");
      h.className = "grupo-prazos";
      h.textContent = grupo.charAt(0).toUpperCase() + grupo.slice(1);
      lista.appendChild(h);
    }

    const sit = situacaoDoPrazo(p);
    const novo = p.criadoEm?.toDate && Date.now() - p.criadoEm.toDate().getTime() < 2 * UM_DIA;
    const confirmado = prazosConfirmados.has(p.id);
    const info = infoPrazo(p);
    const contexto = [p.secao, p.publico].filter(Boolean).join(" · ");

    const cartao = document.createElement("article");
    cartao.className = "cartao-evento";
    cartao.innerHTML = `
      <div class="cartao-topo-noticia">
        <span class="etiqueta etiqueta-fonte-${escapeHtml(p.fonte || "")}">${escapeHtml(p.fonte || "")}</span>
        <span class="etiqueta">${escapeHtml(p.categoria || "Outros")}</span>
        <span class="etiqueta etiqueta-${sit.estado}">${escapeHtml(sit.texto)}</span>
        ${p.previsao ? '<span class="etiqueta">Previsão</span>' : ""}
        ${novo ? '<span class="etiqueta etiqueta-novo">Novo</span>' : ""}
      </div>
      <div class="cartao-topo"><strong>${escapeHtml(textoQuando(p))} · ${escapeHtml(info.titulo)}</strong></div>
      <div class="o-que-fazer">
        <span>O que fazer</span>
        <ul>${info.oQueFazer.map((a) => `<li>${escapeHtml(a)}</li>`).join("")}</ul>
        ${contexto ? `<p class="contexto-prazo">${escapeHtml(contexto)}</p>` : ""}
      </div>
      ${p.descricao && p.descricao !== info.oQueFazer[0] ? `<details class="trecho-original"><summary>Como está no site</summary><p>${escapeHtml(p.descricao)}</p></details>` : ""}
      <div class="cartao-rodape">
        <span class="cartao-data">${escapeHtml(origemPadrao(p))}${p.fonteTitulo && p.fonteTitulo !== info.titulo ? " · " + escapeHtml(p.fonteTitulo) : ""}</span>
        <span class="links-prazo">
          ${p.pagina && p.pagina !== p.link ? `<a href="${escapeHtml(p.pagina)}" target="_blank" rel="noopener">Página</a>` : ""}
          ${p.link ? `<a href="${escapeHtml(p.link)}" target="_blank" rel="noopener">${/\.pdf($|\?)/i.test(p.link) ? "Ver PDF →" : "Ver página →"}</a>` : ""}
        </span>
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
      await setDoc(doc(db, "usuarios", u.uid, "confirmacoes", btn.dataset.id), { confirmadoEm: serverTimestamp() });
    });
  });
}

$("filtro-periodo").addEventListener("change", (e) => {
  filtrosPrazo.periodo = e.target.value;
  if (filtrosPrazo.periodo === "datas" && !filtrosPrazo.de) {
    const hoje = new Date();
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    filtrosPrazo.de = iso(hoje);
    filtrosPrazo.ate = iso(new Date(hoje.getTime() + 30 * UM_DIA));
    $("filtro-de").value = filtrosPrazo.de;
    $("filtro-ate").value = filtrosPrazo.ate;
  }
  renderizarPrazos();
});
$("filtro-de").addEventListener("change", (e) => { filtrosPrazo.de = e.target.value; renderizarPrazos(); });
$("filtro-ate").addEventListener("change", (e) => { filtrosPrazo.ate = e.target.value; renderizarPrazos(); });
$("filtro-etapa").addEventListener("change", (e) => { filtrosPrazo.etapa = e.target.value; renderizarPrazos(); });
$("filtro-busca").addEventListener("input", (e) => { filtrosPrazo.busca = e.target.value.trim(); renderizarPrazos(); });
$("filtro-fonte").addEventListener("change", (e) => { filtrosPrazo.fonte = e.target.value; renderizarPrazos(); });
$("filtro-categoria").addEventListener("change", (e) => { filtrosPrazo.categoria = e.target.value; renderizarPrazos(); });
$("filtro-pendentes").addEventListener("change", (e) => { filtrosPrazo.pendentes = e.target.checked; renderizarPrazos(); });
$("filtro-limpar").addEventListener("click", () => {
  Object.assign(filtrosPrazo, { periodo: "proximos", de: "", ate: "", etapa: "", busca: "", fonte: "", categoria: "", pendentes: false });
  ["filtro-busca", "filtro-fonte", "filtro-categoria", "filtro-etapa", "filtro-de", "filtro-ate"].forEach((id) => ($(id).value = ""));
  $("filtro-periodo").value = "proximos";
  $("filtro-pendentes").checked = false;
  renderizarPrazos();
});

// ---------------------------------------------------------------------------
// Inscrições — uma por edição do Enem, em usuarios/{uid}/inscricoes/{ano}
// ---------------------------------------------------------------------------
let todasInscricoes = [];
let subabaAtual = null;

const AREAS = [
  { chave: "lc", nome: "Linguagens", curto: "Linguagens" },
  { chave: "ch", nome: "Ciências Humanas", curto: "C. Humanas" },
  { chave: "cn", nome: "Ciências da Natureza", curto: "C. da Natureza" },
  { chave: "mt", nome: "Matemática", curto: "Matemática" },
  { chave: "redacao", nome: "Redação", curto: "Redação" },
];

const SITUACOES_SISU = {
  classificado: "Classificado",
  lista_espera: "Lista de espera",
  suplente: "Suplente",
  matriculado: "Matriculado",
  nao_classificado: "Não classificado",
};

function mostrarSubaba(nome) {
  subabaAtual = nome;
  $("painel-cadastro").classList.toggle("oculto", nome !== "cadastro");
  $("painel-acompanhamento").classList.toggle("oculto", nome !== "acompanhamento");
  $("subaba-cadastro").classList.toggle("aba-ativa", nome === "cadastro");
  $("subaba-acompanhamento").classList.toggle("aba-ativa", nome === "acompanhamento");
  $("subaba-cadastro").setAttribute("aria-selected", String(nome === "cadastro"));
  $("subaba-acompanhamento").setAttribute("aria-selected", String(nome === "acompanhamento"));
}
$("subaba-cadastro").addEventListener("click", () => mostrarSubaba("cadastro"));
$("subaba-acompanhamento").addEventListener("click", () => mostrarSubaba("acompanhamento"));

function mediaDasNotas(notas) {
  const v = AREAS.map((a) => notas?.[a.chave]);
  if (!v.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return Math.round((v.reduce((s, n) => s + n, 0) / 5) * 100) / 100;
}

// --- Formulário ------------------------------------------------------------
const CAMPO_PARA_INPUT = {
  ano: "insc-ano",
  numeroInscricao: "insc-numero",
  lingua: "insc-lingua",
  dia1: "insc-dia1",
  dia2: "insc-dia2",
  "nota-lc": "insc-nota-lc",
  "nota-ch": "insc-nota-ch",
  "nota-cn": "insc-nota-cn",
  "nota-mt": "insc-nota-mt",
  "nota-redacao": "insc-nota-redacao",
  "comp-1": "insc-comp-1",
  "comp-2": "insc-comp-2",
  "comp-3": "insc-comp-3",
  "comp-4": "insc-comp-4",
  "comp-5": "insc-comp-5",
};

function numOuNull(id) {
  const v = $(id).value.trim();
  if (v === "") return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function textoOuNull(id) {
  const v = $(id).value.trim();
  return v === "" ? null : v;
}
function definir(id, valor) {
  $(id).value = valor === null || valor === undefined ? "" : valor;
}

function lerFormulario() {
  const notas = {};
  AREAS.forEach((a) => (notas[a.chave] = numOuNull("insc-nota-" + a.chave)));
  return {
    ano: numOuNull("insc-ano"),
    numeroInscricao: textoOuNull("insc-numero"),
    linguaEstrangeira: textoOuNull("insc-lingua"),
    treineiro: $("insc-treineiro").checked,
    dia1: textoOuNull("insc-dia1"),
    dia2: textoOuNull("insc-dia2"),
    notas,
    competencias: [1, 2, 3, 4, 5].map((i) => numOuNull("insc-comp-" + i)),
    mediaGeral: mediaDasNotas(notas),
    sisu: {
      curso: textoOuNull("insc-sisu-curso"),
      turno: textoOuNull("insc-sisu-turno"),
      status: textoOuNull("insc-sisu-status"),
      posicao: numOuNull("insc-sisu-posicao"),
    },
  };
}

function preencherFormulario(r) {
  definir("insc-ano", r.ano);
  definir("insc-numero", r.numeroInscricao);
  definir("insc-lingua", r.linguaEstrangeira || "");
  $("insc-treineiro").checked = !!r.treineiro;
  definir("insc-dia1", r.dia1);
  definir("insc-dia2", r.dia2);
  AREAS.forEach((a) => definir("insc-nota-" + a.chave, r.notas?.[a.chave]));
  [1, 2, 3, 4, 5].forEach((i) => definir("insc-comp-" + i, r.competencias?.[i - 1]));
  const s = r.sisu || {};
  definir("insc-sisu-curso", s.curso);
  definir("insc-sisu-turno", s.turno);
  definir("insc-sisu-status", s.status || "");
  definir("insc-sisu-posicao", s.posicao);
  atualizarMediaAoVivo();
}

function limparDestaques() {
  document.querySelectorAll("#form-inscricao .lido-do-pdf").forEach((el) => el.classList.remove("lido-do-pdf"));
  $("legenda-pdf").classList.add("oculto");
}

function destacarCampos(campos) {
  limparDestaques();
  let algum = false;
  for (const campo of campos) {
    const id = CAMPO_PARA_INPUT[campo];
    if (!id) continue;
    $(id).parentElement.classList.add("lido-do-pdf");
    algum = true;
  }
  $("legenda-pdf").classList.toggle("oculto", !algum);
}

function atualizarMediaAoVivo() {
  const notas = {};
  AREAS.forEach((a) => (notas[a.chave] = numOuNull("insc-nota-" + a.chave)));
  const m = mediaDasNotas(notas);
  $("insc-media").value = m === null ? "" : fmtMedia(m);
}
AREAS.forEach((a) => $("insc-nota-" + a.chave).addEventListener("input", atualizarMediaAoVivo));

function limparFormulario() {
  $("form-inscricao").reset();
  $("insc-media").value = "";
  limparDestaques();
  showMsg("msg-inscricao-salva", "");
  showMsg("erro-inscricao", "");
  statusPdf(null);
}
$("btn-limpar-inscricao").addEventListener("click", limparFormulario);

// --- Importação do PDF -----------------------------------------------------
function statusPdf(tipo, texto) {
  const el = $("pdf-status");
  if (!tipo) {
    el.className = "status-pdf oculto";
    el.textContent = "";
    return;
  }
  el.className = "status-pdf " + tipo;
  el.textContent = texto;
}

// Mostra, abaixo do aviso, as linhas das provas do jeito que o leitor viu —
// ajuda a descobrir por que uma nota não veio.
function detalhePdf(titulo, linhas) {
  const el = $("pdf-status");
  const det = document.createElement("details");
  det.className = "detalhe-pdf";
  const sum = document.createElement("summary");
  sum.textContent = titulo;
  const pre = document.createElement("pre");
  pre.textContent = linhas.length ? linhas.join("\n") : "(nenhuma linha com o nome das provas foi encontrada)";
  det.append(sum, pre);
  el.append(det);
}

// Junta o que veio do PDF por cima do que já existe (sem apagar nada que o PDF
// não trouxe) — assim o boletim e o cartão de confirmação se completam.
function mesclarLeitura(base, lido) {
  const b = base || {};
  const r = {
    ano: b.ano ?? null,
    numeroInscricao: b.numeroInscricao ?? null,
    linguaEstrangeira: b.linguaEstrangeira ?? null,
    treineiro: !!b.treineiro,
    dia1: b.dia1 ?? null,
    dia2: b.dia2 ?? null,
    local: { ...(b.local || {}) },
    notas: { ...(b.notas || {}) },
    competencias: [...(b.competencias || [null, null, null, null, null])],
    sisu: b.sisu ? { ...b.sisu } : undefined,
  };
  if (lido.ano) r.ano = lido.ano;
  if (lido.numeroInscricao) r.numeroInscricao = lido.numeroInscricao;
  if (lido.linguaEstrangeira) r.linguaEstrangeira = lido.linguaEstrangeira;
  if (lido.treineiro) r.treineiro = true;
  if (lido.dia1) r.dia1 = lido.dia1;
  if (lido.dia2) r.dia2 = lido.dia2;
  for (const [k, v] of Object.entries(lido.local || {})) if (v) r.local[k] = v;
  for (const [k, v] of Object.entries(lido.sisu || {})) {
    if (v !== null && v !== undefined && k !== "historico") r.sisu = { ...(r.sisu || {}), [k]: v };
  }
  for (const [k, v] of Object.entries(lido.notas || {})) if (v !== null) r.notas[k] = v;
  (lido.competencias || []).forEach((v, i) => {
    if (v !== null) r.competencias[i] = v;
  });
  return r;
}

async function importarPdfs(arquivos) {
  const pdfs = [...arquivos].filter((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
  if (pdfs.length === 0) {
    statusPdf("falha", "Esse arquivo não é um PDF. Escolha o boletim ou o cartão de confirmação do Enem em PDF.");
    return;
  }
  mostrarSubaba("cadastro");
  showMsg("msg-inscricao-salva", "");
  showMsg("erro-inscricao", "");

  let acumulado = {};
  const encontrados = new Set();
  const semTexto = [];
  const notasFaltando = [];
  let segundosTotal = 0;

  for (const arquivo of pdfs) {
    statusPdf("lendo", `Lendo ${arquivo.name}…`);
    try {
      const lido = await lerPdfDoEnem(arquivo, (aviso) => statusPdf("lendo", `${arquivo.name}: ${aviso}`));
      if (lido.camposEncontrados.length === 0) {
        semTexto.push(arquivo.name);
        continue;
      }
      segundosTotal += lido.segundos || 0;
      // Parece boletim (cita as provas) mas alguma nota não saiu?
      if (lido.linhasDasNotas?.length >= 3) {
        const faltam = ["lc", "ch", "cn", "mt", "redacao"].filter((k) => lido.notas[k] === null);
        if (faltam.length) notasFaltando.push({ arquivo: arquivo.name, faltam, linhas: lido.linhasDasNotas });
      }
      acumulado = mesclarLeitura(acumulado, lido);
      lido.camposEncontrados.filter((c) => CAMPO_PARA_INPUT[c]).forEach((c) => encontrados.add(c));
    } catch (erro) {
      console.error("Falha ao ler PDF", erro);
      statusPdf("falha", `Não consegui abrir ${arquivo.name}. Ele pode estar protegido por senha ou corrompido.`);
      return;
    }
  }

  if (encontrados.size === 0) {
    statusPdf(
      "falha",
      "Não reconheci dados do Enem nesse PDF. Se ele for uma foto ou digitalização (sem texto selecionável), preencha os campos à mão logo abaixo."
    );
    return;
  }

  // Parte do que já existe e completa com o PDF, nesta ordem: a inscrição já
  // salva desse ano → o que está no formulário agora (se for o mesmo ano, ou
  // se o ano ainda estiver vazio) → o que veio do PDF. Assim dá pra anexar o
  // boletim e a Vista Pedagógica um de cada vez, sem um apagar o outro.
  const naTela = lerFormulario();
  const ano = acumulado.ano || naTela.ano;
  const existente = ano ? todasInscricoes.find((i) => i.ano === ano) : null;
  let base = existente || {};
  if (!naTela.ano || !acumulado.ano || naTela.ano === acumulado.ano) base = mesclarLeitura(base, naTela);
  const final = mesclarLeitura(base, { ...acumulado, ano });
  preencherFormulario(final);
  document.querySelectorAll("#form-inscricao .lido-do-pdf input, #form-inscricao .lido-do-pdf select").forEach((el) => {
    const campo = Object.keys(CAMPO_PARA_INPUT).find((k) => CAMPO_PARA_INPUT[k] === el.id);
    if (campo) encontrados.add(campo);
  });
  destacarCampos(encontrados);

  let msg = `Li ${encontrados.size} informaç${encontrados.size === 1 ? "ão" : "ões"} de ${pdfs.length === 1 ? pdfs[0].name : pdfs.length + " arquivos"}. Confira os campos destacados e clique em Salvar.`;
  if (existente) msg += ` Você já tinha o Enem ${existente.ano} cadastrado — juntei os dados novos com os que já estavam lá.`;
  if (!ano) msg += " Não achei o ano no PDF: preencha o campo Ano antes de salvar.";
  if (semTexto.length) msg += ` (Sem texto reconhecível: ${semTexto.join(", ")}.)`;
  if (segundosTotal) msg += ` Leitura: ${segundosTotal}s.`;
  const NOMES = { lc: "Linguagens", ch: "C. Humanas", cn: "C. da Natureza", mt: "Matemática", redacao: "Redação" };
  const aindaFaltam = notasFaltando.filter((n) => n.faltam.some((k) => final.notas?.[k] == null));
  if (aindaFaltam.length) {
    const nomes = [...new Set(aindaFaltam.flatMap((n) => n.faltam.filter((k) => final.notas?.[k] == null)))].map((k) => NOMES[k]);
    msg += ` Não consegui ler: ${nomes.join(", ")} — preencha à mão.`;
  }
  statusPdf(aindaFaltam.length ? "falha" : "ok", msg);
  aindaFaltam.forEach((n) => detalhePdf(`Ver o que eu li nas notas de ${n.arquivo}`, n.linhas));
  $("pdf-status").scrollIntoView({ behavior: "smooth", block: "start" });
}

const zona = $("zona-pdf");
zona.addEventListener("click", () => $("insc-pdf").click());
zona.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    $("insc-pdf").click();
  }
});
$("insc-pdf").addEventListener("change", (e) => {
  if (e.target.files.length) importarPdfs(e.target.files);
  e.target.value = "";
});
["dragenter", "dragover"].forEach((ev) =>
  zona.addEventListener(ev, (e) => {
    e.preventDefault();
    zona.classList.add("arrastando");
  })
);
["dragleave", "drop"].forEach((ev) =>
  zona.addEventListener(ev, (e) => {
    e.preventDefault();
    zona.classList.remove("arrastando");
  })
);
zona.addEventListener("drop", (e) => {
  if (e.dataTransfer?.files?.length) importarPdfs(e.dataTransfer.files);
});

// --- Salvar / editar / excluir --------------------------------------------
$("form-inscricao").addEventListener("submit", async (e) => {
  e.preventDefault();
  showMsg("msg-inscricao-salva", "");
  showMsg("erro-inscricao", "");
  const user = auth.currentUser;
  if (!user) return;

  const dados = lerFormulario();
  if (!dados.ano || !Number.isInteger(dados.ano) || dados.ano < 1998 || dados.ano > 2100) {
    showMsg("erro-inscricao", "Informe o ano do Enem (por exemplo, 2025) antes de salvar.");
    $("insc-ano").focus();
    return;
  }
  for (const a of AREAS) {
    const n = dados.notas[a.chave];
    if (n !== null && (n < 0 || n > 1000)) {
      showMsg("erro-inscricao", `A nota de ${a.nome} precisa estar entre 0 e 1000.`);
      return;
    }
  }

  const ref = doc(db, "usuarios", user.uid, "inscricoes", String(dados.ano));
  const antes = (await getDoc(ref)).data() || {};
  const historico = Array.isArray(antes.sisu?.historico) ? [...antes.sisu.historico] : [];
  const posicaoAnterior = antes.sisu?.posicao;
  if (dados.sisu.posicao !== null && dados.sisu.posicao !== posicaoAnterior) {
    historico.push({ em: Date.now(), posicao: dados.sisu.posicao });
  }
  dados.sisu.historico = historico;

  await setDoc(ref, { ...dados, atualizadoEm: serverTimestamp(), criadoEm: antes.criadoEm || serverTimestamp() });

  let msg = `Enem ${dados.ano} salvo!`;
  if (typeof posicaoAnterior === "number" && dados.sisu.posicao !== null && posicaoAnterior !== dados.sisu.posicao) {
    const variou = posicaoAnterior - dados.sisu.posicao;
    msg += variou > 0 ? ` Você subiu ${variou} posiç${variou === 1 ? "ão" : "ões"} na lista.` : ` Sua posição caiu ${-variou}.`;
  }
  // Salvou: o formulário fica limpo pra cadastrar a próxima inscrição.
  limparFormulario();
  showMsg("msg-inscricao-salva", msg + " O formulário foi limpo para uma nova inscrição.");
  setTimeout(() => showMsg("msg-inscricao-salva", ""), 5000);
});

function editarInscricao(ano) {
  const r = todasInscricoes.find((i) => i.ano === ano);
  if (!r) return;
  limparFormulario();
  preencherFormulario(r);
  mostrarSubaba("cadastro");
  $("form-inscricao").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function excluirInscricao(ano) {
  const user = auth.currentUser;
  if (!user) return;
  if (!confirm(`Excluir a inscrição do Enem ${ano}? Isso apaga as notas e os dados salvos dessa edição.`)) return;
  await deleteDoc(doc(db, "usuarios", user.uid, "inscricoes", String(ano)));
}

// Quem já tinha preenchido a aba Inscrição antiga (um único formulário) não
// perde nada: na primeira vez, os dados viram a inscrição do ano correspondente.
let migracaoTentada = false;
async function migrarInscricaoAntiga(user) {
  if (migracaoTentada) return;
  migracaoTentada = true;
  try {
    const antiga = (await getDoc(doc(db, "usuarios", user.uid, "processos", "principal"))).data();
    if (!antiga || !(antiga.numeroInscricaoEnem || antiga.cursoPretendido || antiga.localProva)) return;
    const d1 = antiga.dataProva1?.toDate ? antiga.dataProva1.toDate() : null;
    const d2 = antiga.dataProva2?.toDate ? antiga.dataProva2.toDate() : null;
    const ano = d1 ? d1.getFullYear() : new Date().getFullYear();
    await setDoc(doc(db, "usuarios", user.uid, "inscricoes", String(ano)), {
      ano,
      numeroInscricao: antiga.numeroInscricaoEnem || null,
      dia1: d1 ? d1.toISOString().slice(0, 10) : null,
      dia2: d2 ? d2.toISOString().slice(0, 10) : null,
      local: { escola: antiga.localProva || null },
      notas: {},
      sisu: {
        curso: antiga.cursoPretendido || null,
        turno: antiga.turno || null,
        status: antiga.statusGeral || null,
        posicao: typeof antiga.posicaoAtualListaEspera === "number" ? antiga.posicaoAtualListaEspera : null,
        historico: [],
      },
      origem: "migrado",
      atualizadoEm: serverTimestamp(),
      criadoEm: serverTimestamp(),
    });
  } catch (erro) {
    console.warn("Migração da inscrição antiga não foi possível:", erro);
  }
}

// --- Acompanhamento --------------------------------------------------------
const CORES_SERIES = ["var(--serie-1)", "var(--serie-2)", "var(--serie-3)"];

function corDoAno(ano, anosComNotas) {
  // A cor segue a edição (o ano), não a posição no gráfico: ao cadastrar um
  // ano novo, as cores dos anos antigos não mudam.
  const idx = [...anosComNotas].sort((a, b) => a - b).indexOf(ano);
  return CORES_SERIES[idx % CORES_SERIES.length];
}

// Nota zerada em tudo é inscrição sem resultado (ex.: preenchida com 0), não
// um desempenho de verdade.
function temNotas(r) {
  return AREAS.some((a) => typeof r.notas?.[a.chave] === "number" && r.notas[a.chave] > 0);
}

function renderizarAcompanhamento() {
  const alvo = $("acompanhamento-conteudo");
  if (!alvo) return;

  if (todasInscricoes.length === 0) {
    alvo.innerHTML = `
      <div class="vazio">
        Nenhuma inscrição cadastrada ainda.<br />Anexe o PDF do seu boletim ou cartão de confirmação do Enem na aba Cadastro.
        <br /><button class="botao" type="button" data-acao="ir-cadastro">Cadastrar inscrição</button>
      </div>`;
    alvo.querySelector('[data-acao="ir-cadastro"]').addEventListener("click", () => mostrarSubaba("cadastro"));
    return;
  }

  const comNotas = todasInscricoes.filter(temNotas); // já em ordem decrescente de ano
  let html = "";
  if (comNotas.length) html += htmlIndicadores(comNotas) + htmlGrafico(comNotas) + htmlTabela(comNotas);
  html += todasInscricoes.map(htmlCartaoInscricao).join("");
  alvo.innerHTML = html;

  alvo.querySelectorAll("[data-editar]").forEach((b) => b.addEventListener("click", () => editarInscricao(Number(b.dataset.editar))));
  alvo.querySelectorAll("[data-excluir]").forEach((b) => b.addEventListener("click", () => excluirInscricao(Number(b.dataset.excluir))));
}

function htmlDelta(atual, anterior, anoAnterior) {
  if (typeof atual !== "number" || typeof anterior !== "number") return "";
  const d = Math.round((atual - anterior) * 10) / 10;
  if (d === 0) return `<span>igual a ${anoAnterior}</span>`;
  const classe = d > 0 ? "delta-sobe" : "delta-desce";
  const seta = d > 0 ? "▲" : "▼";
  return `<span class="${classe}">${seta} ${fmtDelta(d)}</span> em relação a ${anoAnterior}`;
}

function htmlIndicadores(comNotas) {
  const atual = comNotas[0];
  const anterior = comNotas[1];
  const objetivas = AREAS.filter((a) => a.chave !== "redacao" && typeof atual.notas?.[a.chave] === "number");
  const melhor = objetivas.sort((a, b) => atual.notas[b.chave] - atual.notas[a.chave])[0];
  const anos = todasInscricoes.map((i) => i.ano).sort((a, b) => a - b);

  return `
    <div class="tiles">
      <div class="tile">
        <div class="tile-rotulo">Média geral · ${atual.ano}</div>
        <div class="tile-valor">${fmtMedia(atual.mediaGeral)}</div>
        <div class="tile-pe">${anterior ? htmlDelta(atual.mediaGeral, anterior.mediaGeral, anterior.ano) || "média das 5 provas" : "média das 5 provas"}</div>
      </div>
      <div class="tile">
        <div class="tile-rotulo">Melhor área · ${atual.ano}</div>
        <div class="tile-valor">${melhor ? fmtProva(melhor.chave, atual.notas[melhor.chave]) : "—"}<small>${melhor ? melhor.nome : ""}</small></div>
      </div>
      <div class="tile">
        <div class="tile-rotulo">Redação · ${atual.ano}</div>
        <div class="tile-valor">${fmtProva("redacao", atual.notas?.redacao)}</div>
        <div class="tile-pe">${anterior ? htmlDelta(atual.notas?.redacao, anterior.notas?.redacao, anterior.ano) : ""}</div>
      </div>
      <div class="tile">
        <div class="tile-rotulo">Edições</div>
        <div class="tile-valor">${todasInscricoes.length}</div>
        <div class="tile-pe">${anos.join(", ")}</div>
      </div>
    </div>`;
}

// Gráfico de barras agrupadas: as 5 provas no eixo, uma barra por edição
// (no máximo as 3 mais recentes, pra continuar legível). Os valores exatos de
// todos os anos ficam na tabela logo abaixo.
function htmlGrafico(comNotas) {
  const anosComNotas = comNotas.map((r) => r.ano);
  const series = comNotas.slice(0, 3).reverse(); // mais antiga → mais recente
  const L = 640, A = 250, mE = 38, mD = 6, mT = 12, mB = 34;
  const larguraPlot = L - mE - mD;
  const alturaPlot = A - mT - mB;
  const y = (v) => mT + alturaPlot - (v / 1000) * alturaPlot;
  const base = y(0);
  const larguraGrupo = larguraPlot / AREAS.length;
  const vao = 2;
  const larguraBarra = Math.min(30, (larguraGrupo * 0.72 - vao * (series.length - 1)) / series.length);
  const larguraBloco = larguraBarra * series.length + vao * (series.length - 1);

  let svg = "";
  for (let v = 0; v <= 1000; v += 200) {
    const yy = y(v).toFixed(1);
    svg += `<line x1="${mE}" x2="${L - mD}" y1="${yy}" y2="${yy}" stroke="${v === 0 ? "#C3B8AE" : "#ECE0D8"}" stroke-width="1" />`;
    svg += `<text x="${mE - 8}" y="${yy}" dy="0.32em" text-anchor="end" font-size="11" fill="#97897E">${v}</text>`;
  }
  AREAS.forEach((area, i) => {
    const inicio = mE + i * larguraGrupo + (larguraGrupo - larguraBloco) / 2;
    series.forEach((r, j) => {
      const v = r.notas?.[area.chave];
      if (typeof v !== "number") return;
      const x = inicio + j * (larguraBarra + vao);
      const topo = y(v);
      const h = base - topo;
      const raio = Math.min(4, h, larguraBarra / 2);
      const caminho =
        `M${x.toFixed(1)},${base.toFixed(1)} L${x.toFixed(1)},${(topo + raio).toFixed(1)} ` +
        `Q${x.toFixed(1)},${topo.toFixed(1)} ${(x + raio).toFixed(1)},${topo.toFixed(1)} ` +
        `L${(x + larguraBarra - raio).toFixed(1)},${topo.toFixed(1)} ` +
        `Q${(x + larguraBarra).toFixed(1)},${topo.toFixed(1)} ${(x + larguraBarra).toFixed(1)},${(topo + raio).toFixed(1)} ` +
        `L${(x + larguraBarra).toFixed(1)},${base.toFixed(1)} Z`;
      svg += `<path class="barra" d="${caminho}" fill="${corDoAno(r.ano, anosComNotas)}"><title>Enem ${r.ano} · ${area.nome}: ${fmtProva(area.chave, v)}</title></path>`;
    });
    svg += `<text x="${(mE + i * larguraGrupo + larguraGrupo / 2).toFixed(1)}" y="${A - 12}" text-anchor="middle" font-size="12" fill="#6B6259">${area.curto}</text>`;
  });

  const legenda =
    series.length > 1
      ? `<div class="legenda">${series
          .map((r) => `<span><i style="background:${corDoAno(r.ano, anosComNotas)}"></i>Enem ${r.ano}</span>`)
          .join("")}</div>`
      : "";
  const titulo = series.length > 1 ? "Notas por prova, edição a edição" : `Notas por prova — Enem ${series[0].ano}`;
  const sub =
    comNotas.length > 3
      ? "Mostrando as 3 edições mais recentes. Todas estão na tabela abaixo. Passe o mouse numa barra pra ver o valor."
      : "Escala de 0 a 1000. Passe o mouse numa barra pra ver o valor.";

  return `
    <div class="painel-grafico">
      <h3>${titulo}</h3>
      <p class="sub">${sub}</p>
      ${legenda}
      <div class="grafico" role="img" aria-label="${escapeHtml(titulo)}. Valores na tabela a seguir.">
        <svg viewBox="0 0 ${L} ${A}" preserveAspectRatio="xMidYMid meet">${svg}</svg>
      </div>
    </div>`;
}

function htmlTabela(comNotas) {
  const anos = [...comNotas].reverse(); // mais antiga → mais recente
  const cab = anos.map((r) => `<th>${r.ano}</th>`).join("");
  const linhas = AREAS.map(
    (a) => `<tr><td>${a.nome}</td>${anos.map((r) => `<td>${fmtProva(a.chave, r.notas?.[a.chave])}</td>`).join("")}</tr>`
  ).join("");
  const media = `<tr class="linha-media"><td>Média geral</td>${anos.map((r) => `<td>${fmtMedia(r.mediaGeral)}</td>`).join("")}</tr>`;
  return `
    <div class="painel-grafico" style="padding-bottom:12px">
      <h3>Tabela de notas</h3>
      <p class="sub">Todas as edições cadastradas, com a média simples das cinco provas.</p>
      <div class="tabela-rolagem">
        <table class="tabela-notas"><thead><tr><th>Prova</th>${cab}</tr></thead><tbody>${linhas}${media}</tbody></table>
      </div>
    </div>`;
}

function htmlCartaoInscricao(r) {
  const s = r.sisu || {};
  const dados = [];
  if (r.numeroInscricao) dados.push(["Inscrição", r.numeroInscricao]);
  const dias = [r.dia1, r.dia2].filter(Boolean).map(isoParaBr).join(" e ");
  if (dias) dados.push(["Dias de prova", dias]);
  if (r.linguaEstrangeira) dados.push(["Língua estrangeira", r.linguaEstrangeira]);
  const comp = (r.competencias || []).filter((c) => typeof c === "number");
  if (comp.length) dados.push(["Competências (redação)", (r.competencias || []).map((c, i) => `C${i + 1}: ${c ?? "—"}`).join(" · ")]);
  if (s.curso || s.status) {
    const partes = [s.curso, s.turno, SITUACOES_SISU[s.status], typeof s.posicao === "number" ? `posição ${s.posicao}` : null].filter(Boolean);
    dados.push(["Sisu", partes.join(" · ")]);
  }

  return `
    <article class="cartao-inscricao">
      <div class="cartao-inscricao-topo">
        <div>
          <h3>Enem ${r.ano} ${r.treineiro ? '<span class="etiqueta">Treineiro</span>' : ""}</h3>
          <span class="texto-suave">${r.origem === "migrado" ? "Trazido da versão anterior do app" : "Atualizado " + (r.atualizadoEm?.toDate ? "em " + r.atualizadoEm.toDate().toLocaleDateString("pt-BR") : "agora")}</span>
        </div>
        <div class="media-selo">
          <span class="texto-suave">Média geral</span>
          <b>${fmtMedia(r.mediaGeral)}</b>
        </div>
      </div>
      ${
        temNotas(r)
          ? `<div class="notas-grade">${AREAS.map(
              (a) => `<div class="nota-item"><span>${a.curto}</span><b>${fmtProva(a.chave, r.notas?.[a.chave])}</b></div>`
            ).join("")}</div>`
          : '<p class="texto-suave" style="margin:0">Ainda sem notas — quando sair o resultado, anexe o boletim na aba Cadastro.</p>'
      }
      ${dados.length ? `<dl class="dados-lista">${dados.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join("")}</dl>` : ""}
      <div class="acoes-cartao">
        <button class="botao-secundario" type="button" data-editar="${r.ano}">Editar</button>
        <button class="botao-secundario botao-perigo" type="button" data-excluir="${r.ano}">Excluir</button>
      </div>
    </article>`;
}


// ---------------------------------------------------------------------------
// Painel "Seu desempenho" (topo do Feed): notas do último Enem, onde focar,
// conteúdos que mais caem e dicas — a base de estudo está em dicas-enem.js.
// ---------------------------------------------------------------------------
function linkFonte(chave) {
  const f = DICAS.FONTES[chave];
  return f ? `<a href="${escapeHtml(f.url)}" target="_blank" rel="noopener" title="${escapeHtml(f.nome)}">fonte</a>` : "";
}

function htmlBarrasDesempenho(linhas, max) {
  return linhas
    .map((l) => {
      const pct = typeof l.v === "number" ? Math.max(0, Math.min(100, (l.v / max) * 100)) : 0;
      const tag = l.tag ? `<span class="pd-tag pd-tag-${l.tag.tipo}">${l.tag.tipo === "foco" ? "◎ " : "★ "}${escapeHtml(l.tag.texto)}</span>` : "";
      return `
        <div class="pd-linha" title="${escapeHtml(l.nome)}: ${escapeHtml(l.fmt)}">
          <span class="pd-nome">${escapeHtml(l.nome)}</span>
          <span class="pd-trilho"><i style="width:${pct.toFixed(1)}%"></i></span>
          <span class="pd-valor">${escapeHtml(l.fmt)}</span>
          <span class="pd-tag-slot">${tag}</span>
        </div>`;
    })
    .join("");
}

// Resumido: 3 conteúdos de cada disciplina à mostra, o resto num "ver mais".
function htmlConteudosDaArea(chave, resumido = true) {
  const area = DICAS.CONTEUDOS[chave];
  if (!area) return "";
  if (resumido) {
    const topo = area.grupos.map((g) => ({ ...g, itens: g.itens.slice(0, 3) }));
    return htmlGruposConteudo(topo) +
      `<details class="pd-mais"><summary>Ver todos os conteúdos</summary>${htmlGruposConteudo(area.grupos.map((g) => ({ ...g, itens: g.itens.slice(3), inicio: 4 })).filter((g) => g.itens.length))}</details>`;
  }
  return htmlGruposConteudo(area.grupos);
}

function htmlGruposConteudo(grupos) {
  return grupos
    .map(
      (g) => `
      <div class="pd-grupo">
        <div class="pd-grupo-topo"><b>${escapeHtml(g.disciplina)}</b> ${linkFonte(g.fonte)}</div>
        <ol${g.inicio ? ` start="${g.inicio}"` : ""}>${g.itens
          .slice(0, 5)
          .map(
            (i) =>
              `<li><div class="pd-item"><span>${escapeHtml(i.t)}${i.d ? ` <small>— ${escapeHtml(i.d)}</small>` : ""}</span>${
                typeof i.pct === "number" ? `<em>${i.pct.toLocaleString("pt-BR")}%</em>` : ""
              }</div></li>`
          )
          .join("")}</ol>
      </div>`
    )
    .join("");
}

function renderizarDesempenho() {
  const alvo = $("painel-desempenho");
  if (!alvo) return;
  const comNotas = todasInscricoes.filter(temNotas);
  const estrategia = `
    <details class="pd-estrategia">
      <summary>Estratégia de prova e como a TRI calcula a nota</summary>
      <ul>${DICAS.ESTRATEGIA.map((e) => `<li><b>${escapeHtml(e.t)}.</b> ${escapeHtml(e.d)} ${linkFonte(e.fonte)}</li>`).join("")}</ul>
      <p>${escapeHtml(DICAS.TRI)} ${linkFonte("agenciaTri")}</p>
    </details>`;
  const rodape = `<p class="pd-rodape">Conteúdos e dicas tirados de sites de preparação para o Enem e de fontes oficiais (percentuais publicados pelas próprias fontes, dentro de cada disciplina). Base atualizada em ${DICAS.ATUALIZADO_EM}.</p>`;

  if (comNotas.length === 0) {
    alvo.innerHTML = `
      <section class="painel-desempenho">
        <div class="pd-topo"><div><h2>Seu desempenho</h2><p class="sub">Cadastre o boletim de um Enem pra ver onde focar os estudos.</p></div>
          <button class="botao" type="button" data-pd-ir="cadastro">Anexar boletim</button></div>
        ${estrategia}
        ${rodape}
      </section>`;
    alvo.querySelector("[data-pd-ir]").addEventListener("click", () => { mostrarPagina("inscricao"); mostrarSubaba("cadastro"); });
    return;
  }

  const atual = comNotas[0];
  const anterior = comNotas[1];
  const objetivas = AREAS.filter((a) => a.chave !== "redacao" && typeof atual.notas?.[a.chave] === "number");
  const ordenadas = [...objetivas].sort((a, b) => atual.notas[a.chave] - atual.notas[b.chave]);
  const maisBaixa = ordenadas[0];
  const maisAlta = ordenadas[ordenadas.length - 1];
  const equilibrado = ordenadas.length > 1 && atual.notas[maisAlta.chave] - atual.notas[maisBaixa.chave] < 20;
  // Foco: as duas mais baixas (ou uma, se só tiver duas provas), mais qualquer
  // área que caiu mais de 20 pontos em relação à edição anterior.
  const foco = new Set(equilibrado ? [] : ordenadas.slice(0, Math.min(2, ordenadas.length - 1)).map((a) => a.chave));
  const quedas = anterior
    ? objetivas.filter((a) => typeof anterior.notas?.[a.chave] === "number" && atual.notas[a.chave] - anterior.notas[a.chave] <= -20).map((a) => a.chave)
    : [];
  quedas.forEach((k) => foco.add(k));

  const linhasNotas = AREAS.filter((a) => typeof atual.notas?.[a.chave] === "number").map((a) => {
    let tag = null;
    if (a.chave !== "redacao" && foco.has(a.chave)) tag = { tipo: "foco", texto: quedas.includes(a.chave) && !ordenadas.slice(0, 2).some((o) => o.chave === a.chave) ? "caiu" : "foco" };
    else if (!equilibrado && maisAlta && a.chave === maisAlta.chave) tag = { tipo: "forte", texto: "mais forte" };
    return { nome: a.curto, v: atual.notas[a.chave], fmt: fmtProva(a.chave, atual.notas[a.chave]), tag };
  });

  const comps = (atual.competencias || []).map((c, i) => ({ n: i + 1, v: c })).filter((c) => typeof c.v === "number");
  const compFraca = comps.length ? [...comps].sort((a, b) => a.v - b.v)[0] : null;
  const linhasComp = comps.map((c) => ({
    nome: `C${c.n} · ${DICAS.COMPETENCIAS[c.n - 1].curto}`,
    v: c.v,
    fmt: String(c.v),
    tag: compFraca && c.n === compFraca.n && compFraca.v < 200 ? { tipo: "foco", texto: "foco" } : c.v === 200 ? { tipo: "forte", texto: "nota máxima" } : null,
  }));

  const delta = anterior ? htmlDelta(atual.mediaGeral, anterior.mediaGeral, anterior.ano) : "";

  const cartoesFoco = [...foco]
    .map((k) => {
      const a = AREAS.find((x) => x.chave === k);
      const motivo = quedas.includes(k) && anterior
        ? `caiu ${fmtDelta(Math.round((atual.notas[k] - anterior.notas[k]) * 10) / 10).replace("−", "")} pontos desde ${anterior.ano}`
        : k === maisBaixa.chave ? "sua nota mais baixa" : "segunda nota mais baixa";
      return `
        <article class="pd-cartao">
          <h4>${escapeHtml(a.nome)} <span>${fmtProva(k, atual.notas[k])} · ${escapeHtml(motivo)}</span></h4>
          <p class="pd-sub">O que mais cai no Enem nessa área:</p>
          ${htmlConteudosDaArea(k)}
        </article>`;
    })
    .join("");

  let cartaoRedacao = "";
  if (compFraca && compFraca.v < 200) {
    const c = DICAS.COMPETENCIAS[compFraca.n - 1];
    cartaoRedacao = `
      <article class="pd-cartao">
        <h4>Redação — Competência ${c.n} <span>${compFraca.v} de 200 · sua competência mais baixa</span></h4>
        <p class="pd-sub">${escapeHtml(c.nome)}: avalia ${escapeHtml(c.avalia)}. ${linkFonte(c.fonte)}</p>
        <ul class="pd-dicas">${c.dicas.map((d) => `<li>${escapeHtml(d)}</li>`).join("")}</ul>
      </article>`;
  } else if (!comps.length && typeof atual.notas?.redacao === "number" && atual.notas.redacao < 1000) {
    cartaoRedacao = `
      <article class="pd-cartao">
        <h4>Redação <span>${fmtProva("redacao", atual.notas.redacao)} · anexe a Vista Pedagógica pra ver por competência</span></h4>
        <ul class="pd-dicas">${DICAS.COMPETENCIAS.map((c) => `<li><b>C${c.n} · ${escapeHtml(c.nome)}:</b> ${escapeHtml(c.dicas[0])}</li>`).join("")}</ul>
        <p class="pd-sub">${escapeHtml(DICAS.ZERA_REDACAO)} ${linkFonte("agenciaCartilha")}</p>
      </article>`;
  }

  const semFoco = !cartoesFoco && !cartaoRedacao
    ? `<p class="pd-sub">Suas notas estão equilibradas entre as áreas${equilibrado ? " (diferença menor que 20 pontos)" : ""}. Veja abaixo o que mais cai em cada uma e a estratégia de prova.</p>`
    : "";

  alvo.innerHTML = `
    <section class="painel-desempenho">
      <div class="pd-topo">
        <div>
          <h2>Seu desempenho</h2>
          <p class="sub">Enem ${atual.ano}${anterior ? ` · comparado com ${anterior.ano}` : ""}</p>
        </div>
        <div class="pd-media">
          <span>Média geral</span>
          <b>${fmtMedia(atual.mediaGeral)}</b>
          ${delta ? `<small>${delta}</small>` : ""}
        </div>
      </div>
      <div class="pd-grade ${linhasComp.length ? "" : "pd-grade-uma"}">
        <div class="pd-bloco">
          <h3>Notas por prova <small>0 a 1000</small></h3>
          ${htmlBarrasDesempenho(linhasNotas, 1000)}
        </div>
        ${linhasComp.length ? `<div class="pd-bloco"><h3>Redação por competência <small>0 a 200</small></h3>${htmlBarrasDesempenho(linhasComp, 200)}</div>` : ""}
      </div>
      <h3 class="pd-titulo-foco">Onde focar</h3>
      ${semFoco}
      <div class="pd-cartoes">${cartoesFoco}${cartaoRedacao}</div>
      <details class="pd-estrategia">
        <summary>O que mais cai nas outras áreas</summary>
        <div class="pd-cartoes">${AREAS.filter((a) => a.chave !== "redacao" && !foco.has(a.chave))
          .map((a) => `<article class="pd-cartao"><h4>${escapeHtml(a.nome)}${typeof atual.notas?.[a.chave] === "number" ? ` <span>${fmtProva(a.chave, atual.notas[a.chave])}</span>` : ""}</h4>${htmlConteudosDaArea(a.chave)}</article>`)
          .join("")}</div>
      </details>
      ${estrategia}
      ${rodape}
    </section>`;
}

// ---------------------------------------------------------------------------
// Painel da direita (telas largas)
// ---------------------------------------------------------------------------
const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function renderizarLateral() {
  const hoje = inicioDoDia(new Date());
  const proximos = prazosValidos()
    .filter((p) => diaDoPrazo(p.limite || p.quando) >= hoje && !prazosConfirmados.has(p.id))
    .sort((a, b) => Math.max(diaDoPrazo(a.quando), hoje) - Math.max(diaDoPrazo(b.quando), hoje) || a.limite - b.limite)
    .slice(0, 5);

  $("lateral-prazos").innerHTML = proximos.length
    ? proximos
        .map((p) => {
          const info = infoPrazo(p);
          const oque = info.oQueFazer.join(" + ");
          const desc = oque.length > 90 ? oque.slice(0, 88).replace(/\s\S*$/, "").replace(/\s*\+$/, "") + "…" : oque;
          // Em andamento: a caixa mostra o último dia ("até 10 set").
          const emAndamento = diaDoPrazo(p.quando) < hoje;
          const dia = emAndamento ? p.limite : p.quando;
          const extra = [p.fim || p.horario ? textoQuando(p, false) : "", p.secao ? p.secao.replace(/^cronograma d[oa]s?\s+/i, "").replace(/^procedimento\s+(de|para)\s+/i, "") : ""]
            .filter(Boolean).join(" · ");
          const quando = extra ? `<span class="quando-lateral">${escapeHtml(extra.length > 70 ? extra.slice(0, 68) + "…" : extra)}</span>` : "";
          return `
            <div class="item-lateral">
              <div class="data-caixa">${emAndamento || p.ate ? "<small>até</small>" : ""}<b>${dia.getUTCDate()}</b><small>${MESES_CURTOS[dia.getUTCMonth()]}</small></div>
              <div><strong>${escapeHtml(info.titulo)} · ${escapeHtml(p.fonte || "")}</strong>${escapeHtml(desc)}${quando}</div>
            </div>`;
        })
        .join("")
    : '<p class="texto-suave" style="margin:0">Nenhum prazo pendente pela frente. 🎉</p>';

  const ultimo = todasInscricoes.find(temNotas);
  if (ultimo) {
    const anterior = todasInscricoes.filter(temNotas)[1];
    $("lateral-enem").innerHTML = `
      <div class="texto-suave">Média geral · Enem ${ultimo.ano}</div>
      <div class="nota-destaque">${fmtMedia(ultimo.mediaGeral)}</div>
      ${anterior ? `<div class="texto-suave">${htmlDelta(ultimo.mediaGeral, anterior.mediaGeral, anterior.ano)}</div>` : ""}
      <div class="mini-notas">${AREAS.map((a) => `<span>${a.curto}</span><span>${fmtProva(a.chave, ultimo.notas?.[a.chave])}</span>`).join("")}</div>
      <button class="link-lateral" type="button" data-ir="acompanhamento">Ver acompanhamento →</button>`;
  } else {
    $("lateral-enem").innerHTML = `
      <p class="texto-suave" style="margin:0">Anexe o PDF do seu boletim pra acompanhar suas notas por aqui.</p>
      <button class="link-lateral" type="button" data-ir="cadastro">Cadastrar inscrição →</button>`;
  }
  $("lateral-enem").querySelector("[data-ir]").addEventListener("click", (e) => {
    mostrarPagina("inscricao");
    mostrarSubaba(e.currentTarget.dataset.ir);
  });
}
$("lateral-ver-prazos").addEventListener("click", () => mostrarPagina("prazos"));

// ---------------------------------------------------------------------------
// Ajustes
// ---------------------------------------------------------------------------
async function carregarConfig() {
  const prefs = perfilAtual.preferenciasNotificacao || {};
  $("config-push").checked = prefs.push !== false;
  $("config-email-toggle").checked = prefs.email !== false;
  $("config-urgente").checked = prefs.alertaUrgente !== false;
  document.querySelectorAll("[data-grupo-aviso]").forEach((c) => {
    c.checked = prefs.grupos?.[c.dataset.grupoAviso] !== false;
  });
}

$("form-config").addEventListener("submit", async (e) => {
  e.preventDefault();
  const user = auth.currentUser;
  if (!user) return;
  await updateDoc(doc(db, "usuarios", user.uid), {
    preferenciasNotificacao: {
      push: $("config-push").checked,
      email: $("config-email-toggle").checked,
      alertaUrgente: $("config-urgente").checked,
      antecedenciaDias: [5, 2],
      grupos: Object.fromEntries([...document.querySelectorAll("[data-grupo-aviso]")].map((c) => [c.dataset.grupoAviso, c.checked])),
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
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
    if (token) {
      await setDoc(doc(db, "usuarios", user.uid, "fcmTokens", token), { criadoEm: serverTimestamp() });
    }
  } catch (err) {
    console.warn("Push não disponível neste navegador:", err);
  }
}
