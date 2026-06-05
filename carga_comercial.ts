import { Database } from "bun:sqlite";
import ExcelJS from "exceljs";
import fs from "fs";
import path from "path";

// Define structures for insertion
interface MedicamentoRecord {
  registro_anvisa: string;
  nome_produto: string;
  apresentacao: string;
  laboratorio: string;
}

interface AssocRecord {
  registro_anvisa: string;
  id_dcb: number;
}

/**
 * Normalizes a string by converting it to lowercase, removing accents/diacritics,
 * and filtering out any non-alphanumeric character.
 */
function normalizeString(str: string): string {
  return str
    .normalize("NFD")                  // Decomposes accented characters into base + accent mark
    .replace(/[\u0300-\u036f]/g, "")   // Removes the decomposed accent marks
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");        // Retains only lowercase alphanumeric characters
}

/**
 * Safely extracts a trimmed string from an Excel cell.
 */
function getCleanCellString(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((t: any) => t.text).join("");
    }
    if ("text" in value) {
      return String(value.text);
    }
    if ("result" in value) {
      return value.result === null || value.result === undefined ? "" : String(value.result);
    }
    return JSON.stringify(value);
  }
  return String(value).trim();
}

async function runCommercialLoad() {
  const startTime = Date.now();
  console.log("=== INICIANDO ETAPA DE CARGA COMERCIAL ===");

  const xlsxPath = path.resolve("./input/xls_conformidade_site_20260508_234642408.xlsx");
  const equivalencyPath = path.resolve("./input/equivalencias.csv");
  const dbFilePath = path.resolve("./prescricao.db");

  // 1. Carregar equivalências em memória
  console.log(`[1/5] Carregando equivalências de: ${equivalencyPath}`);
  const equivalencyMap = new Map<string, number>();
  
  if (fs.existsSync(equivalencyPath)) {
    const eqContent = fs.readFileSync(equivalencyPath, "utf-8");
    const eqLines = eqContent.split(/\r?\n/);
    for (let i = 1; i < eqLines.length; i++) {
      const line = eqLines[i].trim();
      if (!line) continue;
      const parts = line.split(";");
      if (parts.length >= 2) {
        const key = normalizeString(parts[0]);
        const idVal = parseInt(parts[1].trim(), 10);
        if (!isNaN(idVal)) {
          equivalencyMap.set(key, idVal);
        }
      }
    }
    console.log(`Equivalências carregadas: ${equivalencyMap.size}`);
  } else {
    console.warn("Aviso: Arquivo de equivalências não encontrado. O script usará apenas consultas no banco.");
  }

  // 2. Conectar ao Banco de Dados e estruturar tabelas
  console.log(`[2/5] Conectando ao SQLite: ${dbFilePath}`);
  const db = new Database(dbFilePath);

  console.log("Recriando tabelas 'medicamentos' e 'medicamento_substancia' conforme a modelagem final...");
  db.run("DROP TABLE IF EXISTS medicamento_substancia;");
  db.run("DROP TABLE IF EXISTS medicamentos;");

  db.run(`
    CREATE TABLE IF NOT EXISTS medicamentos (
      registro_anvisa TEXT PRIMARY KEY,
      nome_produto TEXT,
      apresentacao TEXT,
      laboratorio TEXT
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS medicamento_substancia (
      registro_anvisa TEXT,
      id_dcb INTEGER,
      PRIMARY KEY (registro_anvisa, id_dcb),
      FOREIGN KEY(registro_anvisa) REFERENCES medicamentos(registro_anvisa) ON DELETE CASCADE,
      FOREIGN KEY(id_dcb) REFERENCES substancias(id_dcb) ON DELETE CASCADE
    );
  `);

  // 3. Abrir e analisar planilha Excel da Anvisa
  console.log(`[3/5] Abrindo arquivo Excel: ${xlsxPath}`);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsxPath);

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new Error("Planilha Excel vazia ou aba não encontrada.");
  }
  console.log(`Aba selecionada: "${sheet.name}". Total de linhas declaradas: ${sheet.rowCount}`);

  // Localizar dinamicamente a linha de cabeçalho
  console.log("Localizando linha de cabeçalho da planilha...");
  let headerRowIndex = -1;
  let colSubstance = -1;
  let colLab = -1;
  let colRegister = -1;
  let colProduct = -1;
  let colPresentation = -1;

  for (let r = 1; r <= 100; r++) {
    const row = sheet.getRow(r);
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      cells.push(String(cell.value).toUpperCase().trim());
    });

    if (cells.includes("REGISTRO") && (cells.includes("SUBSTÂNCIA") || cells.includes("SUBSTANCIA"))) {
      headerRowIndex = r;
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const val = String(cell.value).toUpperCase().trim();
        if (val === "SUBSTÂNCIA" || val === "SUBSTANCIA") colSubstance = colNumber;
        if (val === "LABORATÓRIO" || val === "LABORATORIO") colLab = colNumber;
        if (val === "REGISTRO") colRegister = colNumber;
        if (val === "PRODUTO") colProduct = colNumber;
        if (val === "APRESENTAÇÃO" || val === "APRESENTACAO") colPresentation = colNumber;
      });
      break;
    }
  }

  if (headerRowIndex === -1) {
    throw new Error("Erro: Não foi possível localizar os cabeçalhos de dados ('REGISTRO' e 'SUBSTÂNCIA') na planilha.");
  }

  console.log(`Linha de cabeçalho encontrada na posição: ${headerRowIndex}`);
  console.log(`Mapeamento de colunas: 
    - SUBSTÂNCIA: coluna ${colSubstance}
    - LABORATÓRIO: coluna ${colLab}
    - REGISTRO: coluna ${colRegister}
    - PRODUTO: coluna ${colProduct}
    - APRESENTAÇÃO: coluna ${colPresentation}`);

  // Prepared statements para lookups no banco
  const selectSubstance = db.prepare(`
    SELECT id_dcb FROM substancias 
    WHERE denominacao_normalizada = $norm 
       OR denominacao_base_normalizada = $norm
    LIMIT 1
  `);

  // Cache em memória para evitar consultas redundantes ao banco de dados
  const substanceDbCache = new Map<string, number | null>();

  function resolveSubstanceId(substanceName: string): number | null {
    const normalized = normalizeString(substanceName);
    if (!normalized) return null;

    // 1. Tentar equivalência em arquivo primeiro (suporta ignorar com ID 0)
    if (equivalencyMap.has(normalized)) {
      return equivalencyMap.get(normalized) ?? null;
    }

    // 2. Verificar cache em memória do banco
    if (substanceDbCache.has(normalized)) {
      return substanceDbCache.get(normalized) ?? null;
    }

    // 3. Consultar no SQLite
    const row = selectSubstance.get({ $norm: normalized }) as { id_dcb: number } | undefined;
    const resId = row ? row.id_dcb : null;
    substanceDbCache.set(normalized, resId);
    return resId;
  }

  // 4. Processamento das linhas de dados
  console.log("[4/5] Processando linhas de dados e resolvendo chaves DCB...");
  const medsToInsert: MedicamentoRecord[] = [];
  const assocsToInsert: AssocRecord[] = [];

  const startRow = headerRowIndex + 1;
  const totalRows = sheet.rowCount;
  
  let skippedRows = 0;
  let unresolvedSubstancesCount = 0;
  const uniqueUnresolvedSubstances = new Set<string>();

  for (let r = startRow; r <= totalRows; r++) {
    const row = sheet.getRow(r);
    if (!row || row.values.length === 0) continue;

    // Tratar o registro (manter apenas números)
    const rawRegister = getCleanCellString(row.getCell(colRegister));
    const strippedReg = rawRegister.replace(/[^0-9]/g, "");

    // Deve ter exatamente 13 dígitos
    if (strippedReg.length !== 13) {
      skippedRows++;
      continue;
    }

    const nomeProduto = getCleanCellString(row.getCell(colProduct));
    const apresentacao = getCleanCellString(row.getCell(colPresentation));
    const laboratorio = getCleanCellString(row.getCell(colLab));

    medsToInsert.push({
      registro_anvisa: strippedReg,
      nome_produto: nomeProduto,
      apresentacao,
      laboratorio
    });

    // Tratar substâncias (medicamentos compostos separados por ';' ou '+')
    const rawSubstances = getCleanCellString(row.getCell(colSubstance));
    const substanceParts = rawSubstances.split(/[;+]/).map(s => s.trim()).filter(Boolean);

    for (const part of substanceParts) {
      const resolvedId = resolveSubstanceId(part);
      
      if (resolvedId === 0) {
        // Regra estrita: Ignorar ID 0 (excipientes e veículos)
        continue;
      }
      
      if (resolvedId !== null) {
        assocsToInsert.push({
          registro_anvisa: strippedReg,
          id_dcb: resolvedId
        });
      } else {
        unresolvedSubstancesCount++;
        uniqueUnresolvedSubstances.add(part);
      }
    }
  }

  console.log(`Processamento concluído.
    - Medicamentos elegíveis: ${medsToInsert.length}
    - Relações de junção elegíveis: ${assocsToInsert.length}
    - Linhas descartadas (registro inválido): ${skippedRows}
    - Substâncias não resolvidas: ${unresolvedSubstancesCount} (únicas: ${uniqueUnresolvedSubstances.size})`);

  // 5. Ingestão em lote na transação (db.transaction)
  console.log("[5/5] Inserindo registros no banco de dados SQLite...");
  
  const insertMedsStmt = db.prepare(`
    INSERT OR IGNORE INTO medicamentos (registro_anvisa, nome_produto, apresentacao, laboratorio)
    VALUES ($registro_anvisa, $nome_produto, $apresentacao, $laboratorio)
  `);

  const insertAssocStmt = db.prepare(`
    INSERT OR IGNORE INTO medicamento_substancia (registro_anvisa, id_dcb)
    VALUES ($registro_anvisa, $id_dcb)
  `);

  const runLoadTransaction = db.transaction((meds: MedicamentoRecord[], assocs: AssocRecord[]) => {
    let insertedMeds = 0;
    let insertedAssocs = 0;

    for (const med of meds) {
      const result = insertMedsStmt.run({
        $registro_anvisa: med.registro_anvisa,
        $nome_produto: med.nome_produto,
        $apresentacao: med.apresentacao,
        $laboratorio: med.laboratorio
      });
      if (result.changes > 0) insertedMeds++;
    }

    for (const assoc of assocs) {
      const result = insertAssocStmt.run({
        $registro_anvisa: assoc.registro_anvisa,
        $id_dcb: assoc.id_dcb
      });
      if (result.changes > 0) insertedAssocs++;
    }

    return { insertedMeds, insertedAssocs };
  });

  const { insertedMeds, insertedAssocs } = runLoadTransaction(medsToInsert, assocsToInsert);

  console.log("Criando índices na tabela de junção medicamento_substancia...");
  db.run("CREATE INDEX IF NOT EXISTS idx_med_sub_registro ON medicamento_substancia(registro_anvisa);");
  db.run("CREATE INDEX IF NOT EXISTS idx_med_sub_substancia ON medicamento_substancia(id_dcb);");

  // Fechar banco de dados de forma limpa
  db.close();

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n=== CARGA COMERCIAL CONCLUÍDA COM SUCESSO ===`);
  console.log(`Tempo total gasto:                       ${totalTime}s`);
  console.log(`Total de medicamentos inseridos:         ${insertedMeds}`);
  console.log(`Total de relações inseridas:             ${insertedAssocs}`);
}

runCommercialLoad().catch((error) => {
  console.error("Erro fatal na execução da Carga Comercial:", error);
  process.exit(1);
});
