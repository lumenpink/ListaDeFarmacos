import fs from 'fs';
import path from 'path';

// Using require for pdf-parse to avoid ESM DOMMatrix dependency issues in Bun/Node
const { PDFParse } = require('pdf-parse');

interface ExtractedSubstance {
  name: string;
  list: string;
}

// Helper to identify header, footer, or metadata noise lines
function isNoiseLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('--') && trimmed.endsWith('--')) return true; // Page indicators, e.g. "-- 1 of 31 --"
  if (trimmed.includes('MINISTÉRIO DA SAÚDE')) return true;
  if (trimmed.includes('AGÊNCIA NACIONAL DE VIGILÂNCIA SANITÁRIA')) return true;
  if (trimmed.includes('ATUALIZAÇÃO N.')) return true;
  if (trimmed.includes('LISTAS DA PORTARIA SVS/MS')) return true;
  if (trimmed.includes('RESOLUÇÃO DA DIRETORIA COLEGIADA')) return true;
  if (trimmed.includes('Este texto não substitui a Publicação Oficial')) return true;
  if (trimmed.includes('PUB D.O.U.')) return true;
  return false;
}

async function main() {
  console.log('=== INICIANDO PARSE DO PDF DA PORTARIA 344 ===');
  
  const pdfPath = path.resolve('./input/m5ucbqep1gshq6nkcbqrnfaged_1780607412.pdf');
  const csvPath = path.resolve('./portaria_344_completa.csv');
  
  if (!fs.existsSync(pdfPath)) {
    console.error(`Erro: Arquivo PDF não encontrado no caminho: ${pdfPath}`);
    process.exit(1);
  }
  
  console.log(`[1/3] Lendo arquivo PDF: ${pdfPath}`);
  const dataBuffer = fs.readFileSync(pdfPath);
  
  console.log('[2/3] Extraindo texto via pdf-parse...');
  const parser = new PDFParse({ data: new Uint8Array(dataBuffer) });
  const parseResult = await parser.getText();
  
  const rawText = parseResult.text;
  const lines = rawText.split(/\r?\n/);
  console.log(`Texto extraído com sucesso. Total de linhas brutas: ${lines.length}`);
  
  console.log('[3/3] Parseando linhas e estruturando as substâncias...');
  
  const substances: ExtractedSubstance[] = [];
  let currentList = '';
  let inAdendo = false;
  let activeSubstance: ExtractedSubstance | null = null;
  
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] || '';
    const cleanLine = rawLine.replace(/\s+/g, ' ').trim();
    
    // Detect list headers (e.g., "LISTA - A1", "LISTA F1 - SUBSTÂNCIAS ENTORPECENTES")
    const listMatch = cleanLine.match(/^LISTA\s*-\s*([A-F]\d?)/i) || cleanLine.match(/^LISTA\s+(F\d)\s*-\s*/i);
    if (listMatch) {
      // Save any pending active substance before transitioning list
      if (activeSubstance) {
        substances.push(activeSubstance);
        activeSubstance = null;
      }
      currentList = listMatch[1].toUpperCase();
      inAdendo = false;
      continue;
    }
    
    // Detect end of active substances block for a list (adendos/notes section)
    if (cleanLine.match(/^ADENDO:/i) || cleanLine.match(/^ADENDOS:/i)) {
      if (activeSubstance) {
        substances.push(activeSubstance);
        activeSubstance = null;
      }
      inAdendo = true;
      continue;
    }
    
    // Only parse if we are inside a list and not in its adendo section
    if (currentList && !inAdendo) {
      if (isNoiseLine(rawLine)) {
        continue;
      }
      
      // Match a substance index, e.g. "1. Acetilmetadol" or "14. BETA-HIDROXI-3-"
      // Must not match sub-items like "1.1." or "1)"
      const numMatch = cleanLine.match(/^\s*(\d+)\.\s+(.*)$/);
      if (numMatch) {
        if (activeSubstance) {
          substances.push(activeSubstance);
        }
        activeSubstance = {
          name: numMatch[2].trim(),
          list: currentList
        };
      } else {
        // If there's an active substance, append continuation lines unless it's a section header
        if (activeSubstance) {
          // Prevent merging sub-headers of lists like "a) SUBSTÂNCIAS" or "b) CLASSES" under F2
          const isSubHeader = cleanLine.match(/^[a-z]\)\s+SUBSTÂNCIAS/i) || cleanLine.match(/^[a-z]\)\s+CLASSES/i);
          if (isSubHeader) {
            substances.push(activeSubstance);
            activeSubstance = null;
          } else {
            // Append continuation line with a space separator
            activeSubstance.name = (activeSubstance.name + ' ' + cleanLine).replace(/\s+/g, ' ').trim();
          }
        }
      }
    }
  }
  
  // Push the final active substance if any remains
  if (activeSubstance) {
    substances.push(activeSubstance);
  }
  
  console.log(`Substâncias estruturadas com sucesso. Total extraído: ${substances.length}`);
  
  // Display counts by list type for verification
  const counts: Record<string, number> = {};
  for (const s of substances) {
    counts[s.list] = (counts[s.list] || 0) + 1;
  }
  console.log('\nResumo de substâncias extraídas por lista:');
  console.log(JSON.stringify(counts, null, 2));
  
  // Write to CSV file with semicolon delimiter and UTF-8 encoding
  console.log(`Escrevendo arquivo CSV: ${csvPath}`);
  const csvLines = ['substancia;lista_controle'];
  for (const s of substances) {
    csvLines.push(`${s.name};${s.list}`);
  }
  
  fs.writeFileSync(csvPath, csvLines.join('\n'), 'utf-8');
  console.log('=== PROCESSO CONCLUÍDO COM SUCESSO! ===');
}

main().catch((error) => {
  console.error('Erro fatal na execução do script:', error);
  process.exit(1);
});
