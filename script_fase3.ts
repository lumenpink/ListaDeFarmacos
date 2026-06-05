import { Database } from "bun:sqlite";
import fs from "fs";
import path from "path";

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

async function runPhase3() {
  console.log("=== INICIANDO PROCESSO ETL - FASE 3 (INTEGRAÇÃO DE TRAVAS PORTARIA 344/98) ===");

  const csvPath = path.resolve("./portaria_344_completa.csv");
  const dbFilePath = path.resolve("./prescricao.db");
  const logMissesPath = path.resolve("./logs_rdc_nao_encontrados.txt");

  // 1. Conectar ao Banco de Dados SQLite
  console.log(`[1/4] Conectando ao SQLite: ${dbFilePath}`);
  const db = new Database(dbFilePath);

  // 2. Preparar a Tabela: Verificar/Adicionar coluna lista_controle
  console.log("[2/4] Verificando estrutura da tabela 'substancias'...");
  const tableInfo = db.query("PRAGMA table_info(substancias);").all() as { name: string }[];
  const columnExists = tableInfo.some((col) => col.name === "lista_controle");

  if (!columnExists) {
    console.log("Adicionando coluna 'lista_controle' à tabela 'substancias'...");
    db.run("ALTER TABLE substancias ADD COLUMN lista_controle TEXT;");
  } else {
    console.log("Coluna 'lista_controle' já existente.");
  }

  // 3. Ler e parsear o arquivo CSV
  if (!fs.existsSync(csvPath)) {
    console.error(`Erro: Arquivo CSV não encontrado em: ${csvPath}`);
    db.close();
    process.exit(1);
  }

  console.log(`[3/4] Lendo arquivo CSV: ${csvPath}`);
  const csvContent = fs.readFileSync(csvPath, "utf-8");
  const lines = csvContent.split(/\r?\n/);

  interface UpdateItem {
    originalSubstance: string;
    normalizedSubstance: string;
    listaControle: string;
  }

  const itemsToUpdate: UpdateItem[] = [];
  
  // Omitir cabeçalho (primeira linha)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Split pelo último ponto e vírgula para tolerar nomes contendo ';'
    const separatorIndex = line.lastIndexOf(";");
    if (separatorIndex === -1) {
      continue;
    }

    const substanceName = line.substring(0, separatorIndex).trim();
    const listCategory = line.substring(separatorIndex + 1).trim();

    if (!substanceName || !listCategory) {
      continue;
    }

    itemsToUpdate.push({
      originalSubstance: substanceName,
      normalizedSubstance: normalizeString(substanceName),
      listaControle: listCategory,
    });
  }

  console.log(`Total de substâncias carregadas do CSV: ${itemsToUpdate.length}`);

  // 4. Executar os Updates em lote usando db.transaction()
  console.log("[4/4] Executando atualizações no banco de dados...");
  
  const updateStmt = db.prepare(`
    UPDATE substancias 
    SET lista_controle = $lista_controle 
    WHERE denominacao_normalizada = $normalizada
  `);

  const misses: string[] = [];
  let updatedCount = 0;

  const runUpdatesTransaction = db.transaction((items: UpdateItem[]) => {
    let localUpdated = 0;
    for (const item of items) {
      const result = updateStmt.run({
        $lista_controle: item.listaControle,
        $normalizada: item.normalizedSubstance,
      });

      if (result.changes === 0) {
        misses.push(item.originalSubstance);
      } else {
        localUpdated += result.changes;
      }
    }
    return localUpdated;
  });

  updatedCount = runUpdatesTransaction(itemsToUpdate);

  // Otimização: Criar índice na nova coluna
  console.log("Criando índice idx_lista_controle para otimizar validações de receituário...");
  db.run("CREATE INDEX IF NOT EXISTS idx_lista_controle ON substancias(lista_controle);");

  // Escrever log de misses (substâncias não encontradas na DCB)
  if (misses.length > 0) {
    fs.writeFileSync(logMissesPath, misses.join("\n"), "utf-8");
    console.log(`Log de misses gerado em: ${logMissesPath}`);
  } else {
    // Se não houver misses, remover log antigo se existir
    if (fs.existsSync(logMissesPath)) {
      fs.unlinkSync(logMissesPath);
    }
  }

  // Fechar conexão de forma limpa
  db.close();

  console.log("\n=== PROCESSO FASE 3 CONCLUÍDO ===");
  console.log(`Total de substâncias do CSV:   ${itemsToUpdate.length}`);
  console.log(`Total atualizadas no banco:    ${updatedCount}`);
  console.log(`Total de misses (gerados no log): ${misses.length}`);
}

runPhase3().catch((error) => {
  console.error("Erro fatal na execução da Fase 3:", error);
  process.exit(1);
});
