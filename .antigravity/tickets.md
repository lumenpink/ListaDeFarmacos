# Active Tickets - ListaDeFarmacos
> Synced at: 2026-10-17 17:56:09 UTC
> Ceiling: 10240 bytes (strictly uncut tickets)

## [#2] chore(ListaDeFármacos): adequar licenciamento para GPL-3.0 e reescrever historico de commits
- **Status**: `open`
- **Labels**: none
- **Link**: https://codeberg.org/lumenpink/ListaDeFarmacos/issues/2

### Description
## Contexto e Objetivo
Adequar a conformidade jurídica e documental do repositório `ListaDeFármacos` ao padrão canônico GOST, estabelecendo **GNU General Public License v3.0 (GPL-3.0-or-later)** como licença padrão da raiz e alinhando os metadados de governança.

## Requisitos de Licenciamento
1. **Licença Raiz:** Criar/substituir o arquivo `LICENSE` com o texto integral da **GNU General Public License v3.0**.
2. **Satélites Obrigatórios (se aplicável):**
   - `LICENSE-LOGO`: Creative Commons Atribuição-SemDerivações 4.0 Internacional (`CC-BY-ND-4.0`) para ícones, insígnias e marcas.
   - `LICENSE-MEDIA`: Creative Commons Atribuição-CompartilhaIgual 4.0 Internacional (`CC-BY-SA-4.0`) para áudios, ilustrações e mídias.
3. **Mapeamento no `README.md`:** Incluir seção `## 📄 Licença` com tabela de mapeamento explícito de caminhos e licenças correspondentes.
4. **Manifestos e Metadados:** Sincronizar cabeçalhos, manifestos (`Cargo.toml` / `package.json` com SPDX `GPL-3.0-or-later`).
5. **Documentação / Site:** Atualizar o rodapé e metadados de `site/index.html` para refletir `GPL-3.0`.

## ⚠️ Requisito Mandatório: Reescrita Completa do Histórico Git
O histórico de commits deve ser **integralmente reescrito** (via `git-filter-repo` ou rebase interativo) para:
- Expurgar todos os commits, árvores e blobs anteriores que contenham referências às licenças removidas/revogadas.
- Higienizar mensagens de commits passados para eliminar citações a termos incompatíveis.
- Garantir que qualquer auditoria forense no repositório ateste conformidade estrita e contínua desde o commit inicial.

## Conclusão do Ciclo
Após a reescrita do histórico e validação pelo `cccp check --strict`, o título e descrição deste ticket devem ser atualizados para a mensagem genérica de governança: `docs(meta): adequacao de conformidade e integridade documental`.

---
