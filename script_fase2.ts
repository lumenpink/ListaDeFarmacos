import { Database } from "bun:sqlite";
import fs from "fs";
import csv from "csv-parser";
import path from "path";

// Interfaces
interface CSVRow {
  TIPO_PRODUTO: string;
  NOME_PRODUTO: string;
  DATA_FINALIZACAO_PROCESSO: string;
  CATEGORIA_REGULATORIA: string;
  NUMERO_REGISTRO_PRODUTO: string;
  DATA_VENCIMENTO_REGISTRO: string;
  NUMERO_PROCESSO: string;
  CLASSE_TERAPEUTICA: string;
  EMPRESA_DETENTORA_REGISTRO: string;
  SITUACAO_REGISTRO: string;
  PRINCIPIO_ATIVO: string;
}

interface ParsedItem {
  numero_registro: string;
  nome_produto: string;
  empresa: string;
  classe_terapeutica: string;
  substanceIds: number[];
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

async function runETLPhase2() {
  const startTime = Date.now();
  console.log("=== INICIANDO PROCESSO ETL - FASE 2 (COM EQUIVALÊNCIAS, VÍRGULAS, INTEGRIDADE E FILTRO DE SUBSTÂNCIAS NULAS) ===");

  const csvFilePath = path.resolve("./input/DADOS_ABERTOS_MEDICAMENTOS.csv");
  const dbFilePath = path.resolve("./prescricao.db");
  const equivalencyPath = path.resolve("./input/equivalencias.csv");
  const logNothingPath = path.resolve("./logs_substancias_nao_encontradas.txt");
  const logPartialPath = path.resolve("./logs_substancias_parcialmente_nao_encontradas.txt");

  // 1. Conectar ao Banco de Dados SQLite
  console.log(`[1/5] Conectando ao SQLite: ${dbFilePath}`);
  const db = new Database(dbFilePath);

  // 2. Criar/Limpar tabelas e índices
  console.log("[2/5] Inicializando Tabelas e Índices...");
  db.run("DROP TABLE IF EXISTS medicamento_substancia;");
  db.run("DROP TABLE IF EXISTS medicamentos;");
  db.run(`
    CREATE TABLE IF NOT EXISTS medicamentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero_registro TEXT,
      nome_produto TEXT,
      empresa TEXT,
      classe_terapeutica TEXT
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS medicamento_substancia (
      medicamento_id INTEGER,
      substancia_id INTEGER,
      PRIMARY KEY (medicamento_id, substancia_id),
      FOREIGN KEY (medicamento_id) REFERENCES medicamentos(id) ON DELETE CASCADE,
      FOREIGN KEY (substancia_id) REFERENCES substancias(id_dcb) ON DELETE CASCADE
    );
  `);

  // Criar índice na coluna de normalização para otimizar os selects
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_substancias_normalizada 
    ON substancias(denominacao_normalizada);
  `);

  // 3. Preparar statements reutilizáveis
  const insertMedicamento = db.prepare(`
    INSERT INTO medicamentos (numero_registro, nome_produto, empresa, classe_terapeutica)
    VALUES ($numero_registro, $nome_produto, $empresa, $classe_terapeutica)
    RETURNING id;
  `);

  const selectSubstance = db.prepare(`
    SELECT id_dcb FROM substancias 
    WHERE denominacao_normalizada = $normalizada;
  `);

  const insertAssociation = db.prepare(`
    INSERT OR IGNORE INTO medicamento_substancia (medicamento_id, substancia_id)
    VALUES ($medicamento_id, $substancia_id);
  `);

  // Carregar mapa de equivalências a partir do arquivo CSV
  const equivalencyMap = new Map<string, number>();
  if (fs.existsSync(equivalencyPath)) {
    console.log(`Carregando equivalências de: ${equivalencyPath}`);
    const content = fs.readFileSync(equivalencyPath, "utf-8");
    const lines = content.split(/\r?\n/);
    let loadedCount = 0;
    
    // Pular a primeira linha (cabeçalho)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]?.trim();
      if (!line) continue;
      const parts = line.split(";");
      if (parts.length >= 2) {
        const rawAnvisa = parts[0]?.trim();
        const rawId = parts[1]?.trim();
        if (rawAnvisa && rawId) {
          const id = parseInt(rawId, 10);
          if (!isNaN(id)) {
            equivalencyMap.set(normalizeString(rawAnvisa), id);
            loadedCount++;
          }
        }
      }
    }
    console.log(`Equivalências ativas carregadas: ${loadedCount}`);
  } else {
    console.log("Aviso: Arquivo de equivalências não encontrado. Prosseguindo sem equivalências.");
  }

  // Função auxiliar de busca unificada de ID de substância
  function findSubstanceId(name: string): number | null {
    const norm = normalizeString(name);

    // 1. Busca direta na tabela substancias do SQLite
    const subResult = selectSubstance.get({ $normalizada: norm }) as { id_dcb: number } | undefined;
    if (subResult) {
      return subResult.id_dcb;
    }

    // 2. Busca na tabela de equivalência (pode retornar ID 0)
    const equivId = equivalencyMap.get(norm);
    if (equivId !== undefined) {
      return equivId;
    }

    return null;
  }

  // 4. Inicializar arquivos de log
  console.log(`[3/5] Criando arquivos de log:`);
  console.log(`      - Completo não encontrado: ${logNothingPath}`);
  console.log(`      - Parcial não encontrado:  ${logPartialPath}`);
  
  const logNothingStream = fs.createWriteStream(logNothingPath, { encoding: "utf-8" });
  logNothingStream.write("=== LOG DE SUBSTÂNCIAS NÃO ENCONTRADAS (NENHUMA ENCONTRADA) ===\n");
  logNothingStream.write("Formato: Registro do Medicamento | Princípio Ativo Original\n\n");

  const logPartialStream = fs.createWriteStream(logPartialPath, { encoding: "utf-8" });
  logPartialStream.write("=== LOG DE SUBSTÂNCIAS PARCIALMENTE NÃO ENCONTRADAS (ERRO DE INTEGRIDADE) ===\n");
  logPartialStream.write("Formato: Registro do Medicamento | Status das Substâncias (OK vs NÃO ENCONTRADO)\n\n");

  // Contadores
  let totalRowsRead = 0;
  let totalValidRows = 0;
  let totalInsertedMedicines = 0;
  let totalInsertedAssociations = 0;
  let totalMissedNothing = 0;
  let totalMissedPartial = 0;

  // Buffer para processamento em lotes
  const BATCH_SIZE = 1000;
  let batchBuffer: ParsedItem[] = [];

  // Transação em lote agrupada
  const executeBatchInsert = db.transaction((items: ParsedItem[]) => {
    let localMedCount = 0;
    let localAssocCount = 0;

    for (const item of items) {
      // Inserir medicamento e obter o id autogerado
      const medResult = insertMedicamento.get({
        $numero_registro: item.numero_registro,
        $nome_produto: item.nome_produto,
        $empresa: item.empresa,
        $classe_terapeutica: item.classe_terapeutica
      }) as { id: number } | undefined;

      if (!medResult) continue;
      const medId = medResult.id;
      localMedCount++;

      // Tratar associações de princípios ativos
      for (const subId of item.substanceIds) {
        insertAssociation.run({
          $medicamento_id: medId,
          $substancia_id: subId
        });
        localAssocCount++;
      }
    }

    return { localMedCount, localAssocCount };
  });

  console.log(`[4/5] Processando stream do CSV: ${csvFilePath}...`);

  // Utilizar Promise para aguardar a conclusão assíncrona do pipeline de streams
  await new Promise<void>((resolve, reject) => {
    const readStream = fs.createReadStream(csvFilePath, { encoding: "latin1" });
    const parser = csv({ separator: ";" });

    const pipeline = readStream.pipe(parser);

    pipeline.on("data", (row: CSVRow) => {
      totalRowsRead++;

      // Filtragem obrigatória: apenas registros com situação exatamente "Ativo"
      if (row.SITUACAO_REGISTRO !== "Ativo") {
        return;
      }

      const rawPrincipio = (row.PRINCIPIO_ATIVO || "").trim();
      if (rawPrincipio === "") {
        return;
      }

      // 1. Tentar o split primário por '+' e ';'
      let principles = rawPrincipio
        .split(/[+;]/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      let allMatched = true;
      let matchedIds: number[] = [];

      for (const p of principles) {
        const subId = findSubstanceId(p);
        if (subId !== null) {
          // Regra: Se for nome múltiplo (mais de 1 parte no split) e o ID for 0, ele deve ser ignorado.
          // Não bloqueia a inclusão e não insere na tabela de relações.
          if (principles.length > 1 && subId === 0) {
            continue;
          }
          // Regra: Se for nome simples (apenas 1 parte) e o ID for 0, trata como não encontrado.
          if (principles.length === 1 && subId === 0) {
            allMatched = false;
            break;
          }
          matchedIds.push(subId);
        } else {
          allMatched = false;
          break;
        }
      }

      // 2. Se falhar em encontrar todas, tenta separar por vírgula também (fallback)
      if (!allMatched) {
        const fallbackPrinciples = rawPrincipio
          .split(/[+;,]/)
          .map((p) => p.trim())
          .filter((p) => p.length > 0);

        // Só faz sentido tentar se o split por vírgula gerou uma estrutura diferente (mais partes)
        if (fallbackPrinciples.length > principles.length) {
          let fallbackMatched = true;
          const fallbackIds: number[] = [];

          for (const p of fallbackPrinciples) {
            const subId = findSubstanceId(p);
            if (subId !== null) {
              // Se for nome múltiplo e ID for 0, ignora substância (não insere e não bloqueia)
              if (fallbackPrinciples.length > 1 && subId === 0) {
                continue;
              }
              // Se for nome simples e ID for 0, bloqueia
              if (fallbackPrinciples.length === 1 && subId === 0) {
                fallbackMatched = false;
                break;
              }
              fallbackIds.push(subId);
            } else {
              fallbackMatched = false;
              break;
            }
          }

          if (fallbackMatched) {
            principles = fallbackPrinciples;
            matchedIds = fallbackIds;
            allMatched = true;
          }
        }
      }

      // Incrementa o contador de medicamentos válidos apenas se tivermos pelo menos um ingrediente ativo considerado
      totalValidRows++;

      const numero_registro = (row.NUMERO_REGISTRO_PRODUTO || "").trim();
      const nome_produto = (row.NOME_PRODUTO || "").trim();
      const empresa = (row.EMPRESA_DETENTORA_REGISTRO || "").trim();
      const classe_terapeutica = (row.CLASSE_TERAPEUTICA || "").trim();

      // 3. Processamento com base no resultado da correspondência total
      if (allMatched && matchedIds.length > 0) {
        // Sucesso: todas as substâncias válidas foram encontradas.
        batchBuffer.push({
          numero_registro,
          nome_produto,
          empresa,
          classe_terapeutica,
          substanceIds: matchedIds
        });
      } else {
        // Falha de integridade: pelo menos um ficou de fora. Não inserimos nada e registramos no log.
        // Usamos o split mais granular (com vírgulas) para classificar o erro e marcar o que falhou
        const granularPrinciples = rawPrincipio
          .split(/[+;,]/)
          .map((p) => p.trim())
          .filter((p) => p.length > 0);

        let matchedCount = 0;
        const statusParts: string[] = [];

        for (const p of granularPrinciples) {
          const subId = findSubstanceId(p);
          if (subId !== null) {
            if (granularPrinciples.length > 1 && subId === 0) {
              statusParts.push(`${p} (IGNORADO)`);
            } else if (granularPrinciples.length === 1 && subId === 0) {
              statusParts.push(`${p} (NÃO ENCONTRADO)`);
            } else {
              matchedCount++;
              statusParts.push(`${p} (OK)`);
            }
          } else {
            statusParts.push(`${p} (NÃO ENCONTRADO)`);
          }
        }

        if (matchedCount === 0) {
          // "Não achei nada"
          totalMissedNothing++;
          logNothingStream.write(`${numero_registro} | ${rawPrincipio}\n`);
        } else {
          // "Achei parcialmente, mas pelo menos uma ficou de fora"
          totalMissedPartial++;
          logPartialStream.write(`${numero_registro} | ${statusParts.join(", ")}\n`);
        }
      }

      // Se atingir o tamanho do lote, processar a transação
      if (batchBuffer.length >= BATCH_SIZE) {
        pipeline.pause();

        const result = executeBatchInsert(batchBuffer);
        totalInsertedMedicines += result.localMedCount;
        totalInsertedAssociations += result.localAssocCount;

        batchBuffer = [];
        pipeline.resume();
      }
    });

    pipeline.on("end", () => {
      // Processar lote remanescente
      if (batchBuffer.length > 0) {
        const result = executeBatchInsert(batchBuffer);
        totalInsertedMedicines += result.localMedCount;
        totalInsertedAssociations += result.localAssocCount;
      }
      resolve();
    });

    pipeline.on("error", (error) => {
      reject(error);
    });
  });

  // Fechar conexões e streams
  logNothingStream.end();
  logPartialStream.end();
  db.close();

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log("\n=== PROCESSO ETL FASE 2 CONCLUÍDO ===");
  console.log(`Tempo total de execução:                  ${totalTime}s`);
  console.log(`Total de linhas lidas do CSV:             ${totalRowsRead}`);
  console.log(`Total de medicamentos válidos (ativos):    ${totalValidRows}`);
  console.log(`Total de medicamentos inseridos:          ${totalInsertedMedicines}`);
  console.log(`Total de associações inseridas (SQLite):  ${totalInsertedAssociations}`);
  console.log(`Total de casos sem nenhuma substância:    ${totalMissedNothing}`);
  console.log(`Total de casos com falha parcial (log):    ${totalMissedPartial}`);
}

runETLPhase2().catch((error) => {
  console.error("Erro fatal durante a execução da Fase 2 do ETL:", error);
  process.exit(1);
});
