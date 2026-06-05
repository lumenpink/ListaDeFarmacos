import { Database } from "bun:sqlite";
import ExcelJS from "exceljs";
import path from "path";

// Define the interface for our normalized data structure
interface Substancia {
  id_dcb: number;
  denominacao: string;
  denominacao_normalizada: string;
  cas: string | null;
  classificacao: string;
}

/**
 * Helper to extract, clean, and trim string values from various Excel cell types
 */
function cleanString(value: any): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  
  let str: string;
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      str = value.richText.map((t: any) => t.text).join("");
    } else if ("text" in value) {
      str = String(value.text);
    } else if ("result" in value) {
      str = value.result === null || value.result === undefined ? "" : String(value.result);
    } else {
      str = JSON.stringify(value);
    }
  } else {
    str = String(value);
  }
  
  const trimmed = str.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Normalizes a string by converting it to lowercase, removing accents/diacritics, 
 * and filtering out any non-alphanumeric character. This creates a canonical key 
 * for safe data linking and comparison.
 */
function normalizeName(name: string): string {
  return name
    .normalize("NFD")                  // Decomposes accented characters into base + accent mark
    .replace(/[\u0300-\u036f]/g, "")   // Removes the decomposed accent marks
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");        // Retains only lowercase alphanumeric characters
}

/**
 * Helper to safely extract integer values from cells
 */
function parseInteger(value: any): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  
  let val = value;
  if (typeof value === "object" && "result" in value) {
    val = value.result;
  }
  
  const num = Number(val);
  return Number.isInteger(num) ? num : null;
}

async function runETL() {
  console.log("=== INICIANDO PROCESSO ETL (COM NORMALIZAÇÃO DE NOMES) ===");

  const excelFilePath = path.resolve("./input/1- Lista DCB consolidada abr 2026.xlsx");
  const dbFilePath = path.resolve("./prescricao.db");

  console.log(`[1/4] Conectando ao SQLite: ${dbFilePath}`);
  const db = new Database(dbFilePath);

  // Recria a tabela substancias para refletir a nova estrutura da coluna de normalização
  db.run("DROP TABLE IF EXISTS substancias;");
  db.run(`
    CREATE TABLE IF NOT EXISTS substancias (
      id_dcb INTEGER PRIMARY KEY,
      denominacao TEXT NOT NULL,
      denominacao_normalizada TEXT NOT NULL,
      cas TEXT,
      classificacao TEXT NOT NULL
    );
  `);

  console.log(`[2/4] Abrindo arquivo Excel: ${excelFilePath}`);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(excelFilePath);

  // Selecionar a primeira aba
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error("Erro: Nenhuma aba encontrada na planilha Excel.");
  }
  console.log(`Aba selecionada: "${worksheet.name}"`);

  let totalLidas = 0;
  let totalFiltradas = 0;
  let totalInseridas = 0;

  const validClassifications = new Set(["IFA", "BIO", "PM", "INF"]);
  const recordsToInsert: Substancia[] = [];

  console.log("[3/4] Extraindo, limpando e filtrando dados...");

  // A leitura deve iniciar estritamente a partir da linha 3
  const startRow = 3;
  const totalRows = worksheet.rowCount;

  for (let r = startRow; r <= totalRows; r++) {
    const row = worksheet.getRow(r);
    
    // Ignorar se a linha ou seus valores estiverem completamente vazios
    if (!row || row.values.length === 0) {
      continue;
    }

    const rawId = row.getCell(1).value;
    const rawDenominacao = row.getCell(2).value;
    const rawCas = row.getCell(3).value;
    const rawClassificacao = row.getCell(4).value;

    // Pular linhas completamente nulas
    if (rawId === null && rawDenominacao === null && rawCas === null && rawClassificacao === null) {
      continue;
    }

    totalLidas++;

    const id_dcb = parseInteger(rawId);
    const denominacao = cleanString(rawDenominacao);
    const cas = cleanString(rawCas);
    const classificacao = cleanString(rawClassificacao);

    // Filtragem e validação dos dados
    if (id_dcb === null) {
      totalFiltradas++;
      continue;
    }

    if (!denominacao) {
      totalFiltradas++;
      continue;
    }

    // Filtro rígido: classificação deve ser estritamente 'IFA', 'BIO' ou 'PM'
    if (!classificacao || !validClassifications.has(classificacao)) {
      totalFiltradas++;
      continue;
    }

    // Gerar denominação normalizada (sem acentos, minúsculo, sem caracteres especiais ou espaços)
    const denominacao_normalizada = normalizeName(denominacao);

    recordsToInsert.push({
      id_dcb,
      denominacao,
      denominacao_normalizada,
      cas,
      classificacao
    });
  }

  console.log(`[4/4] Inserindo registros no SQLite... (${recordsToInsert.length} registros elegíveis)`);

  // Utilizar prepared statement para inserção segura
  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO substancias (id_dcb, denominacao, denominacao_normalizada, cas, classificacao)
    VALUES ($id_dcb, $denominacao, $denominacao_normalizada, $cas, $classificacao)
  `);

  // Transação em lote (bulk/batch transaction)
  const insertTransaction = db.transaction((items: Substancia[]) => {
    let count = 0;
    for (const item of items) {
      insertStmt.run({
        $id_dcb: item.id_dcb,
        $denominacao: item.denominacao,
        $denominacao_normalizada: item.denominacao_normalizada,
        $cas: item.cas,
        $classificacao: item.classificacao
      });
      count++;
    }
    return count;
  });

  if (recordsToInsert.length > 0) {
    totalInseridas = insertTransaction(recordsToInsert);
  }

  // Fechar o banco de dados de forma limpa
  db.close();

  console.log("\n=== PROCESSO ETL CONCLUÍDO ===");
  console.log(`Total de linhas lidas da planilha:      ${totalLidas}`);
  console.log(`Total de linhas filtradas/descartadas:  ${totalFiltradas}`);
  console.log(`Total de linhas inseridas no SQLite:    ${totalInseridas}`);
}

runETL().catch((error) => {
  console.error("Erro fatal na execução do processo ETL:", error);
  process.exit(1);
});
