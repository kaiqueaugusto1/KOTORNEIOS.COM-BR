const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { promisify } = require("util");

const scrypt = promisify(crypto.scrypt);

const app = express();
app.set("trust proxy", 1); // atrás do Render/Nginx, para enxergar o IP real de quem acessa
const PORTA = process.env.PORT || 3000;
const MAX_CRIADORES = 50; // limite de contas de criador (pode ser aumentado aqui)

// Pasta onde os dados são gravados. Na hospedagem com disco persistente, defina DATA_DIR (ex.: /var/data).
const PASTA_DADOS = process.env.DATA_DIR || __dirname;
fs.mkdirSync(PASTA_DADOS, { recursive: true });
const KO_ARQUIVO = path.join(PASTA_DADOS, "ko-dados.json");
const USUARIOS_ARQUIVO = path.join(PASTA_DADOS, "ko-usuarios.json");
const CONFIG = path.join(PASTA_DADOS, "ko-config.json");

app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ---------- Senha do organizador (dono) ----------
// Variável de ambiente ADMIN_SENHA (recomendado na hospedagem).
// Sem ela, gera uma senha aleatória, guarda em ko-config.json e mostra no terminal.
let SENHA = process.env.ADMIN_SENHA;
if (!SENHA) {
  try {
    SENHA = JSON.parse(fs.readFileSync(CONFIG, "utf8")).senha;
  } catch {
    SENHA = crypto.randomBytes(5).toString("hex");
    fs.writeFileSync(CONFIG, JSON.stringify({ senha: SENHA }, null, 2));
  }
  console.log("=====================================================");
  console.log(" Senha do organizador: " + SENHA);
  console.log(" (para definir a sua, use a variável ADMIN_SENHA)");
  console.log("=====================================================");
}
const SEGREDO = crypto.createHmac("sha256", SENHA).update("ko-segredo-v2").digest();

function igual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ---------- Dados ----------
function lerJson(arquivo, padrao) {
  try {
    return JSON.parse(fs.readFileSync(arquivo, "utf8"));
  } catch {
    return padrao;
  }
}

function gravarJson(arquivo, obj) {
  const tmp = arquivo + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, arquivo); // gravação atômica: evita arquivo corrompido
}

const ko = lerJson(KO_ARQUIVO, { indice: {}, t: {}, liga: {} });
const usuarios = lerJson(USUARIOS_ARQUIVO, { criadores: {}, nomes: {} });
usuarios.criadores = usuarios.criadores || {};
usuarios.nomes = usuarios.nomes || {};

const salvarKo = () => gravarJson(KO_ARQUIVO, ko);
const salvarUsuarios = () => gravarJson(USUARIOS_ARQUIVO, usuarios);

// ---------- Senhas dos criadores (guardadas com hash, nunca em texto) ----------
const hashSenha = async (senha, salt) =>
  (await scrypt(senha, salt, 32, { N: 8192 })).toString("hex");

// ---------- Token de acesso (assinado pelo servidor) ----------
const assinar = (p) => crypto.createHmac("sha256", SEGREDO).update(p).digest("base64url");

function emitirToken(r, u, f) {
  const p = Buffer.from(JSON.stringify({ r, u, f })).toString("base64url");
  return p + "." + assinar(p);
}

// Devolve { papel, uid, nome } ou null. Se o criador for removido ou trocar de senha,
// o token dele deixa de valer na hora (a "impressão" f muda).
function lerToken(req) {
  const t = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const [p, s] = t.split(".");
  if (!p || !s || !igual(s, assinar(p))) return null;
  let d;
  try {
    d = JSON.parse(Buffer.from(p, "base64url").toString());
  } catch {
    return null;
  }
  if (d.r === "dono") return { papel: "dono", uid: "dono", nome: "Organizador" };
  if (d.r === "criador") {
    const c = Object.prototype.hasOwnProperty.call(usuarios.criadores, d.u) ? usuarios.criadores[d.u] : null;
    if (c && igual(c.hash.slice(0, 16), d.f || "")) return { papel: "criador", uid: d.u, nome: c.nome };
  }
  return null;
}

function exigirLogin(req, res, next) {
  const us = lerToken(req);
  if (!us) return res.status(401).json({ erro: "Não autorizado." });
  req.usuario = us;
  next();
}

function exigirDono(req, res, next) {
  exigirLogin(req, res, () => {
    if (req.usuario.papel !== "dono") return res.status(403).json({ erro: "Só o organizador pode fazer isso." });
    next();
  });
}

// ---------- Proteção contra tentativas de adivinhar senha ----------
const falhas = new Map();
const JANELA = 15 * 60 * 1000;
const bloqueado = (ip) => {
  const f = falhas.get(ip);
  return !!f && f.n >= 10 && Date.now() - f.t < JANELA;
};
const registrarFalha = (ip) => {
  const f = falhas.get(ip);
  if (!f || Date.now() - f.t >= JANELA) falhas.set(ip, { n: 1, t: Date.now() });
  else f.n++;
};

// Bloqueia nomes de chave perigosos (proteção contra prototype pollution)
app.param(["u", "t", "id"], (req, res, next, valor) => {
  if (["__proto__", "constructor", "prototype"].includes(valor))
    return res.status(400).json({ erro: "Identificador inválido." });
  next();
});

// ---------- Login ----------
app.post("/api/ko/login", async (req, res) => {
  try {
    const ip = req.ip;
    if (bloqueado(ip)) return res.status(429).json({ erro: "Muitas tentativas. Aguarde 15 minutos." });
    const senha = String((req.body && req.body.senha) || "");

    if (senha && igual(senha, SENHA)) {
      falhas.delete(ip);
      return res.json({ token: emitirToken("dono", "dono", ""), papel: "dono", uid: "dono", nome: "Organizador" });
    }
    if (senha) {
      for (const [id, c] of Object.entries(usuarios.criadores)) {
        if (igual(await hashSenha(senha, c.salt), c.hash)) {
          falhas.delete(ip);
          return res.json({ token: emitirToken("criador", id, c.hash.slice(0, 16)), papel: "criador", uid: id, nome: c.nome });
        }
      }
    }
    registrarFalha(ip);
    res.status(401).json({ erro: "Senha incorreta." });
  } catch {
    res.status(500).json({ erro: "Erro no servidor." });
  }
});

app.get("/api/ko/eu", exigirLogin, (req, res) => res.json(req.usuario));

// ---------- Leitura pública (qualquer pessoa acompanha) ----------
app.get("/api/ko/estado", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ indice: ko.indice, t: ko.t, liga: ko.liga, nomes: usuarios.nomes });
});

// ---------- Gravação: dono mexe em tudo; criador só no que é dele ----------
const podeUid = (us, u) => us.papel === "dono" || (us.papel === "criador" && us.uid === u);
const objetoValido = (b) => b && typeof b === "object" && !Array.isArray(b);

app.put("/api/ko/indice/:u", exigirLogin, (req, res) => {
  if (!podeUid(req.usuario, req.params.u)) return res.status(403).json({ erro: "Sem permissão." });
  if (!objetoValido(req.body)) return res.status(400).json({ erro: "Dados inválidos." });
  ko.indice[req.params.u] = req.body;
  salvarKo();
  res.json({ ok: true });
});

app.put("/api/ko/t/:t", exigirLogin, (req, res) => {
  const us = req.usuario;
  const atual = Object.prototype.hasOwnProperty.call(ko.t, req.params.t) ? ko.t[req.params.t] : null;
  if (!objetoValido(req.body)) return res.status(400).json({ erro: "Dados inválidos." });
  if (us.papel === "criador") {
    if (atual && atual.owner !== us.uid) return res.status(403).json({ erro: "Este torneio é de outro criador." });
    if (req.body.owner !== us.uid) return res.status(403).json({ erro: "Sem permissão." });
  }
  ko.t[req.params.t] = req.body;
  salvarKo();
  res.json({ ok: true });
});

app.delete("/api/ko/t/:t", exigirLogin, (req, res) => {
  const us = req.usuario;
  const atual = Object.prototype.hasOwnProperty.call(ko.t, req.params.t) ? ko.t[req.params.t] : null;
  if (atual && us.papel === "criador" && atual.owner !== us.uid)
    return res.status(403).json({ erro: "Este torneio é de outro criador." });
  delete ko.t[req.params.t];
  salvarKo();
  res.json({ ok: true });
});

app.put("/api/ko/liga/:u", exigirLogin, (req, res) => {
  if (!podeUid(req.usuario, req.params.u)) return res.status(403).json({ erro: "Sem permissão." });
  if (!objetoValido(req.body)) return res.status(400).json({ erro: "Dados inválidos." });
  ko.liga[req.params.u] = req.body;
  salvarKo();
  res.json({ ok: true });
});

// ---------- Gerenciar criadores (só o organizador) ----------
const listaCriadores = () =>
  Object.entries(usuarios.criadores).map(([id, c]) => ({ id, nome: c.nome }));

async function senhaEmUso(senha, ignorarId) {
  if (igual(senha, SENHA)) return true;
  for (const [id, c] of Object.entries(usuarios.criadores)) {
    if (id !== ignorarId && igual(await hashSenha(senha, c.salt), c.hash)) return true;
  }
  return false;
}

function validarSenha(senha) {
  if (senha.length < 4 || senha.length > 64) return "A senha deve ter de 4 a 64 caracteres.";
  return null;
}

app.get("/api/ko/criadores", exigirDono, (req, res) =>
  res.json({ criadores: listaCriadores(), max: MAX_CRIADORES })
);

app.post("/api/ko/criadores", exigirDono, async (req, res) => {
  try {
    const nome = String((req.body && req.body.nome) || "").trim();
    const senha = String((req.body && req.body.senha) || "");
    if (!nome || nome.length > 40) return res.status(400).json({ erro: "Informe um nome de até 40 letras." });
    const erroSenha = validarSenha(senha);
    if (erroSenha) return res.status(400).json({ erro: erroSenha });
    if (Object.keys(usuarios.criadores).length >= MAX_CRIADORES)
      return res.status(400).json({ erro: "Limite de " + MAX_CRIADORES + " criadores atingido." });
    if (Object.values(usuarios.criadores).some((c) => c.nome.toLowerCase() === nome.toLowerCase()))
      return res.status(400).json({ erro: "Já existe um criador com esse nome." });
    if (await senhaEmUso(senha))
      return res.status(400).json({ erro: "Essa senha já está em uso. Escolha outra." });

    const id = "c" + crypto.randomBytes(4).toString("hex");
    const salt = crypto.randomBytes(16).toString("hex");
    usuarios.criadores[id] = { nome, salt, hash: await hashSenha(senha, salt) };
    usuarios.nomes[id] = nome;
    salvarUsuarios();
    res.status(201).json({ id, nome });
  } catch {
    res.status(500).json({ erro: "Erro no servidor." });
  }
});

app.put("/api/ko/criadores/:id/senha", exigirDono, async (req, res) => {
  try {
    const c = Object.prototype.hasOwnProperty.call(usuarios.criadores, req.params.id) ? usuarios.criadores[req.params.id] : null;
    if (!c) return res.status(404).json({ erro: "Criador não encontrado." });
    const senha = String((req.body && req.body.senha) || "");
    const erroSenha = validarSenha(senha);
    if (erroSenha) return res.status(400).json({ erro: erroSenha });
    if (await senhaEmUso(senha, req.params.id))
      return res.status(400).json({ erro: "Essa senha já está em uso. Escolha outra." });
    c.salt = crypto.randomBytes(16).toString("hex");
    c.hash = await hashSenha(senha, c.salt);
    salvarUsuarios();
    res.json({ ok: true });
  } catch {
    res.status(500).json({ erro: "Erro no servidor." });
  }
});

// Remove o acesso. Os torneios dele continuam salvos (o organizador ainda pode editá-los).
app.delete("/api/ko/criadores/:id", exigirDono, (req, res) => {
  if (!Object.prototype.hasOwnProperty.call(usuarios.criadores, req.params.id))
    return res.status(404).json({ erro: "Criador não encontrado." });
  delete usuarios.criadores[req.params.id];
  salvarUsuarios();
  res.json({ ok: true });
});

app.listen(PORTA, () => {
  console.log(`Servidor rodando em http://localhost:${PORTA}`);
});
