import { Database } from "bun:sqlite";
import fs from "fs";
import path from "path";

// List of common Portuguese salt prefixes to strip (e.g., "cloridrato de metilfenidato" -> "metilfenidato")
const saltPrefixes = [
  'cloridrato', 'sulfato', 'fosfato', 'bromidrato', 'mesilato', 'maleato', 
  'fumarato', 'acetato', 'citrato', 'cloreto', 'carbonato', 'bicarbonato', 
  'gluconato', 'lactato', 'estolato', 'propionato', 'pivalato', 'succinato', 
  'tartarato', 'besilato', 'camsilato', 'esilato', 'isetiato', 'napsilato', 
  'tosilato', 'adipato', 'aspartato', 'benzoato', 'edisilato', 'estearato', 
  'laurato', 'oleato', 'palmitato', 'pantotenato', 'valerato', 'xinafoato', 
  'metilsulfato', 'difosfato', 'dissulfato', 'hemitartarato', 'monocloridrato', 
  'monofosfato', 'monossulfato', 'valproato', 'salicilato', 'oxalato'
];

// Hydration and form suffixes to strip from the end of the name
const suffixesToStrip = [
  'diidratado', 'diidratada', 'triidratado', 'triidratada', 'anidro', 'anidra', 
  'hidratado', 'hidratada', 'monoidratado', 'monoidratada', 'hemiidratado', 
  'hemiidratada', 'di-hidratado', 'di-hidratada', 'mono-hidratado', 
  'mono-hidratada', 'tri-hidratado', 'tri-hidratada', 'pentaiidratado',
  'pentaiidratada', 'tetraiidratado', 'tetraiidratada', 'hexaiidratado',
  'hexaiidratada', 'heptaiidratado', 'heptaiidratada'
];

/**
 * Strips salt prefixes and hydration suffixes from a substance denomination
 * to obtain the base active molecule.
 */
function getBaseName(denominacao: string): string {
  let name = denominacao.toLowerCase().trim();

  // 1. Strip salt prefix if matches "<salt> de ..."
  for (const prefix of saltPrefixes) {
    const pattern = new RegExp(`^${prefix}\\s+de\\s+(.*)$`, 'i');
    const match = name.match(pattern);
    if (match) {
      name = match[1].trim();
      break;
    }
  }

  // 2. Strip hydration suffixes from the end
  for (const suffix of suffixesToStrip) {
    const pattern = new RegExp(`\\s+${suffix}$`, 'i');
    if (pattern.test(name)) {
      name = name.replace(pattern, '').trim();
    }
  }

  return name;
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

async function runPhase3() {
  console.log("=== INICIANDO PROCESSO ETL - FASE 3 (INTEGRAÇÃO DE TRAVAS COM MOLÉCULAS BASE) ===");

  const csvPath = path.resolve("./portaria_344_completa.csv");
  const dbFilePath = path.resolve("./prescricao.db");
  const logMissesPath = path.resolve("./logs_rdc_nao_encontrados.txt");

  // 1. Conectar ao Banco de Dados SQLite
  console.log(`[1/5] Conectando ao SQLite: ${dbFilePath}`);
  const db = new Database(dbFilePath);

  // 2. Preparar a Tabela: Verificar/Adicionar colunas
  console.log("[2/5] Verificando estrutura da tabela 'substancias'...");
  const tableInfo = db.query("PRAGMA table_info(substancias);").all() as { name: string }[];
  
  const hasBaseColumn = tableInfo.some((col) => col.name === "denominacao_base_normalizada");
  const hasListColumn = tableInfo.some((col) => col.name === "lista_controle");

  if (!hasBaseColumn) {
    console.log("Adicionando coluna 'denominacao_base_normalizada'...");
    db.run("ALTER TABLE substancias ADD COLUMN denominacao_base_normalizada TEXT;");
  }
  
  if (!hasListColumn) {
    console.log("Adicionando coluna 'lista_controle'...");
    db.run("ALTER TABLE substancias ADD COLUMN lista_controle TEXT;");
  }

  // Limpar lista_controle antiga para importação limpa
  db.run("UPDATE substancias SET lista_controle = NULL;");

  // 3. Popular denominacao_base_normalizada para todas as substâncias do banco
  console.log("[3/5] Calculando e populando a coluna 'denominacao_base_normalizada'...");
  const substances = db.query("SELECT id_dcb, denominacao FROM substancias").all() as { id_dcb: number; denominacao: string }[];
  
  const updateBaseStmt = db.prepare(`
    UPDATE substancias 
    SET denominacao_base_normalizada = $base 
    WHERE id_dcb = $id
  `);

  const runBasePopulateTransaction = db.transaction((items: { id_dcb: number; denominacao: string }[]) => {
    let count = 0;
    for (const item of items) {
      const baseName = getBaseName(item.denominacao);
      const normalizedBase = normalizeString(baseName);
      
      updateBaseStmt.run({
        $base: normalizedBase,
        $id: item.id_dcb
      });
      count++;
    }
    return count;
  });

  const basePopulated = runBasePopulateTransaction(substances);
  console.log(`Molécula base populada para ${basePopulated} registros.`);

  // Criar índice na coluna base normalizada
  db.run("CREATE INDEX IF NOT EXISTS idx_substancias_base_normalizada ON substancias(denominacao_base_normalizada);");

  // 4. Ler e parsear o arquivo CSV da Portaria 344
  if (!fs.existsSync(csvPath)) {
    console.error(`Erro: Arquivo CSV não encontrado em: ${csvPath}`);
    db.close();
    process.exit(1);
  }

  console.log(`[4/5] Lendo arquivo CSV: ${csvPath}`);
  const csvContent = fs.readFileSync(csvPath, "utf-8");
  const lines = csvContent.split(/\r?\n/);

  interface UpdateItem {
    originalSubstance: string;
    normalizedSubstance: string;
    listaControle: string;
  }

  const itemsToUpdate: UpdateItem[] = [];
  
  // Omitir cabeçalho
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

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

  // 5. Executar os Updates usando a molécula base
  console.log("[5/5] Executando atualizações de 'lista_controle' baseadas na molécula base...");
  
  const updateStmt = db.prepare(`
    UPDATE substancias 
    SET lista_controle = $lista_controle 
    WHERE denominacao_base_normalizada = $normalizada
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

  // Otimização: Criar índice na coluna lista_controle
  console.log("Criando/verificando índice idx_lista_controle...");
  db.run("CREATE INDEX IF NOT EXISTS idx_lista_controle ON substancias(lista_controle);");

  // Escrever log de misses (substâncias não encontradas na DCB)
  if (misses.length > 0) {
    fs.writeFileSync(logMissesPath, misses.join("\n"), "utf-8");
    console.log(`Log de misses gerado em: ${logMissesPath}`);
  } else {
    if (fs.existsSync(logMissesPath)) {
      fs.unlinkSync(logMissesPath);
    }
  }

  // Fechar conexão de forma limpa
  db.close();

  console.log("\n=== PROCESSO FASE 3 CONCLUÍDO ===");
  console.log(`Total de substâncias do CSV:   ${itemsToUpdate.length}`);
  console.log(`Total de registros afetados:   ${updatedCount}`);
  console.log(`Total de misses (no log):      ${misses.length}`);
}

runPhase3().catch((error) => {
  console.error("Erro fatal na execução da Fase 3:", error);
  process.exit(1);
});
