// ---------------------------------------------------------------------------
// Leitor de PDFs do Enem — roda 100% no navegador.
//
// O arquivo NUNCA sai do seu aparelho: o pdf.js abre o PDF aqui mesmo, a gente
// lê o texto, tira dele só o que interessa (ano, inscrição, notas, local de
// prova...) e devolve pro formulário, onde você confere antes de salvar.
// CPF, nome e qualquer outro dado pessoal que estiver no PDF são ignorados.
// ---------------------------------------------------------------------------

const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
const PDFJS_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

let pdfjsPromessa = null;
function carregarPdfJs() {
  if (!pdfjsPromessa) {
    pdfjsPromessa = import(PDFJS).then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      return lib;
    });
  }
  return pdfjsPromessa;
}

// Junta os pedacinhos de texto do PDF em linhas, pela altura (y) em que estão.
// Colunas diferentes da mesma linha ficam separadas por dois espaços — isso
// ajuda a saber onde termina um valor ("Sala: 12  Bloco: B").
export function agruparEmLinhas(itens) {
  const grupos = [];
  for (const it of itens) {
    if (!it.str || !it.str.trim()) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    let grupo = grupos.find((g) => Math.abs(g.y - y) < 3);
    if (!grupo) {
      grupo = { y, partes: [] };
      grupos.push(grupo);
    }
    grupo.partes.push({ x, s: it.str.trim() });
  }
  grupos.sort((a, b) => b.y - a.y);
  return grupos.map((g) =>
    g.partes
      .sort((a, b) => a.x - b.x)
      .map((p) => p.s)
      .join("  ")
      .replace(/ {3,}/g, "  ")
      .trim()
  );
}

export async function lerLinhasDoPdf(arquivo, pdfjsInjetado, avisar = () => {}) {
  const pdfjs = pdfjsInjetado || (await carregarPdfJs());
  const dados = new Uint8Array(await arquivo.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data: dados }).promise;
  const linhas = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const pagina = await pdf.getPage(p);
    const conteudo = await pagina.getTextContent();
    linhas.push(...agruparEmLinhas(conteudo.items));
  }

  // PDF sem texto de verdade (gerado por "Microsoft Print to PDF", foto,
  // digitalização...): as letras viraram desenho. Aí a gente "olha" a página.
  const temTexto = linhas.filter((l) => /[A-Za-zÀ-ÿ]{3}/.test(l)).length >= 3;
  if (!temTexto && typeof document !== "undefined") {
    return await lerComOcr(pdf, avisar);
  }
  return linhas;
}

// ---------------------------------------------------------------------------
// OCR (reconhecimento de texto em imagem) — também 100% no navegador.
// Usa o Tesseract.js; na primeira vez baixa o motor e o português (~5 MB),
// depois fica no cache do navegador.
// ---------------------------------------------------------------------------
const TESSERACT = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js";

// Deixa a página em "texto preto no fundo branco". Para cada linha de pixels,
// a mediana diz qual é o fundo daquela faixa: numa faixa escura (as linhas
// azuis da tabela do boletim), texto é o que for MAIS CLARO que o fundo; numa
// faixa clara, texto é o que for MAIS ESCURO. Sem isso, o OCR não lê letra
// branca em fundo azul.
export function prepararParaOcr(rgba, largura, altura) {
  const lum = new Uint8Array(largura * altura);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    lum[i] = (rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000;
  }
  const hist = new Uint32Array(256);
  for (let y = 0; y < altura; y++) {
    hist.fill(0);
    const base = y * largura;
    for (let x = 0; x < largura; x++) hist[lum[base + x]]++;
    let acumulado = 0;
    let mediana = 255;
    for (let v = 0; v < 256; v++) {
      acumulado += hist[v];
      if (acumulado >= largura / 2) {
        mediana = v;
        break;
      }
    }
    const faixaEscura = mediana < 170;
    for (let x = 0; x < largura; x++) {
      const l = lum[base + x];
      const ehTexto = faixaEscura ? l > mediana + 55 : l < mediana - 55;
      const v = ehTexto ? 0 : 255;
      const p = (base + x) * 4;
      rgba[p] = rgba[p + 1] = rgba[p + 2] = v;
      rgba[p + 3] = 255;
    }
  }
}

async function lerComOcr(pdf, avisar) {
  avisar("Esse PDF é uma imagem (sem texto dentro). Lendo com reconhecimento de texto — na primeira vez demora um pouquinho…");
  const modulo = await import(TESSERACT);
  const Tesseract = modulo.default || modulo;
  const worker = await Tesseract.createWorker("por");
  const linhas = [];
  try {
    for (let p = 1; p <= Math.min(pdf.numPages, 4); p++) {
      const pagina = await pdf.getPage(p);
      const viewport = pagina.getViewport({ scale: 4 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await pagina.render({ canvasContext: ctx, viewport }).promise;
      const imagem = ctx.getImageData(0, 0, canvas.width, canvas.height);
      prepararParaOcr(imagem.data, canvas.width, canvas.height);
      ctx.putImageData(imagem, 0, 0);
      const { data } = await worker.recognize(canvas);
      linhas.push(...data.text.split("\n").map((l) => l.trim()).filter(Boolean));
    }
  } finally {
    await worker.terminate();
  }
  return linhas;
}

// ---------------------------------------------------------------------------
// Interpretação do texto
// ---------------------------------------------------------------------------
const AREAS = [
  { chave: "lc", padrao: /linguagens/i },
  { chave: "ch", padrao: /ci[êe]ncias\s+humanas/i },
  { chave: "cn", padrao: /ci[êe]ncias\s+da\s+natureza/i },
  { chave: "mt", padrao: /matem[áa]tica/i },
];
const REDACAO = /reda[çc][ãa]o/i;

function semDatasNemHoras(linha) {
  return linha
    .replace(/\d{1,2}\/\d{1,2}(\/\d{2,4})?/g, " ")
    .replace(/\d{1,2}\s*h\s*\d{0,2}/gi, " ")
    .replace(/\d{1,2}:\d{2}/g, " ")
    .replace(/\d{3}\.\d{3}\.\d{3}-\d{2}/g, " "); // CPF
}

function paraNumero(texto) {
  const s = String(texto).trim();
  if (/^\d{1,3}\.\d{3}(,\d+)?$/.test(s)) return Number(s.replace(/\./g, "").replace(",", "."));
  if (s.includes(",")) return Number(s.replace(/\./g, "").replace(",", "."));
  return Number(s);
}

function numerosDaLinha(linha) {
  const limpa = semDatasNemHoras(linha);
  const achados = limpa.match(/\d{1,3}\.\d{3}(?:,\d{1,2})?|\d{1,4}(?:[.,]\d{1,2})?/g) || [];
  return achados.map(paraNumero).filter((n) => Number.isFinite(n));
}

function quantosRotulos(linha) {
  let n = AREAS.filter((a) => a.padrao.test(linha)).length;
  if (REDACAO.test(linha)) n++;
  return n;
}

function soNumero(linha) {
  return !!linha && !/[A-Za-zÀ-ÿ]/.test(semDatasNemHoras(linha)) && numerosDaLinha(linha).length > 0;
}

// Procura a nota logo depois do rótulo, na mesma linha ou na linha seguinte
// (quando o PDF põe o número sozinho embaixo). Linhas que citam várias provas
// de uma vez ("1º dia: Linguagens, Ciências Humanas e Redação") são ignoradas.
function notaDoRotulo(linhas, padrao, valida, corrigir = (n) => n) {
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    const casou = linha.match(padrao);
    if (!casou || quantosRotulos(linha) > 1) continue;
    const depois = corrigirDigitosOcr(linha.slice(casou.index + casou[0].length));
    const candidatos = numerosDaLinha(depois).map(corrigir).filter(valida);
    if (candidatos.length) return candidatos[0];
    if (soNumero(linhas[i + 1])) {
      const proximos = numerosDaLinha(linhas[i + 1]).map(corrigir).filter(valida);
      if (proximos.length) return proximos[0];
    }
  }
  return null;
}

// O OCR às vezes troca dígito por letra parecida ("415,4" virou "415A").
// Só mexe em "palavras" que já têm algum dígito e são feitas só de dígitos e
// dessas letras — "Presente", "Ausente" etc. ficam intactas.
const LETRA_PARA_DIGITO = { A: "4", O: "0", o: "0", D: "0", I: "1", l: "1", "|": "1", S: "5", s: "5", B: "8", Z: "2", G: "6" };
function corrigirDigitosOcr(texto) {
  return texto.replace(/[\dAODoIl|SsBZG]+(?:[.,][\dAODoIl|SsBZG]+)?/g, (token) =>
    /\d/.test(token) ? token.replace(/[AODoIl|SsBZG]/g, (c) => LETRA_PARA_DIGITO[c]) : token
  );
}

// Em PDF-imagem, a vírgula pequena às vezes some no OCR: "493,4" vira "4934".
// Nenhuma nota objetiva do Enem passa de 1000, então 4 dígitos sem vírgula
// nesse campo são uma vírgula perdida antes do último dígito.
function corrigirVirgulaPerdida(n) {
  return Number.isInteger(n) && n > 1000 && n < 10000 ? n / 10 : n;
}

// Só vale como rótulo se estiver no começo da linha (ou de uma coluna) ou vier
// seguido de dois-pontos — senão "cidade" dentro de "autenticidade" virava
// município.
function valorDoRotulo(linhas, padrao) {
  for (let i = 0; i < linhas.length; i++) {
    const m = linhas[i].match(padrao);
    if (!m) continue;
    const antes = linhas[i].slice(0, m.index);
    const depoisBruto = linhas[i].slice(m.index + m[0].length);
    const inicioDeColuna = antes.trim() === "" || / {2,}$/.test(antes);
    if (!inicioDeColuna && !/^\s*:/.test(depoisBruto)) continue;
    const resto = depoisBruto.replace(/^\s*:?\s*/, "");
    const valor = resto.split(/ {2,}/)[0].trim();
    if (valor) return valor;
    const proxima = (linhas[i + 1] || "").trim();
    if (proxima && !/:\s*$/.test(proxima) && !/^[^:]{1,30}:/.test(proxima)) return proxima.split(/ {2,}/)[0].trim();
  }
  return null;
}

function paraIso(dataBr) {
  const m = String(dataBr || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  let ano = Number(m[3]);
  if (ano < 100) ano += 2000;
  return `${ano}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
}

export function interpretarLinhas(linhas) {
  const texto = linhas.join("\n");
  const r = {
    ano: null,
    numeroInscricao: null,
    notas: { lc: null, ch: null, cn: null, mt: null, redacao: null },
    competencias: [null, null, null, null, null],
    mediaGeral: null,
    local: { escola: null, endereco: null, municipio: null, sala: null, bloco: null },
    dia1: null,
    dia2: null,
    linguaEstrangeira: null,
    treineiro: false,
    camposEncontrados: [],
  };

  // Número de inscrição: 12 dígitos (o CPF tem 11 e é descartado).
  const insc =
    texto.match(/inscri[çc][ãa]o[^\d\n]{0,40}(\d{12})\b/i) ||
    texto.match(/(?<![\d.])(\d{12})(?![\d])/);
  if (insc) r.numeroInscricao = insc[1];

  // Ano da edição.
  const ano =
    texto.match(/enem\s*[-–—/]?\s*(20\d{2})/i) ||
    texto.match(/exame\s+nacional\s+do\s+ensino\s+m[ée]dio[^\n]{0,30}?(20\d{2})/i);
  if (ano) r.ano = Number(ano[1]);
  else if (r.numeroInscricao) r.ano = 2000 + Number(r.numeroInscricao.slice(0, 2));

  // Notas das quatro áreas (0 a 1000) e da redação.
  for (const area of AREAS) {
    r.notas[area.chave] = notaDoRotulo(linhas, area.padrao, (n) => n >= 0 && n <= 1000, corrigirVirgulaPerdida);
  }
  r.notas.redacao = notaDoRotulo(
    linhas.filter((l) => !/compet[êe]ncia/i.test(l)),
    REDACAO,
    (n) => n >= 0 && n <= 1000 && Number.isInteger(n)
  );

  // Competências da redação (0 a 200 cada).
  for (const linha of linhas) {
    const m = linha.match(/compet[êe]ncia\s*([1-5])\b/i);
    if (!m) continue;
    const resto = linha.slice(m.index + m[0].length);
    const n = numerosDaLinha(resto).find((v) => Number.isInteger(v) && v >= 0 && v <= 200);
    if (n !== undefined && r.competencias[Number(m[1]) - 1] === null) r.competencias[Number(m[1]) - 1] = n;
  }

  const notas = [r.notas.lc, r.notas.ch, r.notas.cn, r.notas.mt, r.notas.redacao];
  if (notas.every((n) => typeof n === "number")) {
    r.mediaGeral = Math.round((notas.reduce((a, b) => a + b, 0) / 5) * 100) / 100;
  }

  // Local de prova (vem no Cartão de Confirmação).
  r.local.escola = valorDoRotulo(linhas, /\blocal\s+(?:de\s+)?(?:realiza[çc][ãa]o\s+da\s+)?prova\b|\bescola\b/i);
  r.local.endereco = valorDoRotulo(linhas, /\bendere[çc]o\b/i);
  r.local.municipio = valorDoRotulo(linhas, /\bmunic[íi]pio(?:\s*\/\s*uf)?\b|\bcidade(?:\s*\/\s*uf)?\b/i);
  const sala = texto.match(/\bsala\s*:?\s*([A-Z0-9][A-Z0-9-]{0,7})\b/i);
  if (sala) r.local.sala = sala[1];
  const bloco = texto.match(/\bbloco\s*:?\s*([A-Z0-9][A-Z0-9-]{0,7})\b/i);
  if (bloco) r.local.bloco = bloco[1];

  // Dias de prova.
  const d1 = texto.match(/1\s*[ºo°]\s*dia[^\d\n]{0,25}(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  const d2 = texto.match(/2\s*[ºo°]\s*dia[^\d\n]{0,25}(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  if (d1) r.dia1 = paraIso(d1[1]);
  if (d2) r.dia2 = paraIso(d2[1]);

  const lingua = texto.match(/l[íi]ngua\s+estrangeira[^A-Za-zÀ-ÿ\n]{0,5}[^\n]{0,20}?(ingl[êe]s|espanhol)/i);
  if (lingua) r.linguaEstrangeira = /ingl/i.test(lingua[1]) ? "Inglês" : "Espanhol";

  // "Treineiro: sim/não" — só marca quando não vier um "não" logo depois.
  const treineiro = texto.match(/treineiro[^\n]{0,15}?\b(sim|n[ãa]o)\b/i);
  r.treineiro = treineiro ? /^sim$/i.test(treineiro[1]) : /\btreineiro\b/i.test(texto);

  // Quais campos saíram do PDF (pra destacar no formulário).
  if (r.ano) r.camposEncontrados.push("ano");
  if (r.numeroInscricao) r.camposEncontrados.push("numeroInscricao");
  for (const [k, v] of Object.entries(r.notas)) if (v !== null) r.camposEncontrados.push("nota-" + k);
  r.competencias.forEach((v, i) => v !== null && r.camposEncontrados.push("comp-" + (i + 1)));
  for (const [k, v] of Object.entries(r.local)) if (v) r.camposEncontrados.push("local-" + k);
  if (r.dia1) r.camposEncontrados.push("dia1");
  if (r.dia2) r.camposEncontrados.push("dia2");
  if (r.linguaEstrangeira) r.camposEncontrados.push("lingua");

  return r;
}

export async function lerPdfDoEnem(arquivo, avisar) {
  const linhas = await lerLinhasDoPdf(arquivo, null, avisar);
  return interpretarLinhas(linhas);
}
