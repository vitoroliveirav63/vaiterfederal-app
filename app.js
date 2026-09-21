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
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import {
  getMessaging,
  getToken,
  isSupported,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging.js";
import { lerPdfDoEnem } from "./leitor-pdf.js";

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
  escutar("prazos", query(collection(db, "prazos"), orderBy("data", "asc"), limit(400)), (snap) => {
    todosOsPrazos = snap.docs.map((d) => {
      const dados = d.data();
      return { id: d.id, ...dados, quando: dados.data?.toDate ? dados.data.toDate() : null };
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
      ${imagens[0] ? `<div class="cartao-imagem"><img src="${escapeHtml(imagens[0])}" alt="" loading="lazy" /></div>` : ""}
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
let filtroPrazoAtual = "proximos";
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

function situacaoDoPrazo(quando) {
  const dias = Math.round((diaDoPrazo(quando) - inicioDoDia(new Date())) / UM_DIA);
  if (dias < 0) return { estado: "passou", texto: dias === -1 ? "Foi ontem" : `Passou há ${Math.abs(dias)} dias` };
  if (dias === 0) return { estado: "hoje", texto: "É hoje" };
  if (dias === 1) return { estado: "perto", texto: "É amanhã" };
  if (dias <= 15) return { estado: "perto", texto: `Faltam ${dias} dias` };
  return { estado: "longe", texto: `Faltam ${dias} dias` };
}

function renderizarPrazos() {
  const lista = $("lista-eventos");
  const hoje = inicioDoDia(new Date());
  let itens = todosOsPrazos.filter((p) => p.quando);

  if (filtroPrazoAtual === "proximos") {
    itens = itens.filter((p) => diaDoPrazo(p.quando) >= hoje).sort((a, b) => a.quando - b.quando);
  } else if (filtroPrazoAtual === "passados") {
    itens = itens.filter((p) => diaDoPrazo(p.quando) < hoje).sort((a, b) => b.quando - a.quando);
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
      await setDoc(doc(db, "usuarios", u.uid, "confirmacoes", btn.dataset.id), { confirmadoEm: serverTimestamp() });
    });
  });
}

document.querySelectorAll(".chip-prazo").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".chip-prazo").forEach((c) => c.classList.remove("chip-ativo"));
    chip.classList.add("chip-ativo");
    filtroPrazoAtual = chip.dataset.prazoFiltro;
    renderizarPrazos();
  });
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
  "local-escola": "insc-escola",
  "local-endereco": "insc-endereco",
  "local-municipio": "insc-municipio",
  "local-sala": "insc-sala",
  "local-bloco": "insc-bloco",
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
    local: {
      escola: textoOuNull("insc-escola"),
      endereco: textoOuNull("insc-endereco"),
      municipio: textoOuNull("insc-municipio"),
      sala: textoOuNull("insc-sala"),
      bloco: textoOuNull("insc-bloco"),
    },
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
  const l = r.local || {};
  definir("insc-escola", l.escola);
  definir("insc-endereco", l.endereco);
  definir("insc-municipio", l.municipio);
  definir("insc-sala", l.sala);
  definir("insc-bloco", l.bloco);
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

  for (const arquivo of pdfs) {
    statusPdf("lendo", `Lendo ${arquivo.name}…`);
    try {
      const lido = await lerPdfDoEnem(arquivo, (aviso) => statusPdf("lendo", `${arquivo.name}: ${aviso}`));
      if (lido.camposEncontrados.length === 0) {
        semTexto.push(arquivo.name);
        continue;
      }
      acumulado = mesclarLeitura(acumulado, lido);
      lido.camposEncontrados.forEach((c) => encontrados.add(c));
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

  // Se já existe inscrição desse ano, parte dela e completa com o PDF.
  const existente = acumulado.ano ? todasInscricoes.find((i) => i.ano === acumulado.ano) : null;
  const final = mesclarLeitura(existente || {}, acumulado);
  if (existente?.sisu) final.sisu = existente.sisu;
  preencherFormulario(final);
  destacarCampos(encontrados);

  let msg = `Li ${encontrados.size} informaç${encontrados.size === 1 ? "ão" : "ões"} de ${pdfs.length === 1 ? pdfs[0].name : pdfs.length + " arquivos"}. Confira os campos destacados e clique em Salvar.`;
  if (existente) msg += ` Você já tinha o Enem ${existente.ano} cadastrado — juntei os dados novos com os que já estavam lá.`;
  if (!acumulado.ano) msg += " Não achei o ano no PDF: preencha o campo Ano antes de salvar.";
  if (semTexto.length) msg += ` (Sem texto reconhecível: ${semTexto.join(", ")}.)`;
  statusPdf("ok", msg);
  $("form-inscricao").scrollIntoView({ behavior: "smooth", block: "start" });
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
  showMsg("msg-inscricao-salva", msg);
  limparDestaques();
  statusPdf(null);
  setTimeout(() => {
    showMsg("msg-inscricao-salva", "");
    mostrarSubaba("acompanhamento");
  }, 1600);
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

function temNotas(r) {
  return AREAS.some((a) => typeof r.notas?.[a.chave] === "number");
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
  const l = r.local || {};
  const s = r.sisu || {};
  const dados = [];
  if (r.numeroInscricao) dados.push(["Inscrição", r.numeroInscricao]);
  const local = [l.escola, l.endereco, l.municipio].filter(Boolean).join(" — ");
  if (local) dados.push(["Local de prova", local]);
  const salaBloco = [l.sala ? `Sala ${l.sala}` : null, l.bloco ? `Bloco ${l.bloco}` : null].filter(Boolean).join(" · ");
  if (salaBloco) dados.push(["Sala", salaBloco]);
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
// Painel da direita (telas largas)
// ---------------------------------------------------------------------------
const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function renderizarLateral() {
  const hoje = inicioDoDia(new Date());
  const proximos = todosOsPrazos
    .filter((p) => p.quando && diaDoPrazo(p.quando) >= hoje && !prazosConfirmados.has(p.id))
    .sort((a, b) => a.quando - b.quando)
    .slice(0, 5);

  $("lateral-prazos").innerHTML = proximos.length
    ? proximos
        .map((p) => {
          const desc = (p.descricao || "").length > 90 ? p.descricao.slice(0, 88).trim() + "…" : p.descricao || "";
          return `
            <div class="item-lateral">
              <div class="data-caixa"><b>${p.quando.getUTCDate()}</b><small>${MESES_CURTOS[p.quando.getUTCMonth()]}</small></div>
              <div><strong>${escapeHtml(p.categoria || "Prazo")} · ${escapeHtml(p.fonte || "")}</strong>${escapeHtml(desc)}</div>
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
