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
  getFirestore, collection, addDoc, deleteDoc, doc, setDoc, updateDoc, getDocs, writeBatch,
  query, orderBy, limit, onSnapshot, serverTimestamp,
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

Quando o estudante mandar uma questão (em texto, foto, PDF ou outro arquivo anexado):
1. Diga a área, a disciplina e o conteúdo cobrado; se der, a competência/habilidade da Matriz de Referência do Enem.
2. Resolva passo a passo, mostrando o raciocínio e as contas.
3. Indique a alternativa correta e explique, em uma linha cada, por que as outras estão erradas.
4. Destaque o conceito-chave ou a "pegadinha" da questão.
5. Termine com uma dica curta do que revisar.

Quando for uma dúvida de conteúdo (sem questão), explique com um exemplo no estilo Enem.

Regras:
- Se vier um arquivo com várias questões e o estudante não disser qual, pergunte qual ele quer (ou resolva a primeira e ofereça as outras).
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
- Se a redação vier em ANEXO (foto, PDF escaneado ou outro arquivo), primeiro transcreva fielmente no campo "transcricao" (mantenha os erros do autor; use [ilegível] onde não der pra ler) e corrija a transcrição. Se a letra estiver ilegível demais, diga isso no resumo e não chute notas altas.
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
// Anexos: qualquer arquivo. Cada um vira uma "parte" que o Gemini entende:
//  - imagem → reduzida pra 1600px em JPEG;
//  - PDF, áudio, vídeo → vão como estão (o Gemini lê direto);
//  - Word/ODT/PowerPoint/Excel → o texto é extraído aqui no navegador;
//  - texto, CSV, JSON, código… → vão como texto;
//  - o resto: se der pra ler como texto, vai como texto; senão, avisa.
// O pedido todo pro Gemini tem limite de ~20 MB, então o total é limitado.
// ---------------------------------------------------------------------------
const LIMITE_TOTAL = 14 * 1024 * 1024;   // bytes "crus" somados (base64 aumenta ~33%)
const LIMITE_TEXTO = 120000;             // caracteres por arquivo de texto
const MAX_ANEXOS = 5;
const DIRETO = /^(application\/pdf|audio\/|video\/)/;
const EXT_TEXTO = /\.(txt|md|csv|tsv|json|xml|html?|css|js|ts|py|java|c|cpp|h|rtf|tex|log|ya?ml|ini|srt)$/i;

function tamanhoLegivel(b) {
  return b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`;
}

function paraBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Leitor de .zip mínimo (docx/xlsx/pptx/odt são zips), sem biblioteca.
async function lerZip(buffer) {
  const v = new DataView(buffer);
  let fim = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 70000); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { fim = i; break; }
  }
  if (fim < 0) throw new Error("zip-invalido");
  const total = v.getUint16(fim + 10, true);
  let pos = v.getUint32(fim + 16, true);
  const dec = new TextDecoder();
  const entradas = {};
  for (let n = 0; n < total; n++) {
    if (v.getUint32(pos, true) !== 0x02014b50) break;
    const metodo = v.getUint16(pos + 10, true);
    const tamComp = v.getUint32(pos + 20, true);
    const lenNome = v.getUint16(pos + 28, true), lenExtra = v.getUint16(pos + 30, true), lenCom = v.getUint16(pos + 32, true);
    const local = v.getUint32(pos + 42, true);
    const nome = dec.decode(new Uint8Array(buffer, pos + 46, lenNome));
    entradas[nome] = { metodo, tamComp, local };
    pos += 46 + lenNome + lenExtra + lenCom;
  }
  return {
    nomes: Object.keys(entradas),
    async texto(nome) {
      const e = entradas[nome];
      if (!e) return "";
      const ini = e.local + 30 + v.getUint16(e.local + 26, true) + v.getUint16(e.local + 28, true);
      const dados = new Uint8Array(buffer, ini, e.tamComp);
      if (e.metodo === 0) return dec.decode(dados);
      const fluxo = new Blob([dados]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Response(fluxo).text();
    },
  };
}

function xmlParaTexto(xml, fimParagrafo) {
  return xml
    .replace(new RegExp(`</${fimParagrafo}>`, "g"), "\n")
    .replace(/<w:tab\/>|<text:tab\/>/g, "\t")
    .replace(/<w:br\/>|<text:line-break\/>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function textoDeOffice(buffer, ext) {
  const zip = await lerZip(buffer);
  if (ext === "docx") return xmlParaTexto(await zip.texto("word/document.xml"), "w:p");
  if (/^od[tps]$/.test(ext)) return xmlParaTexto(await zip.texto("content.xml"), "text:p");
  if (ext === "pptx") {
    const slides = zip.nomes.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
    const partes = [];
    for (const [i, n] of slides.entries()) partes.push(`--- Slide ${i + 1} ---\n${xmlParaTexto(await zip.texto(n), "a:p")}`);
    return partes.join("\n\n");
  }
  if (ext === "xlsx") {
    const compart = [...(await zip.texto("xl/sharedStrings.xml")).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlParaTexto(m[1], "x"));
    const planilhas = zip.nomes.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
    const saida = [];
    for (const [i, n] of planilhas.entries()) {
      const xml = await zip.texto(n);
      const linhas = [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((r) =>
        [...r[1].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((c) => {
          const tipo = (c[1].match(/t="(\w+)"/) || [])[1];
          const val = ((c[2] || "").match(/<v>([\s\S]*?)<\/v>/) || [])[1];
          if (tipo === "s") return compart[Number(val)] ?? "";
          if (tipo === "inlineStr") return xmlParaTexto(c[2] || "", "x");
          return val ?? "";
        }).join("\t"));
      saida.push(`--- Planilha ${i + 1} ---\n${linhas.join("\n")}`);
    }
    return saida.join("\n\n");
  }
  throw new Error("office-desconhecido");
}

// Texto "de verdade"? (evita mandar lixo binário como se fosse texto)
function pareceTexto(buffer) {
  const amostra = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 4000));
  let estranhos = 0;
  for (const b of amostra) if (b === 0 || (b < 9) || (b > 13 && b < 32)) estranhos++;
  return amostra.length > 0 && estranhos / amostra.length < 0.02;
}

async function arquivoParaAnexo(arquivo) {
  const nome = arquivo.name || "arquivo";
  const ext = (nome.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || "";
  const tipo = arquivo.type || "";
  const base = { nome, tamanho: arquivo.size, mime: arquivo.type || "" };

  if (tipo.startsWith("image/") && !/heic|heif/i.test(tipo)) {
    try {
      const img = await imagemParaParte(arquivo);
      return { ...base, tipo: "imagem", parte: { inlineData: img.inlineData }, previa: img.previa, bytes: img.inlineData.data.length * 0.75 };
    } catch { /* formato que o navegador não abre: tenta mandar direto abaixo */ }
  }
  const buffer = await arquivo.arrayBuffer();

  if (DIRETO.test(tipo) || /^(heic|heif)$/.test(ext) || /heic|heif/i.test(tipo)) {
    const mime = tipo || (ext === "heic" ? "image/heic" : "image/heif");
    return { ...base, tipo: mime.startsWith("image/") ? "imagem" : "arquivo", parte: { inlineData: { mimeType: mime, data: paraBase64(buffer) } }, bytes: buffer.byteLength };
  }
  if (/^(docx|xlsx|pptx|odt|ods|odp)$/.test(ext)) {
    const texto = await textoDeOffice(buffer, ext);
    if (!texto.trim()) throw new Error(`O arquivo "${nome}" não tem texto que eu consiga ler.`);
    return { ...base, tipo: "texto", texto: texto.slice(0, LIMITE_TEXTO), parte: { text: `ARQUIVO "${nome}":\n${texto.slice(0, LIMITE_TEXTO)}` }, bytes: 0 };
  }
  if (tipo.startsWith("text/") || EXT_TEXTO.test(nome) || /json|xml|csv|javascript/.test(tipo) || pareceTexto(buffer)) {
    let texto = new TextDecoder("utf-8").decode(buffer);
    if (/\uFFFD/.test(texto.slice(0, 2000))) texto = new TextDecoder("windows-1252").decode(buffer);
    if (ext === "rtf") texto = texto.replace(/\\par[d]?/g, "\n").replace(/\{\\\*[^}]*\}|\\[a-z]+-?\d* ?|[{}]/g, "");
    return { ...base, tipo: "texto", texto: texto.slice(0, LIMITE_TEXTO), parte: { text: `ARQUIVO "${nome}":\n${texto.slice(0, LIMITE_TEXTO)}` }, bytes: 0 };
  }
  if (ext === "doc" || ext === "ppt" || ext === "xls") {
    throw new Error(`"${nome}" está num formato antigo do Office (.${ext}). Salve como .${ext}x ou PDF e anexe de novo.`);
  }
  throw new Error(`Não consigo mandar "${nome}" pra IA. Tente em PDF, imagem, Word ou texto.`);
}

// Adiciona arquivos numa lista de anexos, respeitando a quantidade e o tamanho.
async function anexarArquivos(arquivos, lista, aoErrar) {
  const erros = [];
  for (const f of arquivos) {
    if (lista.length >= MAX_ANEXOS) { erros.push(`Máximo de ${MAX_ANEXOS} anexos por vez.`); break; }
    try {
      const anexo = await arquivoParaAnexo(f);
      const usado = lista.reduce((s, a) => s + (a.bytes || 0), 0);
      if (usado + (anexo.bytes || 0) > LIMITE_TOTAL) { erros.push(`"${f.name}" passa do limite de ${tamanhoLegivel(LIMITE_TOTAL)} somando os anexos.`); continue; }
      lista.push(anexo);
    } catch (e) {
      console.warn("Anexo:", e);
      erros.push(/zip-invalido|office/.test(e.message) ? `Não consegui abrir "${f.name}".` : e.message);
    }
  }
  aoErrar(erros.join(" "));
}

function iconeAnexo(a) {
  const n = a.nome.toLowerCase();
  if (a.tipo === "imagem") return "🖼️";
  if (n.endsWith(".pdf")) return "📕";
  if (/\.(docx|odt|txt|md|rtf)$/.test(n)) return "📄";
  if (/\.(xlsx|ods|csv|tsv)$/.test(n)) return "📊";
  if (/\.(pptx|odp)$/.test(n)) return "📽️";
  if (/^audio/.test(a.mime || "") || /\.(mp3|wav|m4a|ogg|opus)$/.test(n)) return "🎧";
  if (/^video/.test(a.mime || "")) return "🎬";
  return "📎";
}

function htmlAnexo(a, i, grande) {
  const tirar = i === undefined ? "" : `<button type="button" data-tirar="${i}" aria-label="Tirar ${esc(a.nome)}">×</button>`;
  if (a.previa) return `<span class="ia-miniatura${grande ? " grande" : ""}"><img src="${a.previa}" alt="${esc(a.nome)}" />${tirar}</span>`;
  return `<span class="ia-miniatura"><span class="ia-arquivo" title="${esc(a.nome)}">${iconeAnexo(a)} <span>${esc(a.nome)}</span> <small>${tamanhoLegivel(a.tamanho)}</small></span>${tirar}</span>`;
}

// Imagens: reduz pra no máximo 1600px e JPEG, pra caber e ir rápido.
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
  pararHistoricos.push(onSnapshot(query(collection(db, "usuarios", user.uid, "conversas"), orderBy("atualizadoEm", "desc"), limit(60)), (snap) => {
    conversas = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (conversaAtual && !conversas.some((c) => c.id === conversaAtual)) novaConversa();
    renderizarListaConversas();
    renderizarTituloConversa();
  }, () => {}));
  migrarDuvidasAntigas(user).catch(() => {});
}

export function sairDaIA() {
  pararHistoricos.forEach((f) => f());
  pararHistoricos = [];
  conversa = [];
  chat = null;
  conversaAtual = null;
}

// ---------------------------------------------------------------------------
// Dúvidas (conversa)
// ---------------------------------------------------------------------------
let conversa = []; // {papel: "voce"|"ia", texto, previas[], arquivos[]}
let chat = null;
let imagensDuvida = [];
let conversas = [];            // lista guardada no Firestore
let conversaAtual = null;      // id da conversa aberta (null = ainda não salva)
let mostrandoArquivadas = false;
const MAX_MENSAGENS = 60;

// ---------------------------------------------------------------------------
// Conversas: criar, abrir, renomear, arquivar, apagar
// ---------------------------------------------------------------------------
function colecaoConversas() {
  const user = getAuth().currentUser;
  return user ? collection(getFirestore(), "usuarios", user.uid, "conversas") : null;
}

function tituloAutomatico(texto, temAnexo) {
  const limpo = (texto || "").replace(/\s+/g, " ").trim();
  if (limpo) return limpo.slice(0, 60) + (limpo.length > 60 ? "…" : "");
  return temAnexo ? "Questão em anexo" : `Conversa de ${new Date().toLocaleDateString("pt-BR")}`;
}

function paraGuardar(msgs) {
  return msgs.slice(-MAX_MENSAGENS).map((m) => ({
    papel: m.papel,
    texto: String(m.texto || "").slice(0, 12000),
    anexos: [...(m.arquivos || []).map((a) => a.nome), ...(m.previas || []).map(() => "imagem")].slice(0, 5),
  }));
}

async function salvarConversa() {
  const col = colecaoConversas();
  if (!col || !conversa.length) return;
  const dados = { mensagens: paraGuardar(conversa), atualizadoEm: serverTimestamp() };
  try {
    if (conversaAtual) {
      await updateDoc(doc(col, conversaAtual), dados);
    } else {
      const primeira = conversa.find((m) => m.papel === "voce");
      const ref = await addDoc(col, {
        ...dados,
        titulo: tituloAutomatico(primeira?.texto, Boolean(primeira?.previas?.length || primeira?.arquivos?.length)),
        arquivada: false,
        criadoEm: serverTimestamp(),
      });
      conversaAtual = ref.id;
      renderizarTituloConversa();
    }
  } catch (e) {
    console.warn("Não salvei a conversa:", e);
  }
}

function novaConversa() {
  conversaAtual = null;
  conversa = [];
  chat = null;
  imagensDuvida = [];
  renderizarPreviasDuvida();
  renderizarConversa();
  renderizarTituloConversa();
  renderizarListaConversas();
}

function abrirConversa(id) {
  const c = conversas.find((x) => x.id === id);
  if (!c) return;
  conversaAtual = id;
  conversa = (c.mensagens || []).map((m) => ({
    papel: m.papel,
    texto: m.texto,
    arquivos: (m.anexos || []).filter((n) => n !== "imagem").map((nome) => ({ nome, tamanho: 0 })),
  }));
  chat = null; // é recriado no próximo envio, já com este histórico
  renderizarConversa();
  renderizarTituloConversa();
  renderizarListaConversas();
  $("ia-lista-conversas").classList.add("oculto");
  $("ia-abrir-lista").setAttribute("aria-expanded", "false");
}

// O Gemini precisa do histórico em texto pra continuar de onde parou.
function historicoParaOModelo() {
  return conversa
    .filter((m) => m.texto)
    .map((m) => ({ role: m.papel === "voce" ? "user" : "model", parts: [{ text: m.texto }] }))
    .slice(0, -1); // a última mensagem é a que está sendo enviada agora
}

async function renomearConversa(id) {
  const c = conversas.find((x) => x.id === id);
  const novo = prompt("Nome da conversa:", c?.titulo || "");
  if (novo === null) return;
  const nome = novo.trim().slice(0, 80);
  if (!nome) return;
  try {
    await updateDoc(doc(colecaoConversas(), id), { titulo: nome });
  } catch (e) {
    console.warn("Não renomeei:", e);
  }
}

async function arquivarConversa(id, arquivar) {
  try {
    await updateDoc(doc(colecaoConversas(), id), { arquivada: arquivar });
    if (arquivar && id === conversaAtual) novaConversa();
  } catch (e) {
    console.warn("Não arquivei:", e);
  }
}

async function apagarConversa(id) {
  const c = conversas.find((x) => x.id === id);
  if (!confirm(`Apagar a conversa "${c?.titulo || ""}"? Isso não tem volta.`)) return;
  try {
    await deleteDoc(doc(colecaoConversas(), id));
    if (id === conversaAtual) novaConversa();
  } catch (e) {
    console.warn("Não apaguei:", e);
  }
}

function renderizarTituloConversa() {
  const alvo = $("ia-titulo-conversa");
  if (!alvo) return;
  const c = conversas.find((x) => x.id === conversaAtual);
  alvo.textContent = c?.titulo || (conversa.length ? "Conversa sem nome" : "Nova conversa");
  alvo.disabled = !conversaAtual;
}

function dataCurta(ts) {
  const d = ts?.toDate ? ts.toDate() : null;
  if (!d) return "";
  const hoje = new Date();
  const mesmoDia = d.toDateString() === hoje.toDateString();
  return mesmoDia ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("pt-BR");
}

function renderizarListaConversas() {
  const alvo = $("ia-lista-itens");
  if (!alvo) return;
  $("ia-lista-ativas").classList.toggle("aba-ativa", !mostrandoArquivadas);
  $("ia-lista-arquivadas").classList.toggle("aba-ativa", mostrandoArquivadas);
  const itens = conversas.filter((c) => Boolean(c.arquivada) === mostrandoArquivadas);
  if (!itens.length) {
    alvo.innerHTML = `<p class="ia-lista-vazia">${mostrandoArquivadas ? "Nenhuma conversa arquivada." : "Nenhuma conversa ainda. Faça uma pergunta que ela aparece aqui."}</p>`;
    return;
  }
  alvo.innerHTML = itens.map((c) => `
    <div class="ia-lista-item${c.id === conversaAtual ? " ativa" : ""}">
      <button class="ia-lista-abrir" type="button" data-abrir="${c.id}">
        <b>${esc(c.titulo || "Sem nome")}</b>
        <small>${(c.mensagens || []).length} mensage${(c.mensagens || []).length === 1 ? "m" : "ns"} · ${dataCurta(c.atualizadoEm)}</small>
      </button>
      <button class="ia-acao" type="button" data-renomear="${c.id}" title="Renomear" aria-label="Renomear">✏️</button>
      <button class="ia-acao" type="button" data-arquivar="${c.id}" title="${c.arquivada ? "Desarquivar" : "Arquivar"}" aria-label="${c.arquivada ? "Desarquivar" : "Arquivar"}">${c.arquivada ? "📤" : "📥"}</button>
      <button class="ia-acao" type="button" data-apagar="${c.id}" title="Apagar" aria-label="Apagar">🗑️</button>
    </div>`).join("");
  alvo.querySelectorAll("[data-abrir]").forEach((b) => b.addEventListener("click", () => abrirConversa(b.dataset.abrir)));
  alvo.querySelectorAll("[data-renomear]").forEach((b) => b.addEventListener("click", () => renomearConversa(b.dataset.renomear)));
  alvo.querySelectorAll("[data-arquivar]").forEach((b) => b.addEventListener("click", () => {
    const c = conversas.find((x) => x.id === b.dataset.arquivar);
    arquivarConversa(b.dataset.arquivar, !c?.arquivada);
  }));
  alvo.querySelectorAll("[data-apagar]").forEach((b) => b.addEventListener("click", () => apagarConversa(b.dataset.apagar)));
}

// As dúvidas soltas da versão anterior viram conversas, uma vez só.
async function migrarDuvidasAntigas(user) {
  const db = getFirestore();
  const antigas = await getDocs(query(collection(db, "usuarios", user.uid, "duvidas"), orderBy("criadoEm", "desc"), limit(30)));
  if (antigas.empty) return;
  const lote = writeBatch(db);
  antigas.docs.forEach((d) => {
    const v = d.data();
    lote.set(doc(collection(db, "usuarios", user.uid, "conversas")), {
      titulo: tituloAutomatico(v.pergunta, Boolean(v.imagens)),
      arquivada: false,
      criadoEm: v.criadoEm || serverTimestamp(),
      atualizadoEm: v.criadoEm || serverTimestamp(),
      mensagens: [
        { papel: "voce", texto: String(v.pergunta || "").slice(0, 12000), anexos: [] },
        { papel: "ia", texto: String(v.resposta || "").slice(0, 12000), anexos: [] },
      ],
    });
    lote.delete(d.ref);
  });
  await lote.commit();
}

function renderizarConversa() {
  const alvo = $("ia-conversa");
  if (!conversa.length) {
    alvo.innerHTML = `<div class="ia-vazio">Mande uma questão (texto ou arquivo anexado: foto, print, PDF, Word…) ou uma dúvida de conteúdo. Dá pra continuar perguntando em cima da resposta.</div>`;
    return;
  }
  alvo.innerHTML = conversa.map((m) => `
    <div class="ia-msg ia-msg-${m.papel}">
      <div class="ia-msg-autor">${m.papel === "voce" ? "Você" : "IA"}</div>
      ${(m.previas || []).map((p) => `<img class="ia-previa" src="${p}" alt="Imagem enviada" />`).join("")}
      ${(m.arquivos || []).length ? `<div>${m.arquivos.map((a) => htmlAnexo(a)).join("")}</div>` : ""}
      <div class="ia-msg-texto">${m.papel === "ia" ? (m.carregando ? '<span class="ia-digitando">Pensando…</span>' : md(m.texto)) : `<p>${esc(m.texto).replace(/\n/g, "<br />")}</p>`}</div>
    </div>`).join("");
  alvo.scrollTop = alvo.scrollHeight;
}

function renderizarPreviasDuvida(erro = "") {
  $("ia-duvida-previas").innerHTML = imagensDuvida.map((a, i) => htmlAnexo(a, i)).join("") +
    (erro ? `<div class="status-pdf falha" style="flex-basis:100%">${esc(erro)}</div>` : "");
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
  conversa.push({
    papel: "voce",
    texto: texto || "(questão no anexo)",
    previas: imagens.filter((i) => i.previa).map((i) => i.previa),
    arquivos: imagens.filter((i) => !i.previa).map(({ nome, tamanho, tipo, mime }) => ({ nome, tamanho, tipo, mime })),
  });
  const resposta = { papel: "ia", texto: "", carregando: true };
  conversa.push(resposta);
  renderizarConversa();

  try {
    await prepararIA();
    const partes = [];
    if (texto) partes.push({ text: texto });
    else partes.push({ text: "Resolva e explique a questão do Enem que está no anexo." });
    imagens.forEach((i) => partes.push(i.parte));

    const resultado = await comModelos(async (nome) => {
      if (!chat || chat.modelo !== nome) {
        const m = modelo(nome, SISTEMA_DUVIDAS, { generationConfig: { temperature: 0.3 } });
        chat = { modelo: nome, sessao: m.startChat({ history: historicoParaOModelo() }) };
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
    salvarConversa();
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

function renderizarPreviasRedacao(erro = "") {
  $("ia-redacao-previas").innerHTML = imagensRedacao.map((a, i) => htmlAnexo(a, i, true)).join("") +
    (erro ? `<div class="status-pdf falha" style="flex-basis:100%">${esc(erro)}</div>` : "");
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
    status.textContent = "Anexe o arquivo da redação (foto, PDF, Word… pode ser mais de um, se estiver em duas páginas).";
    return;
  }
  const botao = $("ia-redacao-corrigir");
  botao.disabled = true;
  status.className = "status-pdf lendo";
  // Se todos os anexos já são texto (Word, .txt…), corrige como texto digitado.
  const soTexto = foto && imagensRedacao.every((a) => a.tipo === "texto");
  const textoAnexos = soTexto ? imagensRedacao.map((a) => a.texto).join("\n\n").trim() : "";
  status.textContent = foto && !soTexto ? "Lendo o arquivo e corrigindo… pode levar até 1 minuto." : "Corrigindo pela grade do Inep… pode levar até 1 minuto.";
  $("ia-redacao-resultado").innerHTML = "";

  try {
    await prepararIA();
    const partes = [{
      text: `TEMA: ${tema || "(não informado — deduza pelo texto)"}\n\n` +
        (soTexto ? `REDAÇÃO (extraída do arquivo anexado):\n${textoAnexos}`
          : foto ? "A redação está nos arquivos anexados a seguir, na ordem das páginas. Transcreva no campo \"transcricao\" e corrija. Se algum anexo não for a redação (ex.: proposta ou textos motivadores), use só como contexto."
          : `REDAÇÃO:\n${texto}`),
    }];
    if (foto && !soTexto) imagensRedacao.forEach((i) => partes.push(i.parte));

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
    salvarRedacao(tema, soTexto ? textoAnexos : foto ? correcao.transcricao || "" : texto, correcao, foto && !soTexto);
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
      ${c.transcricao ? `<details class="ia-comp"><summary>Transcrição que a IA leu do anexo</summary><p style="white-space:pre-wrap">${esc(c.transcricao)}</p></details>` : ""}
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
    const arquivos = [...e.target.files];
    e.target.value = "";
    await anexarArquivos(arquivos, imagensDuvida, (erro) => renderizarPreviasDuvida(erro));
  });
  $("ia-nova-conversa").addEventListener("click", novaConversa);
  $("ia-abrir-lista").addEventListener("click", () => {
    const lista = $("ia-lista-conversas");
    const abrindo = lista.classList.contains("oculto");
    lista.classList.toggle("oculto", !abrindo);
    $("ia-abrir-lista").setAttribute("aria-expanded", String(abrindo));
    if (abrindo) renderizarListaConversas();
  });
  $("ia-titulo-conversa").addEventListener("click", () => conversaAtual && renomearConversa(conversaAtual));
  $("ia-lista-ativas").addEventListener("click", () => { mostrandoArquivadas = false; renderizarListaConversas(); });
  $("ia-lista-arquivadas").addEventListener("click", () => { mostrandoArquivadas = true; renderizarListaConversas(); });

  document.querySelectorAll('input[name="ia-modo"]').forEach((r) => r.addEventListener("change", atualizarModoRedacao));
  $("ia-redacao-texto").addEventListener("input", contarTexto);
  $("ia-redacao-foto").addEventListener("change", async (e) => {
    const arquivos = [...e.target.files];
    e.target.value = "";
    await anexarArquivos(arquivos, imagensRedacao, (erro) => renderizarPreviasRedacao(erro));
  });
  $("ia-form-redacao").addEventListener("submit", corrigirRedacao);

  mostrarSubabaIA("duvidas");
  renderizarTituloConversa();
  atualizarModoRedacao();
  contarTexto();
  renderizarConversa();
}
