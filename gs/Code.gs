// Cole este arquivo em Extensões > Apps Script (na planilha).
// 1) Rode a função configurar() uma vez.  2) Implantar > Nova implantação > App da Web
//    (Executar como: eu / Quem tem acesso: qualquer pessoa).  3) Copie a URL para o login.html.

const ABAS = {
  Usuarios: ['id', 'usuario', 'nome', 'bio', 'foto_perfil', 'senha_hash', 'salt', 'criado_em'],
  Sessoes: ['token', 'usuario_id', 'expira_em'],
  Posts: ['id', 'usuario_id', 'usuario', 'tipo', 'titulo', 'legenda', 'imagem_id', 'audio_id', 'criado_em'],
  Curtidas: ['post_id', 'usuario_id', 'criado_em'],
  Comentarios: ['id', 'post_id', 'usuario_id', 'usuario', 'texto', 'criado_em'],
  Playlist: ['usuario_id', 'post_id', 'criado_em'],
  Perfis: ['usuario_id', 'nome', 'bio', 'foto_id', 'cor', 'fixada_id', 'favoritos', 'atualizado_em'],
  Playlists: ['id', 'usuario_id', 'usuario', 'nome', 'publica', 'criado_em'],
  PlaylistItens: ['playlist_id', 'tipo', 'ref', 'titulo', 'detalhe', 'capa_url', 'preview_url', 'criado_em'],
  Reviews: ['id', 'usuario_id', 'usuario', 'categoria', 'item_id', 'titulo', 'detalhe', 'capa_url', 'nota', 'texto', 'criado_em']
};
// Código que seus amigos digitam para criar conta. TROQUE antes de publicar.
const CODIGO_CONVITE = 'troque-este-codigo';
const COLUNAS_TEXTO = { Usuarios: 7, Sessoes: 2, Posts: 8, Curtidas: 2, Comentarios: 5, Playlist: 2, Reviews: 8, Perfis: 7, Playlists: 5, PlaylistItens: 7 }; // evita o Sheets converter hashes em números

function configurar() {
  const ss = SpreadsheetApp.getActive();
  for (const nome in ABAS) {
    const aba = ss.getSheetByName(nome) || ss.insertSheet(nome);
    aba.getRange(1, 1, aba.getMaxRows(), COLUNAS_TEXTO[nome]).setNumberFormat('@');
    if (aba.getLastRow() === 0) aba.appendRow(ABAS[nome]);
  }
}

function resp(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function hash(salt, senha) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + senha, Utilities.Charset.UTF_8);
  return bytes.map(b => ('0' + (b & 255).toString(16)).slice(-2)).join('');
}

function ler(nome) {
  const aba = SpreadsheetApp.getActive().getSheetByName(nome);
  const [cab, ...linhas] = aba.getDataRange().getValues();
  return { aba, linhas: linhas.map(l => Object.fromEntries(cab.map((k, i) => [k, l[i]]))) };
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const d = JSON.parse(e.postData.contents);
    const acoes = { cadastrar, login, eu, postar, feed, curtir, apagar, baixarAudio, comentarios, comentar, apagarComentario, salvar, playlist, buscarItem, postarReview, reviews, apagarReview, salvarPerfil, playlists, criarPlaylist, editarPlaylist, excluirPlaylist, playlistItens, alternarPlaylistPost, playlistsParaPost, adicionarMusica, removerItemPlaylist };
    if (!acoes[d.acao]) return resp({ ok: false, erro: 'Ação inválida.' });
    return resp(acoes[d.acao](d));
  } catch (err) {
    return resp({ ok: false, erro: err.message || 'Erro no servidor. Tente de novo.' });
  } finally {
    lock.releaseLock();
  }
}

function novaSessao(usuarioId) {
  const token = Utilities.getUuid() + Utilities.getUuid();
  const expira = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  SpreadsheetApp.getActive().getSheetByName('Sessoes').appendRow([token, usuarioId, expira]);
  return token;
}

function cadastrar(d) {
  if (CODIGO_CONVITE === 'troque-este-codigo') return { ok: false, erro: 'O dono do site ainda não definiu o código de convite.' };
  if (String(d.convite || '').trim().toLowerCase() !== CODIGO_CONVITE.toLowerCase()) return { ok: false, erro: 'Código de convite incorreto.' };
  const usuario = String(d.usuario || '').trim().toLowerCase();
  const senha = String(d.senha || '');
  if (!/^[a-z0-9_]{3,20}$/.test(usuario)) return { ok: false, erro: 'O usuário precisa ter de 3 a 20 letras minúsculas, números ou _.' };
  if (senha.length < 6) return { ok: false, erro: 'A senha precisa ter pelo menos 6 caracteres.' };
  const u = ler('Usuarios');
  if (u.linhas.some(x => String(x.usuario) === usuario)) return { ok: false, erro: 'Esse usuário já existe. Escolha outro.' };
  const id = Utilities.getUuid();
  const salt = Utilities.getUuid();
  u.aba.appendRow([id, usuario, String(d.nome || usuario).slice(0, 40), '', '', hash(salt, senha), salt, new Date()]);
  return { ok: true, token: novaSessao(id), usuario };
}

function login(d) {
  const usuario = String(d.usuario || '').trim().toLowerCase();
  const x = ler('Usuarios').linhas.find(l => String(l.usuario) === usuario);
  if (!x || hash(String(x.salt), String(d.senha || '')) !== String(x.senha_hash)) {
    return { ok: false, erro: 'Usuário ou senha incorretos.' };
  }
  return { ok: true, token: novaSessao(String(x.id)), usuario: String(x.usuario) };
}

// valida o token guardado no navegador; as próximas ações (postar, curtir) vão usar isso
function usuarioDoToken(token) {
  const s = ler('Sessoes').linhas.find(l => String(l.token) === String(token) && new Date(l.expira_em) > new Date());
  if (!s) return null;
  return ler('Usuarios').linhas.find(l => String(l.id) === String(s.usuario_id)) || null;
}

function eu(d) {
  const x = usuarioDoToken(d.token);
  return x ? { ok: true, usuario: String(x.usuario), nome: x.nome } : { ok: false, erro: 'Sessão expirada. Entre de novo.' };
}
