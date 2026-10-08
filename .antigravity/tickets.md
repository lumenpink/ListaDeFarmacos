# Active Tickets - ListaDeFármacos
> Ceiling: 10240 bytes


## [#101] test(ListaDeFármacos): estruturar suite de testes automatizados e alcancar piso de 90% de cobertura
- **Status**: `open`
- **Labels**: gost, quality

### Description
## Description
O repositório `ListaDeFármacos` necessita de uma suíte formal de testes automatizados para cumprir a Seção 6 da norma GOST (Piso de cobertura >= 90% e testes unitários herméticos).

## Expected Behavior & Acceptance Criteria
- [ ] Configurar framework de testes idiomático para a stack do projeto.
- [ ] Criar casos de teste cobrindo funcionalidades críticas de domínio.
- [ ] Atingir piso mínimo comprovado de 90% de cobertura de código.

## Tasks / DD-TDD Checklist (9 Fases GOST)
- [ ] Fase 1 - Ticket: Issue formalizada e escopo delimitado
- [ ] Fase 2 - Branch: Branch `test/101-test-suite` criada a partir de develop/main
- [ ] Fase 3 - Doc/Spec: Contrato preliminar e especificação (Zero código de produção)
- [ ] Fase 4 - Red: Teste automatizado falho comprovando o requisito
- [ ] Fase 5 - Green: Implementação mínima funcional com teste passando
- [ ] Fase 6 - Refactor: Código limpo, idiomático e com Zero Warnings
- [ ] Fase 7 - Mutation: Mutantes críticos eliminados com asserções robustas
- [ ] Fase 8 - Quality Gate: Cobertura >= 90%, linter -D warnings e formatação validados
- [ ] Fase 9 - Close: Changelog e documentação atualizados; commit com (closes #101)

---

## [#102] ci(ListaDeFármacos): configurar workflow de integracao continua no Forgejo
- **Status**: `open`
- **Labels**: gost, quality

### Description
## Description
O repositório `ListaDeFármacos` não possui pipeline automatizado de CI/CD configurado em `.forgejo/workflows/` para validação de testes, lint e auditoria GOST a cada push.

## Expected Behavior & Acceptance Criteria
- [ ] Criar workflow `.forgejo/workflows/ci.yaml`.
- [ ] Adicionar jobs de linting, execução de testes e verificação de conformidade GOST (`cccp gost --strict`).
- [ ] Garantir execução verde e bloqueio de regressões no branch principal.

## Tasks / DD-TDD Checklist (9 Fases GOST)
- [ ] Fase 1 - Ticket: Issue formalizada e escopo delimitado
- [ ] Fase 2 - Branch: Branch `ci/102-forgejo-workflow` criada a partir de develop/main
- [ ] Fase 3 - Doc/Spec: Contrato preliminar e especificação (Zero código de produção)
- [ ] Fase 4 - Red: Teste automatizado falho comprovando o requisito
- [ ] Fase 5 - Green: Implementação mínima funcional com teste passando
- [ ] Fase 6 - Refactor: Código limpo, idiomático e com Zero Warnings
- [ ] Fase 7 - Mutation: Mutantes críticos eliminados com asserções robustas
- [ ] Fase 8 - Quality Gate: Cobertura >= 90%, linter -D warnings e formatação validados
- [ ] Fase 9 - Close: Changelog e documentação atualizados; commit com (closes #102)

---
