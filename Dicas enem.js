// ---------------------------------------------------------------------------
// Base de estudo do painel "Seu desempenho" (aba Feed).
//
// Tudo aqui foi tirado de sites de preparação para o Enem e de fontes oficiais,
// com o link ao lado. Os percentuais são os que a PRÓPRIA fonte publicou e
// valem dentro de cada disciplina (ex.: 21,1% das questões de Física), não da
// área inteira. Nada é inventado: quando a fonte não dá número, não tem número.
//
// Pra atualizar: trocar os itens e a data abaixo (ideal: depois de cada Enem,
// quando os levantamentos são refeitos).
// ---------------------------------------------------------------------------
 
export const ATUALIZADO_EM = "21/09/2026";
 
export const FONTES = {
  aprova: {
    nome: "Aprova Total — Assuntos que mais caem no Enem (provas 2016–2025, publicado em 27/08/2026)",
    url: "https://aprovatotal.com.br/assuntos-mais-cobrados-no-enem/",
  },
  estrategia: {
    nome: "Estratégia Vestibulares — Assuntos que mais caem no Enem (atualizado em 06/11/2025)",
    url: "https://vestibulares.estrategia.com/portal/enem-e-vestibulares/enem/assuntos-que-mais-caem-no-enem/",
  },
  estrategiaMat: {
    nome: "Estratégia Vestibulares — Assuntos de Matemática que mais caem (atualizado em 10/05/2022)",
    url: "https://vestibulares.estrategia.com/portal/enem-e-vestibulares/vestibulares/assuntos-de-matematica-que-mais-caem-no-enem/",
  },
  cnnRanking: {
    nome: "CNN Brasil / SAS Educação — Ranking dos temas mais cobrados, 2009–2024 (22/05/2025)",
    url: "https://www.cnnbrasil.com.br/educacao/enem-veja-ranking-dos-temas-mais-cobrados-entre-2009-e-2024/",
  },
  estrategiaRedacao: {
    nome: "Estratégia Vestibulares — Competências da redação do Enem (atualizado em 05/11/2025)",
    url: "https://vestibulares.estrategia.com/portal/materias/redacao/competencias-redacao-enem/",
  },
  agenciaCartilha: {
    nome: "Agência Brasil — Cartilha de redação do Enem 2025 (out/2025)",
    url: "https://agenciabrasil.ebc.com.br/educacao/noticia/2025-10/cartilha-de-redacao-do-enem-2025-esta-disponivel-para-consulta",
  },
  preparaC5: {
    nome: "PrePara Enem — Competência 5 da redação",
    url: "https://www.preparaenem.com/portugues/competencia-5-da-redacao-do-enem.htm",
  },
  agenciaTri: {
    nome: "Agência Brasil — Como é calculada a nota das provas objetivas do Enem 2025 (06/11/2025)",
    url: "https://agenciabrasil.ebc.com.br/educacao/noticia/2025-11/entenda-como-e-calculada-nota-das-provas-objetivas-do-enem-2025",
  },
  cnnTri: {
    nome: "CNN Brasil — O que é a TRI e como ela molda sua nota (27/10/2025)",
    url: "https://www.cnnbrasil.com.br/educacao/enem-entenda-o-que-e-a-tri-e-como-ela-molda-sua-nota-final/",
  },
  cnnTempo: {
    nome: "CNN Brasil — Como organizar o tempo em cada dia de prova (10/10/2024)",
    url: "https://www.cnnbrasil.com.br/educacao/enem-2024-saiba-como-organizar-seu-tempo-em-cada-dia-da-prova/",
  },
  descomplica: {
    nome: "Descomplica — Assuntos que mais caem no Enem (atualizado em 25/10/2024)",
    url: "https://descomplica.com.br/blog/assuntos-que-mais-caem-no-enem/",
  },
};
 
// Conteúdos mais cobrados, por área (chaves iguais às das notas: lc, ch, cn, mt).
// Cada grupo é uma disciplina; "pct" é o percentual dentro dela, pela fonte.
export const CONTEUDOS = {
  lc: {
    nome: "Linguagens",
    grupos: [
      {
        disciplina: "Português",
        fonte: "aprova",
        itens: [
          { t: "Gêneros textuais", pct: 44.1, d: "identificar o gênero, a função e a finalidade do texto" },
          { t: "Leitura e compreensão", pct: 22.1, d: "fundamentos de interpretação de texto" },
          { t: "Linguagem culta e coloquial", pct: 10.7, d: "variação linguística e adequação ao contexto" },
          { t: "Texto e contexto", pct: 7, d: "relacionar o texto à situação em que foi produzido" },
          { t: "Funções da linguagem", pct: 5.9, d: "referencial, emotiva, conativa, metalinguística…" },
        ],
      },
      {
        disciplina: "Literatura e Artes",
        fonte: "aprova",
        itens: [
          { t: "Literatura contemporânea", pct: 30.8 },
          { t: "Artes", pct: 21.2 },
          { t: "Modernismo", pct: 19.9 },
        ],
      },
      {
        disciplina: "Língua estrangeira",
        fonte: "estrategia",
        itens: [
          { t: "Inglês: interpretação de texto", pct: 80.95, d: "provas de 1998 a 2020" },
          { t: "Espanhol: compreensão de texto", pct: 73.28, d: "o vocabulário vem do próprio texto" },
        ],
      },
    ],
  },
  ch: {
    nome: "Ciências Humanas",
    grupos: [
      {
        disciplina: "História",
        fonte: "aprova",
        itens: [
          { t: "Brasil Colônia", pct: 11.8, d: "economia, escravidão e resistência" },
          { t: "Estado Novo e Populismo", pct: 10.3, d: "Era Vargas e trabalhismo" },
          { t: "Idade Média", pct: 10.3, d: "feudalismo e Igreja" },
          { t: "Tempo Presente", pct: 9.6 },
          { t: "Idade Moderna", pct: 9.6 },
        ],
      },
      {
        disciplina: "Geografia",
        fonte: "aprova",
        itens: [
          { t: "Espaço agrário", pct: 12.4, d: "agronegócio e conflitos no campo" },
          { t: "Espaço urbano", pct: 11.8, d: "urbanização e seus problemas" },
          { t: "Geopolítica", pct: 11.2 },
          { t: "Geologia", pct: 6.5 },
        ],
      },
      {
        disciplina: "Filosofia",
        fonte: "aprova",
        itens: [
          { t: "Filosofia antiga", pct: 28.1 },
          { t: "Filosofia moderna", pct: 18.8 },
          { t: "Mal e justiça", pct: 12.5 },
        ],
      },
      {
        disciplina: "Sociologia",
        fonte: "aprova",
        itens: [
          { t: "Cultura e sociedade", pct: 19 },
          { t: "Movimentos sociais", pct: 18.1 },
          { t: "Estado e cidadania", pct: 15.2 },
        ],
      },
    ],
  },
  cn: {
    nome: "Ciências da Natureza",
    grupos: [
      {
        disciplina: "Biologia",
        fonte: "aprova",
        itens: [
          { t: "Ecologia", pct: 26, d: "cadeias alimentares, desequilíbrios e impactos ambientais" },
          { t: "Zoologia", pct: 8.3 },
          { t: "Fisiologia humana", pct: 7.7 },
          { t: "Botânica", pct: 7.1 },
          { t: "Bioenergética", pct: 7.1, d: "fotossíntese e respiração" },
        ],
      },
      {
        disciplina: "Física",
        fonte: "aprova",
        itens: [
          { t: "Eletrodinâmica", pct: 21.1, d: "circuitos, potência e consumo de energia" },
          { t: "Termologia", pct: 16, d: "calor, calorimetria e trocas térmicas" },
          { t: "Ondulatória", pct: 13.7, d: "ondas, som e frequência" },
          { t: "Cinemática", pct: 11.4 },
          { t: "Óptica", pct: 9.1, d: "espelhos, lentes e refração" },
        ],
      },
      {
        disciplina: "Química",
        fonte: "aprova",
        itens: [
          { t: "Moléculas e propriedades", pct: 8.6, d: "polaridade e forças intermoleculares" },
          { t: "Estequiometria", pct: 7.9, d: "cálculos de massa e mol" },
          { t: "Separação de misturas", pct: 6.6 },
          { t: "Funções inorgânicas", pct: 6.6 },
          { t: "Eletroquímica", pct: 6.6, d: "pilhas e eletrólise" },
        ],
      },
    ],
  },
  mt: {
    nome: "Matemática",
    grupos: [
      {
        disciplina: "Matemática",
        fonte: "aprova",
        itens: [
          { t: "Matemática básica", pct: 37.3, d: "porcentagem, razão e proporção, regra de três" },
          { t: "Estatística", pct: 11.2, d: "média, mediana, moda e leitura de gráficos" },
          { t: "Geometria espacial", pct: 11.2, d: "volumes e áreas de sólidos" },
          { t: "Funções", pct: 10.2, d: "1º e 2º grau, exponencial e logarítmica" },
          { t: "Geometria plana", pct: 7.7, d: "áreas, semelhança e trigonometria" },
        ],
      },
      {
        disciplina: "Complemento",
        fonte: "estrategiaMat",
        itens: [
          { t: "Probabilidade", pct: 4.1 },
          { t: "Progressões (PA e PG)", pct: 2.47 },
          { t: "Análise combinatória", pct: 2.05 },
        ],
      },
    ],
  },
};
 
// As 5 competências da redação (nomes da cartilha do Inep) e dicas para subir.
export const COMPETENCIAS = [
  {
    n: 1,
    nome: "Domínio da escrita formal",
    curto: "Escrita formal",
    avalia: "ortografia, acentuação, concordância, regência e pontuação",
    dicas: [
      "Para 200, desvios só são aceitos como exceção e sem se repetir — revise concordância e pontuação na versão final.",
      "Guarde uns minutos para passar o rascunho a limpo com calma: é ali que escapam acentos e vírgulas.",
    ],
    fonte: "estrategiaRedacao",
  },
  {
    n: 2,
    nome: "Compreender a proposta e o tipo de texto",
    curto: "Tema e repertório",
    avalia: "tema, tipo dissertativo-argumentativo e repertório de várias áreas",
    dicas: [
      "Siga a estrutura introdução, desenvolvimento e conclusão.",
      "Use repertório produtivo: um livro, filme, dado ou pensador ligado ao tema e usado no argumento — não só citado.",
      "Fugir do tema ou do tipo textual zera a redação.",
    ],
    fonte: "estrategiaRedacao",
  },
  {
    n: 3,
    nome: "Organizar os argumentos",
    curto: "Argumentação",
    avalia: "selecionar, relacionar e interpretar informações em defesa de um ponto de vista",
    dicas: [
      "Monte um projeto de texto (tese + 2 argumentos) antes de escrever.",
      "Evite contradições e ideias soltas — cada parágrafo precisa servir à tese.",
    ],
    fonte: "estrategiaRedacao",
  },
  {
    n: 4,
    nome: "Coesão", curto: "Coesão",
    avalia: "mecanismos linguísticos que ligam as ideias",
    dicas: [
      "Varie os conectivos (preposições, conjunções, advérbios) e não repita o mesmo.",
      "Ligue as ideias dentro de cada parágrafo e também entre um parágrafo e outro.",
    ],
    fonte: "estrategiaRedacao",
  },
  {
    n: 5,
    nome: "Proposta de intervenção",
    curto: "Intervenção",
    avalia: "solução para o problema, respeitando os direitos humanos",
    dicas: [
      "Inclua os 5 elementos: agente, ação, modo/meio, finalidade e detalhamento.",
      "Use agentes concretos (governo, ONGs, escolas, mídia) em vez de \"a sociedade\".",
      "Amarre a proposta à discussão que você fez no texto.",
    ],
    fonte: "preparaC5",
  },
];
 
export const ZERA_REDACAO =
  "Zera a redação: fuga ao tema, não seguir o tipo dissertativo-argumentativo, até 7 linhas, texto predominantemente em língua estrangeira, identificação do candidato, desenhos ou impropérios.";
 
// Estratégia de prova.
export const ESTRATEGIA = [
  { t: "Faça as fáceis primeiro", d: "Na TRI elas formam a base da nota. Passe os olhos em todas e comece pelas mais tranquilas.", fonte: "cnnTri" },
  { t: "Não chute no escuro", d: "Acertar difíceis errando fáceis é visto como possível chute e pesa pouco. Se for chutar, elimine alternativas antes. Em branco conta como erro.", fonte: "agenciaTri" },
  { t: "Cerca de 3 minutos por questão", d: "Reserve de 1h a 1h30 para a redação no 1º dia.", fonte: "cnnTempo" },
  { t: "Linguagens: leia as alternativas antes do texto", d: "Ajuda a saber o que procurar e poupa tempo.", fonte: "cnnTempo" },
  { t: "Resolva provas anteriores", d: "Principalmente as dos últimos quatro anos, e faça simulados cronometrados.", fonte: "descomplica" },
];
 
export const TRI =
  "A nota das provas objetivas usa a Teoria de Resposta ao Item (TRI): cada questão tem dificuldade, poder de discriminação e chance de acerto ao acaso. Como o Inep considera que o conhecimento é cumulativo, quem erra as fáceis e acerta as difíceis tem esses acertos vistos como possível chute. Por isso, dois candidatos com o mesmo número de acertos podem ter notas diferentes.";