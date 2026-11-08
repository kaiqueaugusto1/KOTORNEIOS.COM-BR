# KO Torneios no seu servidor

O **KO Torneios** (`public/index.html`) roda dentro de um servidor Node.js + Express. Os dados ficam no servidor, então todos os aparelhos veem os mesmos torneios, e a tela de quem acompanha atualiza sozinha a cada 5 segundos.

## Os três tipos de acesso

| Acesso | Como entra | O que pode |
|---|---|---|
| **Organizador** (dono) | senha `ADMIN_SENHA` | tudo: cria e edita qualquer torneio ou liga e gerencia os criadores |
| **Criador** | senha própria, dada pelo organizador | cria torneios, sorteia, lança placares e mantém a própria liga. **Só edita o que é dele**; nos torneios dos outros apenas consulta |
| **Visualização** | só o link, sem senha | acompanha tudo, sem botões de edição |

### Como cadastrar criadores
1. Entre como organizador (botão **Entrar** e a senha do `ADMIN_SENHA`).
2. Abra a aba **Acessos**, no card **Criadores**.
3. Digite o nome e uma senha para o criador e clique em **Adicionar**. Passe a senha para a pessoa.
4. O criador abre o mesmo endereço, clica em **Entrar** e digita a senha dele.

Não precisa mexer no Render nem publicar de novo: criadores são adicionados, trocados e removidos direto pela tela.
- **Limite:** 50 criadores (constante `MAX_CRIADORES` no `server.js`, se precisar de mais).
- **Trocar senha / Remover:** o acesso antigo para de funcionar na hora. Ao remover um criador, os torneios dele continuam salvos e o organizador ainda pode editá-los.
- As senhas são guardadas com hash e **não podem ser consultadas**, só trocadas.
- Cada senha precisa ser diferente das outras e da senha do organizador.
- Depois de 10 senhas erradas, o IP fica bloqueado por 15 minutos.

## Tipos de torneio e formato dos jogos

Na criação do torneio (e depois em **Ajustes**) você escolhe:

- **Tipo:** Grupos e mata-mata, Só mata-mata, Pontos corridos ou **Dupla eliminatória**.
- **Jogos da fase de grupos:** jogo único (um placar) ou **melhor de 3** (o 3º jogo só aparece se estiver 1 × 1). No melhor de 3 a tabela desempata por vitórias, saldo de jogos, saldo de pontos, pontos feitos e confronto direto.
- **Jogos do mata-mata:** jogo único, melhor de 3 **só na final** (o padrão de antes) ou melhor de 3 **em todas as fases**.

**Dupla eliminatória:** só sai do torneio quem perde duas vezes. Quem perde na chave dos vencedores cai para a repescagem. O campeão da repescagem enfrenta o campeão dos vencedores na final e, se ele vencer, joga uma segunda final decisiva (dá para desligar em Ajustes). A ordem do sorteio define os cabeças de chave, que ganham as vagas diretas quando o número de participantes não completa a chave.

Mudar o formato dos jogos em um torneio já iniciado apaga os placares afetados.

## Rodar no seu computador

1. Instale o Node.js (versão LTS): https://nodejs.org
2. Abra o terminal dentro desta pasta e rode:

```
npm install
npm start
```

3. Na primeira vez o terminal mostra a **senha do organizador** (guardada em `ko-config.json`).
4. Abra http://localhost:3000. Se a porta estiver ocupada: `set PORT=3001` e depois `npm start`.

Para escolher a sua própria senha de organizador (Windows, cmd):

```
set ADMIN_SENHA=minhasenha
npm start
```

## Publicar online (Render)

1. Envie a pasta para um repositório no GitHub (o `.gitignore` já deixa de fora os dados e as senhas).
2. No Render: **New > Web Service**, ligue o repositório.
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: plano **pago** (o grátis não permite disco)
3. Em **Disks**, adicione um disco com Mount Path `/var/data` (o menor tamanho basta).
4. Em **Environment**, crie:
   - `ADMIN_SENHA` = a senha do organizador
   - `DATA_DIR` = `/var/data`
5. Deploy. Quando ficar **Live**, abra o endereço `.onrender.com`.

**Por que disco pago:** no plano grátis do Render os arquivos são apagados a cada reinício, novo deploy ou quando o serviço "dorme" (15 minutos sem acessos). Os torneios e os criadores ficam em arquivos, então precisam do disco. Alternativa: uma VPS (Hetzner, DigitalOcean, Contabo), onde o disco é permanente.

**Atenção:** com disco, cada atualização do site tira o serviço do ar por alguns instantes. Evite publicar mudanças durante um torneio.

## Arquivos

- `server.js`: servidor, acessos e rotas `/api/ko/...`
- `public/index.html`: o KO Torneios
- `ko-dados.json`: torneios e ligas (criado automaticamente)
- `ko-usuarios.json`: criadores e senhas com hash (criado automaticamente)
- `ko-config.json`: só existe se você não definir `ADMIN_SENHA`

**Faça backup de `ko-dados.json` e `ko-usuarios.json` antes de eventos.**

## Observação

Se você abrir `public/index.html` direto no computador (duplo clique), ele funciona em modo local, como antes: dados só naquele navegador e sem criadores.
