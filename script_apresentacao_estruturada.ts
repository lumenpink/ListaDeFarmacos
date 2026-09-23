import { Database } from "bun:sqlite";
import fs from "fs";
import path from "path";

// 1. Dicionário de Formas Farmacêuticas
const formDictionary = [
  { key: "COM REV", translation: "Comprimido Revestido" },
  { key: "COM LIB PROL", translation: "Comprimido de Liberação Prolongada" },
  { key: "COM MAST", translation: "Comprimido Mastigável" },
  { key: "COM EFEV", translation: "Comprimido Efervescente" },
  { key: "COM ORODISP", translation: "Comprimido Orodispersível" },
  { key: "COM", translation: "Comprimido" },
  { key: "CAP GEL DURA", translation: "Cápsula" },
  { key: "CAP LIB RET", translation: "Cápsula de Liberação Retardada" },
  { key: "CAP", translation: "Cápsula" },
  { key: "SOL OR", translation: "Solução Oral" },
  { key: "SOL INJ", translation: "Solução Injetável" },
  { key: "SOL NAS", translation: "Solução Nasal" },
  { key: "SOL OFT", translation: "Solução Oftálmica" },
  { key: "SOL TOP", translation: "Solução Tópica" },
  { key: "SOL", translation: "Solução" },
  { key: "SUS OR", translation: "Suspensão Oral" },
  { key: "SUS INJ", translation: "Suspensão Injetável" },
  { key: "SUS NAS", translation: "Suspensão Nasal" },
  { key: "SUS OFT", translation: "Suspensão Oftálmica" },
  { key: "SUS", translation: "Suspensão" },
  { key: "PO LIOF SOL INJ", translation: "Pó Liofilizado para Solução Injetável" },
  { key: "PO LIOF SOL INFUS", translation: "Pó Liofilizado para Infusão" },
  { key: "PO LIOF INJ", translation: "Pó Liofilizado Injetável" },
  { key: "PO LIOF", translation: "Pó Liofilizado" },
  { key: "PO SOL", translation: "Pó para Solução" },
  { key: "PO SUS", translation: "Pó para Suspensão" },
  { key: "PO EFEV", translation: "Pó Efervescente" },
  { key: "PO", translation: "Pó" },
  { key: "XPE", translation: "Xarope" },
  { key: "POM", translation: "Pomada" },
  { key: "CREM DERM", translation: "Creme Dermatológico" },
  { key: "CREM", translation: "Creme" },
  { key: "DRG", translation: "Drágea" },
  { key: "GEL OR", translation: "Gel Oral" },
  { key: "GEL", translation: "Gel" },
  { key: "EMU DERM", translation: "Emulsão Dermatológica" },
  { key: "EMU", translation: "Emulsão" },
  { key: "PAS DURA", translation: "Pastilha Dura" },
  { key: "PAS", translation: "Pastilha" },
  { key: "PAST", translation: "Pastilha" },
  { key: "ELX", translation: "Elixir" },
  { key: "GRAN", translation: "Granulado" },
  { key: "IMPL", translation: "Implante" },
  { key: "ADES TRANSD", translation: "Adesivo Transdérmico" },
  { key: "SHAMP", translation: "Shampoo" },
  { key: "XAMP", translation: "Shampoo" }
];

// 2. Dicionário de Embalagens
const packagingMap = [
  { key: "FA", translation: "Frasco-Ampola" },
  { key: "FRASCOS-AMPOLAS", translation: "Frasco-Ampola" },
  { key: "FRASCO-AMPOLA", translation: "Frasco-Ampola" },
  { key: "FRASCOS", translation: "Frasco" },
  { key: "FRASCO", translation: "Frasco" },
  { key: "FR", translation: "Frasco" },
  { key: "AMPOLAS", translation: "Ampola" },
  { key: "AMPOLA", translation: "Ampola" },
  { key: "AMP", translation: "Ampola" },
  { key: "BISNAGA", translation: "Bisnaga" },
  { key: "BISN", translation: "Bisnaga" },
  { key: "BG", translation: "Bisnaga" },
  { key: "TUBO", translation: "Tubo" },
  { key: "TB", translation: "Tubo" },
  { key: "SERINGA", translation: "Seringa" },
  { key: "SER", translation: "Seringa" },
  { key: "SACHE", translation: "Sachê" },
  { key: "SACH", translation: "Sachê" },
  { key: "ENVELOPE", translation: "Envelope" },
  { key: "ENV", translation: "Envelope" },
  { key: "BLISTER", translation: "Blister" },
  { key: "BL", translation: "Blister" },
  { key: "CARTUCHO", translation: "Caixa" },
  { key: "CT", translation: "Caixa" },
  { key: "CAIXA", translation: "Caixa" },
  { key: "CX", translation: "Caixa" },
  { key: "BOLS", translation: "Bolsa" },
  { key: "PT", translation: "Pote" }
];

// Logistical indicators to slice the prefix
const logisticalIndicators = ["CT", "FR", "ENV", "BL", "BG", "AMP", "SER", "FA", "TB", "SACH", "PT", "PEAD", "CX"];

function parseStructuredApresentacao(apresentacao: string) {
  const upper = apresentacao.toUpperCase();

  // 1. Encontrar o índice do primeiro indicador logístico para separar a forma
  let firstIndicatorIndex = apresentacao.length;
  for (const ind of logisticalIndicators) {
    const pattern = new RegExp(`\\b${ind}\\b`, 'i');
    const match = upper.match(pattern);
    if (match && match.index !== undefined && match.index < firstIndicatorIndex) {
      firstIndicatorIndex = match.index;
    }
  }

  const prefix = upper.substring(0, firstIndicatorIndex).trim();

  // 2. Identificar Forma Farmacêutica a partir do prefixo
  let matchedForm: string | null = null;
  for (const item of formDictionary) {
    const pattern = new RegExp(`\\b${item.key}\\b`, 'i');
    if (pattern.test(prefix)) {
      matchedForm = item.translation;
      break;
    }
  }

  // Fallback: busca na string completa se não encontrar no prefixo
  if (!matchedForm) {
    for (const item of formDictionary) {
      const pattern = new RegExp(`\\b${item.key}\\b`, 'i');
      if (pattern.test(upper)) {
        matchedForm = item.translation;
        break;
      }
    }
  }

  // 3. Identificar Embalagem na string inteira (varredura pelo mapa de embalagens)
  let matchedPackage: string | null = null;
  for (const item of packagingMap) {
    const pattern = new RegExp(`\\b${item.key}\\b`, 'i');
    if (pattern.test(upper)) {
      matchedPackage = item.translation;
      break;
    }
  }

  // 4. Identificar Quantidade (número e unidade) após X, C/ ou CONT
  const qtyMatch = upper.match(/(?:\bX\b|\bC\/|\bCONT\b)\s*(\d+(?:[\.,]\d+)?)\s*([A-Z%]+)?/i);
  let qtyStr: string | null = null;
  if (qtyMatch) {
    const qty = qtyMatch[1];
    const unit = qtyMatch[2] ? ` ${qtyMatch[2]}` : "";
    qtyStr = `${qty}${unit}`;
  }

  return {
    forma: matchedForm,
    embalagem: matchedPackage,
    quantidade: qtyStr
  };
}

async function runStructuredParsing() {
  console.log("=== INICIANDO PARSER HEURÍSTICO DE APRESENTAÇÕES (ESTRUTURADAS) ===");

  const dbFilePath = path.resolve("./prescricao.db");
  const csvFailuresPath = path.resolve("./input/apresentacoes_nao_estruturadas.csv");

  // 1. Conectar ao Banco de Dados SQLite
  console.log(`[1/5] Conectando ao SQLite: ${dbFilePath}`);
  const db = new Database(dbFilePath);

  // 2. Modificação do Banco de Dados: Adicionar novas colunas se não existirem
  console.log("[2/5] Verificando e criando colunas na tabela 'medicamentos'...");
  const tableInfo = db.query("PRAGMA table_info(medicamentos);").all() as { name: string }[];
  
  const columnsToAdd = [
    { name: "forma_farmaceutica", type: "TEXT" },
    { name: "tipo_embalagem", type: "TEXT" },
    { name: "quantidade_apresentacao", type: "TEXT" }
  ];

  for (const col of columnsToAdd) {
    const exists = tableInfo.some((info) => info.name === col.name);
    if (!exists) {
      console.log(`Adicionando coluna '${col.name}' à tabela 'medicamentos'...`);
      db.run(`ALTER TABLE medicamentos ADD COLUMN ${col.name} ${col.type};`);
    }
  }

  // Limpar colunas antigas para importação limpa
  db.run(`
    UPDATE medicamentos 
    SET forma_farmaceutica = NULL, 
        tipo_embalagem = NULL, 
        quantidade_apresentacao = NULL;
  `);

  // 3. Ler registros do banco de dados
  console.log("[3/5] Carregando e parseando as apresentações dos medicamentos...");
  const rows = db.query("SELECT registro_anvisa, apresentacao FROM medicamentos").all() as { registro_anvisa: string; apresentacao: string }[];
  
  interface UpdateRecord {
    registro_anvisa: string;
    forma: string | null;
    embalagem: string | null;
    quantidade: string | null;
  }

  const updates: UpdateRecord[] = [];
  const failuresSet = new Set<string>();
  
  let successCount = 0;
  let failCount = 0;

  for (const row of rows) {
    const parsed = parseStructuredApresentacao(row.apresentacao);
    
    // Regra estrita: Só preencher as 3 colunas se conseguir extrair de forma confiável a forma E a quantidade
    if (parsed.forma && parsed.quantidade) {
      updates.push({
        registro_anvisa: row.registro_anvisa,
        forma: parsed.forma,
        embalagem: parsed.embalagem || "Outro", // default a Outro se não identificar embalagem específica
        quantidade: parsed.quantidade
      });
      successCount++;
    } else {
      updates.push({
        registro_anvisa: row.registro_anvisa,
        forma: null,
        embalagem: null,
        quantidade: null
      });
      failuresSet.add(row.apresentacao);
      failCount++;
    }
  }

  // 4. Executar os updates em lote na transação
  console.log("[4/5] Gravando dados estruturados em lote no banco...");
  
  const updateStmt = db.prepare(`
    UPDATE medicamentos 
    SET forma_farmaceutica = $forma,
        tipo_embalagem = $embalagem,
        quantidade_apresentacao = $quantidade
    WHERE registro_anvisa = $registro_anvisa
  `);

  const runUpdatesTransaction = db.transaction((records: UpdateRecord[]) => {
    let count = 0;
    for (const rec of records) {
      updateStmt.run({
        $forma: rec.forma,
        $embalagem: rec.embalagem,
        $quantidade: rec.quantidade,
        $registro_anvisa: rec.registro_anvisa
      });
      count++;
    }
    return count;
  });

  const executedUpdates = runUpdatesTransaction(updates);
  console.log(`Registros atualizados com sucesso no SQLite: ${executedUpdates}`);

  // 5. Exportar falhas para o arquivo CSV de não estruturadas
  console.log(`[5/5] Escrevendo apresentações não estruturadas em: ${csvFailuresPath}`);
  const csvLines = ["apresentacao_original"];
  for (const failRaw of failuresSet) {
    csvLines.push(failRaw);
  }
  
  fs.writeFileSync(csvFailuresPath, csvLines.join("\n"), "utf-8");

  // Fechar conexão de forma limpa
  db.close();

  const total = successCount + failCount;
  const successRate = total > 0 ? ((successCount / total) * 100).toFixed(2) : "0.00";

  console.log("\n=== PARSE DE APRESENTAÇÃO ESTRUTURADA CONCLUÍDO ===");
  console.log(`Total de medicamentos processados:    ${total}`);
  console.log(`Total com sucesso (estruturados):     ${successCount}`);
  console.log(`Total com falha (logs em CSV):        ${failCount}`);
  console.log(`Taxa de sucesso da segmentação:       ${successRate}%`);
  console.log(`Total de apresentações únicas falhas: ${failuresSet.size}`);
}

runStructuredParsing().catch((error) => {
  console.error("Erro fatal na execução do parser de apresentações estruturadas:", error);
  process.exit(1);
});
