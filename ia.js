// ---------------------------------------------------------------------------
// Aba "IA" — tira-dúvidas de questões do Enem e correção de redação.
//
// Usa o Firebase AI Logic com a Gemini Developer API (plano gratuito, funciona
// no Spark, sem cartão). O Firebase exige App Check pra IA: ele confere que o
// pedido veio do NOSSO app (e não de alguém usando a chave pra gastar a cota).
// No site, o App Check usa o reCAPTCHA Enterprise — a chave vai aqui embaixo.
//
// Carregado só quando a aba é aberta, pra não pesar o resto do app.
// ---------------------------------------------------------------------------
import { getApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getFirestore, collection, addDoc, deleteDoc, doc, query, orderBy, limit, onSnapshot, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

// Chave do reCAPTCHA Enterprise (tipo "site"/Web, pontuação, sem caixinha).
// É pública — pode ficar no código. Vazia = a aba mostra o passo a passo.
export const CHAVE_RECAPTCHA = "6LcQDMgtAAAAAMdTg_nLKVPTo7g4ErJ5eFS4FOkk";

// Modelos, do preferido pro reserva (se um sair do ar, tenta o próximo).
const MODELOS = ["gemini-3.8-flash", "gemini-3.5-flash-lite"];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------------------------------------------------------------------------
// Instruções pra IA
// ---------------------------------------------------------------------------
const SISTEMA_DUVIDAS = `Você é um professor particular especialista no Enem (Exame Nacional do Ensino Médio) e responde sempre em português do Brasil, com linguagem clara, como quem explica para um estudante que quer entender de verdade.

Quando o estudante mandar uma questão (em texto ou foto):
1. Diga a área, a disciplina e o conteúdo cobrado; se der, a competência/habilidade da Matriz de Referência do Enem.
2. Resolva passo a passo, mostrando o raciocínio e as contas.
3. Indique a alternativa correta e explique, em uma linha cada, por que as outras estão erradas.
4. Destaque o conceito-chave ou a "pegadinha" da questão.
5. Termine com uma dica curta do que revisar.

Quando for uma dúvida de conteúdo (sem questão), explique com um exemplo no estilo Enem.

Regras:
- Se a foto estiver ilegível, cortada, ou faltar informação (texto-base, gráfico, alternativas), diga exatamente o que falta em vez de inventar.
- Se não tiver certeza da resposta, diga isso com clareza e mostre o caminho mais provável.
- Nunca invente gabarito oficial, ano de prova ou número da questão.
- Escreva fórmulas em texto simples (x², √, ×, ÷, a/b, ≥, π), NUNCA em LaTeX.
- Use títulos curtos (###), listas e **negrito** só quando ajudar. Seja direto: nada de introduções longas.`;

const SISTEMA_REDACAO = `Você é um corretor experiente de redações do Enem, treinado na grade oficial do Inep, e corrige como a banca: nem generoso, nem severo demais. Responda em português do Brasil, no formato JSON pedido.

GRADE (cada competência vale 0, 40, 80, 120, 160 ou 200 — nenhum outro valor):
C1 — Domínio da modalidade escrita formal da língua portuguesa.
 200: excelente domínio; desvios gramaticais ou de convenções da escrita só como excepcionalidade e sem reincidência.
 160: bom domínio, com poucos desvios. 120: domínio mediano, com alguns desvios. 80: domínio insuficiente, com muitos desvios.
 40: domínio precário, de forma sistemática, com desvios diversificados e frequentes. 0: desconhecimento da modalidade escrita formal.
C2 — Compreender a proposta e aplicar conceitos das várias áreas do conhecimento para desenvolver o tema, nos limites do texto dissertativo-argumentativo.
 200: argumentação consistente, com repertório sociocultural produtivo (legitimado, pertinente ao tema e usado no argumento), e excelente domínio do tipo textual.
 160: argumentação consistente e bom domínio do tipo textual (proposição, argumentação e conclusão).
 120: argumentação previsível e domínio mediano do tipo textual. 80: recorre à cópia de trechos dos textos motivadores ou tem domínio insuficiente do tipo textual.
 40: tangencia o tema, ou domínio precário do tipo textual com traços de outros tipos. 0: fuga ao tema ou não atende ao tipo dissertativo-argumentativo (a redação ZERA).
C3 — Selecionar, relacionar, organizar e interpretar informações, fatos, opiniões e argumentos em defesa de um ponto de vista.
 200: informações relacionadas ao tema de forma consistente e organizada, configurando autoria. 160: organizadas, com indícios de autoria.
 120: limitadas aos argumentos dos textos motivadores e pouco organizadas. 80: desorganizadas ou contraditórias, limitadas aos motivadores.
 40: pouco relacionadas ao tema, ou incoerentes, sem defesa de um ponto de vista. 0: não relacionadas ao tema, sem ponto de vista.
C4 — Conhecimento dos mecanismos linguísticos necessários para a construção da argumentação (coesão).
 200: articula bem as partes do texto e tem repertório diversificado de recursos coesivos. 160: articula com poucas inadequações e repertório diversificado.
 120: articula de forma mediana, com inadequações e repertório pouco diversificado. 80: articula de forma insuficiente, com muitas inadequações e repertório limitado.
 40: articula de forma precária. 0: não articula as informações.
C5 — Elaborar proposta de intervenção para o problema abordado, respeitando os direitos humanos.
 Elementos: agente, ação, modo/meio, finalidade/efeito e detalhamento (de qualquer um deles).
 200: proposta muito bem elaborada, detalhada, relacionada ao tema e articulada à discussão (os 5 elementos). 160: bem elaborada (4 elementos).
 120: mediana (3 elementos). 80: insuficiente (2 elementos) ou não articulada com a discussão. 40: vaga ou precária (1 elemento).
 0: não apresenta proposta ou a proposta desrespeita os direitos humanos.

ZERA A REDAÇÃO INTEIRA: fuga total ao tema; não atender ao tipo dissertativo-argumentativo; até 7 linhas (texto insuficiente — no digitado, menos de uns 70 palavras); cópia integral dos textos motivadores; texto predominantemente em outra língua; identificação do candidato; impropérios, desenhos ou partes desconectadas propositalmente.

COMO CORRIGIR:
- Se vier FOTO de redação manuscrita, primeiro transcreva fielmente no campo "transcricao" (mantenha os erros do autor; use [ilegível] onde não der pra ler) e corrija a transcrição. Se a letra estiver ilegível demais, diga isso no resumo e não chute notas altas.
- Compare com o TEMA informado. Se o tema não foi informado, deduza pelo texto e diga isso em "tema_identificado".
- Em cada competência: escolha o nível pela grade, justifique citando o texto, e liste problemas com o TRECHO EXATO copiado da redação, o problema e uma sugestão de reescrita concreta.
- Na C1, aponte os desvios reais (concordância, regência, crase, pontuação, ortografia, acentuação, registro informal), sem inventar.
- Na C5, preencha os 5 elementos da proposta com o que o texto traz ou "não encontrado".
- "total" é a soma das 5 notas. "proximos_passos": 3 a 5 ações práticas pra subir a nota na próxima redação.
- Não elogie nem critique de forma genérica: seja específico e honesto. A nota é uma estimativa de treino, não a nota oficial.`;

// ---------------------------------------------------------------------------
// Firebase AI (carregado só quando precisa)
// ---------------------------------------------------------------------------
let ai = null;
let SchemaCls = null;
let erroConfig = null;

async function prepararIA() {
  if (ai) return ai;
  if (!CHAVE_RECAPTCHA) {
    erroConfig = "sem-chave";
    throw new Error("sem-chave");
  }
  const app = getApp();
  const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import("https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js");
  try {
    initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(CHAVE_RECAPTCHA), isTokenAutoRefreshEnabled: true });
  } catch (e) {
    // Já inicializado (a aba foi aberta de novo): segue.
    if (!/already|já/i.test(String(e?.message))) throw e;
  }
  const mod = await import("https://www.gstatic.com/firebasejs/12.19.0/firebase-ai.js");
  SchemaCls = mod.Schema;
  ai = { mod, inst: mod.getAI(app, { backend: new mod.GoogleAIBackend(), useLimitedUseAppCheckTokens: true }) };
  return ai;
}

function modelo(nomeModelo, sistema, extras = {}) {
  return ai.mod.getGenerativeModel(ai.inst, { model: nomeModelo, systemInstruction: sistema, ...extras });
}

// Tenta os modelos em ordem; só passa pro próximo se o erro for "modelo não existe".
async function comModelos(fn) {
  let ultimo;
  for (const nome of MODELOS) {
    try {
      return await fn(nome);
    } catch (e) {
      ultimo = e;
      if (!/not found|404|is not supported|unknown model|was not found/i.test(String(e?.message))) throw e;
    }
  }
  throw ultimo;
}

function mensagemDeErro(e) {
  const m = String(e?.message || e);
  if (m === "sem-chave") return "A IA ainda não foi ativada neste app. Veja o passo a passo acima.";
  if (/dynamically imported module|importing a module script failed/i.test(m)) return "Não consegui carregar a IA (sem internet?). Recarregue a página e tente de novo.";
  if (/app.?check|appcheck|attestation|recaptcha/i.test(m)) return "O App Check recusou o pedido. Confira se a chave do reCAPTCHA está certa e se o domínio vitoroliveirav63.github.io foi adicionado nela.";
  if (/429|quota|resource.?exhausted|rate/i.test(m)) return "O limite gratuito da IA foi atingido por agora. Espere alguns minutos e tente de novo.";
  if (/api.?not.?enabled|has not been used|PERMISSION_DENIED|403/i.test(m)) return "A IA não está ligada no Firebase (AI Logic → Gemini Developer API). Veja o passo a passo.";
  if (/safety|blocked/i.test(m)) return "A IA não respondeu esse conteúdo por segurança. Tente reformular.";
  if (/network|fetch|failed to fetch/i.test(m)) return "Sem conexão com a IA. Confira a internet e tente de novo.";
  return `A IA não conseguiu responder agora (${m.slice(0, 160)}).`;
}

// ---------------------------------------------------------------------------
// Imagens: reduz pra no máximo 1600px e JPEG, pra caber e ir rápido.
// ---------------------------------------------------------------------------
async function imagemParaParte(arquivo) {
  const bitmap = await createImageBitmap(arquivo);
  const escala = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bitmap.width * escala);
  c.height = Math.round(bitmap.height * escala);
  c.getContext("2d").drawImage(bitmap, 0, 0, c.width, c.height);
  const dataUrl = c.toDataURL("image/jpeg", 0.85);
  return { inlineData: { mimeType: "image/jpeg", data: dataUrl.split(",")[1] }, previa: dataUrl };
}

// Markdown simples → HTML seguro (títulos, negrito, itálico, listas, código).
function md(texto) {
  const linhas = esc(texto).split(/\r?\n/);
  let html = "";
  let lista = null;
  const inline = (t) => t
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  const fechar = () => { if (lista) { html += `</${lista}>`; lista = null; } };
  for (const l of linhas) {
    let m;
    if ((m = l.match(/^\s*#{1,4}\s+(.*)$/))) { fechar(); html += `<h4>${inline(m[1])}</h4>`; continue; }
    if ((m = l.match(/^\s*[-*•]\s+(.*)$/))) { if (lista !== "ul") { fechar(); html += "<ul>"; lista = "ul"; } html += `<li>${inline(m[1])}</li>`; continue; }
    if ((m = l.match(/^\s*\d+[.)]\s+(.*)$/))) { if (lista !== "ol") { fechar(); html += "<ol>"; lista = "ol"; } html += `<li>${inline(m[1])}</li>`; continue; }
    fechar();
    if (l.trim()) html += `<p>${inline(l)}</p>`;
  }
  fechar();
  return html;
}

// ---------------------------------------------------------------------------
// Estado e montagem da aba
// ---------------------------------------------------------------------------
let montado = false;
let pararHistoricos = [];

export function abrirAbaIA() {
  if (!montado) {
    montado = true;
    montarEventos();
  }
  $("ia-config").classList.toggle("oculto", Boolean(CHAVE_RECAPTCHA));
  escutarHistoricos();
}

function mostrarSubabaIA(nome) {
  ["duvidas", "redacao"].forEach((n) => {
    $("ia-painel-" + n).classList.toggle("oculto", n !== nome);
    $("ia-subaba-" + n).classList.toggle("aba-ativa", n === nome);
    $("ia-subaba-" + n).setAttribute("aria-selected", String(n === nome));
  });
}

function escutarHistoricos() {
  const user = getAuth().currentUser;
  if (!user || pararHistoricos.length) return;
  const db = getFirestore();
  pararHistoricos.push(onSnapshot(query(collection(db, "usuarios", user.uid, "redacoes"), orderBy("criadoEm", "desc"), limit(30)), (snap) => {
    historicoRedacoes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderizarHistoricoRedacoes();
  }, () => {}));
  pararHistoricos.push(onSnapshot(query(collection(db, "usuarios", user.uid, "duvidas"), orderBy("criadoEm", "desc"), limit(20)), (snap) => {
    historicoDuvidas = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderizarHistoricoDuvidas();
  }, () => {}));
}

export function sairDaIA() {
  pararHistoricos.forEach((f) => f());
  pararHistoricos = [];
  conversa = [];
  chat = null;
}

// ---------------------------------------------------------------------------
// Dúvidas (conversa)
// ---------------------------------------------------------------------------
let conversa = []; // {papel: "voce"|"ia", texto, previas[]}
let chat = null;
let imagensDuvida = [];
let historicoDuvidas = [];

function renderizarConversa() {
  const alvo = $("ia-conversa");
  if (!conversa.length) {
    alvo.innerHTML = `<div class="ia-vazio">Mande uma questão (texto ou foto/print) ou uma dúvida de conteúdo. Dá pra continuar perguntando em cima da resposta.</div>`;
    return;
  }
  alvo.innerHTML = conversa.map((m) => `
    <div class="ia-msg ia-msg-${m.papel}">
      <div class="ia-msg-autor">${m.papel === "voce" ? "Você" : "IA"}</div>
      ${(m.previas || []).map((p) => `<img class="ia-previa" src="${p}" alt="Imagem enviada" />`).join("")}
      <div class="ia-msg-texto">${m.papel === "ia" ? (m.carregando ? '<span class="ia-digitando">Pensando…</span>' : md(m.texto)) : `<p>${esc(m.texto).replace(/\n/g, "<br />")}</p>`}</div>
    </div>`).join("");
  alvo.scrollTop = alvo.scrollHeight;
}

function renderizarPreviasDuvida() {
  $("ia-duvida-previas").innerHTML = imagensDuvida.map((img, i) => `
    <span class="ia-miniatura"><img src="${img.previa}" alt="" /><button type="button" data-tirar="${i}" aria-label="Tirar imagem">×</button></span>`).join("");
  $("ia-duvida-previas").querySelectorAll("[data-tirar]").forEach((b) => b.addEventListener("click", () => {
    imagensDuvida.splice(Number(b.dataset.tirar), 1);
    renderizarPreviasDuvida();
  }));
}

async function enviarDuvida(e) {
  e.preventDefault();
  const texto = $("ia-duvida-texto").value.trim();
  if (!texto && !imagensDuvida.length) return;
  const botao = $("ia-duvida-enviar");
  botao.disabled = true;
  const imagens = imagensDuvida;
  imagensDuvida = [];
  renderizarPreviasDuvida();
  $("ia-duvida-texto").value = "";
  conversa.push({ papel: "voce", texto: texto || "(questão na imagem)", previas: imagens.map((i) => i.previa) });
  const resposta = { papel: "ia", texto: "", carregando: true };
  conversa.push(resposta);
  renderizarConversa();

  try {
    await prepararIA();
    const partes = [];
    if (texto) partes.push({ text: texto });
    else partes.push({ text: "Resolva e explique esta questão do Enem." });
    imagens.forEach((i) => partes.push({ inlineData: i.inlineData }));

    const resultado = await comModelos(async (nome) => {
      if (!chat || chat.modelo !== nome) {
        const m = modelo(nome, SISTEMA_DUVIDAS, { generationConfig: { temperature: 0.3 } });
        chat = { modelo: nome, sessao: m.startChat({ history: [] }) };
      }
      const stream = await chat.sessao.sendMessageStream(partes);
      resposta.carregando = false;
      for await (const pedaco of stream.stream) {
        resposta.texto += pedaco.text();
        renderizarConversa();
      }
      return (await stream.response).text();
    });
    resposta.texto = resultado || resposta.texto;
    resposta.carregando = false;
    renderizarConversa();
    salvarDuvida(texto, imagens.length, resposta.texto);
  } catch (erro) {
    if (String(erro?.message) !== "sem-chave") console.error("IA (dúvida):", erro);
    resposta.carregando = false;
    resposta.texto = `⚠️ ${mensagemDeErro(erro)}`;
    renderizarConversa();
    chat = null;
  } finally {
    botao.disabled = false;
  }
}

async function salvarDuvida(pergunta, qtdImagens, resposta) {
  const user = getAuth().currentUser;
  if (!user || !resposta) return;
  try {
    await addDoc(collection(getFirestore(), "usuarios", user.uid, "duvidas"), {
      pergunta: (pergunta || "(questão enviada por imagem)").slice(0, 3000),
      imagens: qtdImagens,
      resposta: resposta.slice(0, 20000),
      criadoEm: serverTimestamp(),
    });
  } catch (e) {
    console.warn("Não salvei a dúvida:", e);
  }
}

function renderizarHistoricoDuvidas() {
  const alvo = $("ia-duvidas-historico");
  if (!alvo) return;
  if (!historicoDuvidas.length) {
    alvo.innerHTML = '<p class="texto-suave">As dúvidas respondidas ficam guardadas aqui.</p>';
    return;
  }
  alvo.innerHTML = historicoDuvidas.map((d) => `
    <details class="ia-item-historico">
      <summary><span>${esc(d.pergunta.slice(0, 90))}${d.pergunta.length > 90 ? "…" : ""}${d.imagens ? " 📷" : ""}</span>
        <small>${d.criadoEm?.toDate ? d.criadoEm.toDate().toLocaleDateString("pt-BR") : ""}</small></summary>
      <div class="ia-msg-texto">${md(d.resposta)}</div>
      <button type="button" class="link-lateral" data-apagar-duvida="${d.id}">Apagar</button>
    </details>`).join("");
  alvo.querySelectorAll("[data-apagar-duvida]").forEach((b) => b.addEventListener("click", async () => {
    const user = getAuth().currentUser;
    if (user && confirm("Apagar essa dúvida do histórico?")) await deleteDoc(doc(getFirestore(), "usuarios", user.uid, "duvidas", b.dataset.apagarDuvida));
  }));
}

// ---------------------------------------------------------------------------
// Redação
// ---------------------------------------------------------------------------
let imagensRedacao = [];
let historicoRedacoes = [];
const NOMES_COMP = ["Escrita formal", "Tema e tipo textual", "Argumentação", "Coesão", "Proposta de intervenção"];

function esquemaRedacao() {
  const S = SchemaCls;
  return S.object({
    properties: {
      transcricao: S.string({ description: "Transcrição fiel da redação, se veio por foto" }),
      tema_identificado: S.string(),
      zerada: S.boolean(),
      motivo_zero: S.string(),
      competencias: S.array({
        items: S.object({
          properties: {
            numero: S.integer(),
            nota: S.integer({ description: "0, 40, 80, 120, 160 ou 200" }),
            nivel: S.string({ description: "Descrição do nível da grade do Inep" }),
            justificativa: S.string(),
            pontos_fortes: S.array({ items: S.string() }),
            problemas: S.array({
              items: S.object({
                properties: { trecho: S.string(), problema: S.string(), sugestao: S.string() },
              }),
            }),
          },
          optionalProperties: ["pontos_fortes", "problemas"],
        }),
      }),
      total: S.integer(),
      proposta_intervencao: S.object({
        properties: { agente: S.string(), acao: S.string(), modo_meio: S.string(), finalidade: S.string(), detalhamento: S.string() },
      }),
      repertorio: S.array({ items: S.string() }),
      resumo: S.string(),
      proximos_passos: S.array({ items: S.string() }),
    },
    optionalProperties: ["transcricao", "motivo_zero", "proposta_intervencao", "repertorio"],
  });
}

// Garante as regras da grade mesmo se a IA escorregar.
function normalizarCorrecao(c) {
  const comps = [1, 2, 3, 4, 5].map((n) => {
    const achada = (c.competencias || []).find((x) => Number(x.numero) === n) || (c.competencias || [])[n - 1] || {};
    let nota = Math.round(Number(achada.nota) / 40) * 40;
    if (!Number.isFinite(nota)) nota = 0;
    nota = Math.max(0, Math.min(200, nota));
    return { ...achada, numero: n, nota, problemas: achada.problemas || [], pontos_fortes: achada.pontos_fortes || [] };
  });
  if (c.zerada) comps.forEach((x) => (x.nota = 0));
  return { ...c, competencias: comps, total: comps.reduce((s, x) => s + x.nota, 0) };
}

function contarTexto() {
  const t = $("ia-redacao-texto").value.trim();
  const palavras = t ? t.split(/\s+/).length : 0;
  // Numa folha de redação cabem ~10 palavras por linha.
  const linhas = Math.round(palavras / 10);
  const aviso = palavras && palavras < 70 ? " · atenção: até 7 linhas zera" : palavras > 360 ? " · a folha oficial tem 30 linhas" : "";
  $("ia-redacao-contagem").textContent = `${palavras} palavra${palavras === 1 ? "" : "s"} · ~${linhas} linhas manuscritas${aviso}`;
}

function modoRedacao() {
  return document.querySelector('input[name="ia-modo"]:checked')?.value || "digitar";
}

function atualizarModoRedacao() {
  const foto = modoRedacao() === "foto";
  $("ia-redacao-bloco-texto").classList.toggle("oculto", foto);
  $("ia-redacao-bloco-foto").classList.toggle("oculto", !foto);
}

function renderizarPreviasRedacao() {
  $("ia-redacao-previas").innerHTML = imagensRedacao.map((img, i) => `
    <span class="ia-miniatura grande"><img src="${img.previa}" alt="Página ${i + 1}" /><button type="button" data-tirar="${i}" aria-label="Tirar foto">×</button></span>`).join("");
  $("ia-redacao-previas").querySelectorAll("[data-tirar]").forEach((b) => b.addEventListener("click", () => {
    imagensRedacao.splice(Number(b.dataset.tirar), 1);
    renderizarPreviasRedacao();
  }));
}

async function corrigirRedacao(e) {
  e.preventDefault();
  const tema = $("ia-redacao-tema").value.trim();
  const foto = modoRedacao() === "foto";
  const texto = $("ia-redacao-texto").value.trim();
  const status = $("ia-redacao-status");
  if (!foto && texto.split(/\s+/).length < 20) {
    status.className = "status-pdf falha";
    status.textContent = "Cole ou digite a redação inteira antes de corrigir.";
    return;
  }
  if (foto && !imagensRedacao.length) {
    status.className = "status-pdf falha";
    status.textContent = "Adicione a foto da redação (pode ser mais de uma, se estiver em duas páginas).";
    return;
  }
  const botao = $("ia-redacao-corrigir");
  botao.disabled = true;
  status.className = "status-pdf lendo";
  status.textContent = foto ? "Lendo a letra e corrigindo… pode levar até 1 minuto." : "Corrigindo pela grade do Inep… pode levar até 1 minuto.";
  $("ia-redacao-resultado").innerHTML = "";

  try {
    await prepararIA();
    const partes = [{
      text: `TEMA: ${tema || "(não informado — deduza pelo texto)"}\n\n` +
        (foto ? "A redação está nas imagens a seguir, na ordem das páginas. Transcreva e corrija." : `REDAÇÃO:\n${texto}`),
    }];
    if (foto) imagensRedacao.forEach((i) => partes.push({ inlineData: i.inlineData }));

    const bruto = await comModelos(async (nome) => {
      const m = modelo(nome, SISTEMA_REDACAO, {
        generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseSchema: esquemaRedacao() },
      });
      const r = await m.generateContent(partes);
      return r.response.text();
    });
    const correcao = normalizarCorrecao(JSON.parse(bruto));
    status.className = "status-pdf ok";
    status.textContent = `Correção pronta: ${correcao.total} pontos. É uma estimativa de treino — a nota oficial é dada por dois corretores do Inep.`;
    $("ia-redacao-resultado").innerHTML = htmlCorrecao(correcao, tema);
    $("ia-redacao-resultado").scrollIntoView({ behavior: "smooth", block: "start" });
    salvarRedacao(tema, foto ? correcao.transcricao || "" : texto, correcao, foto);
  } catch (erro) {
    if (String(erro?.message) !== "sem-chave") console.error("IA (redação):", erro);
    status.className = "status-pdf falha";
    status.textContent = erro instanceof SyntaxError ? "A IA devolveu uma resposta incompleta. Tente de novo." : mensagemDeErro(erro);
  } finally {
    botao.disabled = false;
  }
}

function htmlCorrecao(c, tema) {
  const barras = c.competencias.map((x) => `
    <div class="pd-linha" title="C${x.numero}: ${x.nota}">
      <span class="pd-nome">C${x.numero} · ${NOMES_COMP[x.numero - 1]}</span>
      <span class="pd-trilho"><i style="width:${(x.nota / 2).toFixed(0)}%"></i></span>
      <span class="pd-valor">${x.nota}</span>
      <span class="pd-tag-slot"></span>
    </div>`).join("");
  const comps = c.competencias.map((x) => `
    <details class="ia-comp" ${x.nota < 160 ? "open" : ""}>
      <summary><b>C${x.numero} · ${NOMES_COMP[x.numero - 1]}</b> <span class="ia-nota-comp">${x.nota}/200</span></summary>
      ${x.nivel ? `<p class="ia-nivel">${esc(x.nivel)}</p>` : ""}
      ${x.justificativa ? `<p>${esc(x.justificativa)}</p>` : ""}
      ${x.pontos_fortes.length ? `<p class="ia-rotulo">Pontos fortes</p><ul>${x.pontos_fortes.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
      ${x.problemas.length ? `<p class="ia-rotulo">O que ajustar</p>${x.problemas.map((p) => `
        <div class="ia-problema">
          ${p.trecho ? `<div class="ia-trecho">“${esc(p.trecho)}”</div>` : ""}
          <div>${esc(p.problema)}</div>
          ${p.sugestao ? `<div class="ia-sugestao">Sugestão: ${esc(p.sugestao)}</div>` : ""}
        </div>`).join("")}` : ""}
    </details>`).join("");
  const pi = c.proposta_intervencao;
  const proposta = pi ? `
    <div class="ia-bloco"><p class="ia-rotulo">Proposta de intervenção (C5)</p>
      <dl class="dados-lista">${[["Agente", pi.agente], ["Ação", pi.acao], ["Modo/meio", pi.modo_meio], ["Finalidade", pi.finalidade], ["Detalhamento", pi.detalhamento]]
        .map(([k, v]) => `<dt>${k}</dt><dd>${esc(v || "não encontrado")}</dd>`).join("")}</dl></div>` : "";
  return `
    <section class="painel-desempenho ia-correcao">
      <div class="pd-topo">
        <div><h2>Correção</h2><p class="sub">${esc(tema || c.tema_identificado || "Tema não informado")}</p></div>
        <div class="pd-media"><span>Nota estimada</span><b>${c.total}</b><small>de 1000</small></div>
      </div>
      ${c.zerada ? `<div class="status-pdf falha">Essa redação seria zerada: ${esc(c.motivo_zero || "motivo não informado")}</div>` : ""}
      <div class="pd-bloco" style="margin-top:12px">${barras}</div>
      ${c.resumo ? `<div class="ia-bloco"><p class="ia-rotulo">Resumo</p><p>${esc(c.resumo)}</p></div>` : ""}
      ${comps}
      ${proposta}
      ${(c.repertorio || []).length ? `<div class="ia-bloco"><p class="ia-rotulo">Repertório encontrado</p><ul>${c.repertorio.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></div>` : ""}
      ${(c.proximos_passos || []).length ? `<div class="ia-bloco"><p class="ia-rotulo">Próximos passos pra subir a nota</p><ol>${c.proximos_passos.map((r) => `<li>${esc(r)}</li>`).join("")}</ol></div>` : ""}
      ${c.transcricao ? `<details class="ia-comp"><summary>Transcrição que a IA leu da foto</summary><p style="white-space:pre-wrap">${esc(c.transcricao)}</p></details>` : ""}
      <p class="pd-rodape">Nota estimada por IA com a grade oficial do Inep, pra treino. Confira os trechos apontados — a IA pode errar.</p>
    </section>`;
}

async function salvarRedacao(tema, texto, correcao, porFoto) {
  const user = getAuth().currentUser;
  if (!user) return;
  try {
    await addDoc(collection(getFirestore(), "usuarios", user.uid, "redacoes"), {
      tema: tema || correcao.tema_identificado || "",
      texto: String(texto || "").slice(0, 8000),
      porFoto,
      total: correcao.total,
      notas: correcao.competencias.map((x) => x.nota),
      correcao: JSON.stringify(correcao).slice(0, 60000),
      criadoEm: serverTimestamp(),
    });
  } catch (e) {
    console.warn("Não salvei a correção:", e);
  }
}

function renderizarHistoricoRedacoes() {
  const alvo = $("ia-redacoes-historico");
  if (!alvo) return;
  if (!historicoRedacoes.length) {
    alvo.innerHTML = '<p class="texto-suave">Suas redações corrigidas ficam aqui, pra você acompanhar a evolução.</p>';
    return;
  }
  const media = Math.round(historicoRedacoes.reduce((s, r) => s + (r.total || 0), 0) / historicoRedacoes.length);
  alvo.innerHTML = `
    <p class="texto-suave">${historicoRedacoes.length} redaç${historicoRedacoes.length === 1 ? "ão" : "ões"} · média ${media}</p>
    ${historicoRedacoes.map((r) => `
      <div class="ia-item-historico ia-linha-redacao">
        <div><b>${r.total}</b> <span class="texto-suave">${r.criadoEm?.toDate ? r.criadoEm.toDate().toLocaleDateString("pt-BR") : ""}</span>
          <div class="ia-tema-hist">${esc(r.tema || "Sem tema")}</div>
          <div class="texto-suave ia-notas-hist">${(r.notas || []).map((n, i) => `C${i + 1} ${n}`).join(" · ")}</div></div>
        <div class="ia-acoes-hist">
          <button type="button" class="link-lateral" data-ver-redacao="${r.id}">Ver</button>
          <button type="button" class="link-lateral" data-apagar-redacao="${r.id}">Apagar</button>
        </div>
      </div>`).join("")}`;
  alvo.querySelectorAll("[data-ver-redacao]").forEach((b) => b.addEventListener("click", () => {
    const r = historicoRedacoes.find((x) => x.id === b.dataset.verRedacao);
    try {
      $("ia-redacao-resultado").innerHTML = htmlCorrecao(normalizarCorrecao(JSON.parse(r.correcao)), r.tema);
      $("ia-redacao-resultado").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {
      alert("Não deu pra abrir essa correção.");
    }
  }));
  alvo.querySelectorAll("[data-apagar-redacao]").forEach((b) => b.addEventListener("click", async () => {
    const user = getAuth().currentUser;
    if (user && confirm("Apagar essa correção do histórico?")) await deleteDoc(doc(getFirestore(), "usuarios", user.uid, "redacoes", b.dataset.apagarRedacao));
  }));
}

// ---------------------------------------------------------------------------
function montarEventos() {
  $("ia-subaba-duvidas").addEventListener("click", () => mostrarSubabaIA("duvidas"));
  $("ia-subaba-redacao").addEventListener("click", () => mostrarSubabaIA("redacao"));

  $("ia-form-duvida").addEventListener("submit", enviarDuvida);
  $("ia-duvida-texto").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) $("ia-form-duvida").requestSubmit();
  });
  $("ia-duvida-foto").addEventListener("change", async (e) => {
    for (const f of [...e.target.files].slice(0, 3 - imagensDuvida.length)) imagensDuvida.push(await imagemParaParte(f));
    e.target.value = "";
    renderizarPreviasDuvida();
  });
  $("ia-nova-conversa").addEventListener("click", () => {
    conversa = [];
    chat = null;
    renderizarConversa();
  });

  document.querySelectorAll('input[name="ia-modo"]').forEach((r) => r.addEventListener("change", atualizarModoRedacao));
  $("ia-redacao-texto").addEventListener("input", contarTexto);
  $("ia-redacao-foto").addEventListener("change", async (e) => {
    for (const f of [...e.target.files].slice(0, 3 - imagensRedacao.length)) imagensRedacao.push(await imagemParaParte(f));
    e.target.value = "";
    renderizarPreviasRedacao();
  });
  $("ia-form-redacao").addEventListener("submit", corrigirRedacao);

  mostrarSubabaIA("duvidas");
  atualizarModoRedacao();
  contarTexto();
  renderizarConversa();
}
