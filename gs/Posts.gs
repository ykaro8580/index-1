// Novo arquivo no mesmo projeto do Apps Script (ele enxerga o Code.gs automaticamente).
const NOME_PASTA = 'RedeSocial';
const SESSAO_EXPIRADA = { ok: false, erro: 'Sessão expirada. Entre de novo.' };

function pasta() {
  const it = DriveApp.getFoldersByName(NOME_PASTA);
  return it.hasNext() ? it.next() : DriveApp.createFolder(NOME_PASTA);
}

function salvarArquivo(base64, mime, nome, tiposOk, maxMB) {
  if (!base64) return '';
  if (!tiposOk.some(t => String(mime).indexOf(t) === 0)) throw new Error('Formato não aceito (' + (mime || 'desconhecido') + '). Use jpg, png ou webp para foto e mp3, m4a ou wav para música.');
  const bytes = Utilities.base64Decode(base64);
  if (bytes.length > maxMB * 1024 * 1024) throw new Error('Arquivo grande demais (máximo ' + maxMB + ' MB).');
  const arq = pasta().createFile(Utilities.newBlob(bytes, mime, nome));
  arq.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return arq.getId();
}

function postar(d) {
  const eu = usuarioDoToken(d.token);
  if (!eu) return SESSAO_EXPIRADA;
  if (!d.imagem && !d.audio) return { ok: false, erro: 'Escolha uma foto, uma música ou as duas.' };
  const titulo = String(d.titulo || '').trim().slice(0, 60);
  if (d.audio && !titulo) return { ok: false, erro: 'Dê um título para a música.' };
  const legenda = String(d.legenda || '').trim().slice(0, 200);
  const imagemId = salvarArquivo(d.imagem, d.imagem_mime, 'img-' + Date.now(), ['image/'], 3);
  const audioId = salvarArquivo(d.audio, d.audio_mime, 'mus-' + Date.now(), ['audio/'], 8);
  const tipo = imagemId && audioId ? 'foto+musica' : audioId ? 'musica' : 'foto';
  SpreadsheetApp.getActive().getSheetByName('Posts')
    .appendRow([Utilities.getUuid(), String(eu.id), String(eu.usuario), tipo, titulo, legenda, imagemId, audioId, new Date()]);
  return { ok: true };
}

// monta os posts já com curtidas, comentários e se o usuário salvou na playlist
function postsComExtras(posts, eu) {
  const curtidas = ler('Curtidas').linhas, coment = ler('Comentarios').linhas, salvas = ler('Playlist').linhas;
  const fotos = {};
  ler('Perfis').linhas.forEach(x => { fotos[String(x.usuario_id)] = String(x.foto_id || ''); });
  return posts.map(p => {
    const id = String(p.id);
    const dele = curtidas.filter(c => String(c.post_id) === id);
    return {
      id, usuario: String(p.usuario), tipo: p.tipo, titulo: p.titulo, legenda: p.legenda,
      imagem: String(p.imagem_id || ''), audio: String(p.audio_id || ''), criado_em: p.criado_em,
      curtidas: dele.length,
      curti: dele.some(c => String(c.usuario_id) === String(eu.id)),
      comentarios: coment.filter(c => String(c.post_id) === id).length,
      avatar: fotos[String(p.usuario_id)] || '',
      salvo: salvas.some(s => String(s.post_id) === id && String(s.usuario_id) === String(eu.id))
    };
  });
}

// feed geral com posts e reviews misturados, do mais novo ao mais antigo (cada item traz kind: 'post' ou 'review').
// Com d.usuario, só o que aquele perfil publicou.
function feed(d) {
  const eu = usuarioDoToken(d.token);
  if (!eu) return SESSAO_EXPIRADA;
  let posts = ler('Posts').linhas, revs = ler('Reviews').linhas;
  if (d.usuario) {
    posts = posts.filter(p => String(p.usuario) === String(d.usuario));
    revs = revs.filter(r => String(r.usuario) === String(d.usuario));
  }
  const maisNovo = (a, b) => new Date(b.criado_em) - new Date(a.criado_em);
  posts.sort(maisNovo);
  revs.sort(maisNovo);
  const juntos = posts.slice(0, 50).map(x => ({ tipo: 'post', x }))
    .concat(revs.slice(0, 50).map(x => ({ tipo: 'review', x })))
    .sort((a, b) => maisNovo(a.x, b.x)).slice(0, 50);
  const dosPosts = postsComExtras(juntos.filter(j => j.tipo === 'post').map(j => j.x), eu);
  const dasReviews = reviewsComExtras(juntos.filter(j => j.tipo === 'review').map(j => j.x), eu);
  let ip = 0, ir = 0;
  const itens = juntos.map(j => j.tipo === 'post'
    ? Object.assign({ kind: 'post' }, dosPosts[ip++])
    : Object.assign({ kind: 'review' }, dasReviews[ir++]));
  return { ok: true, eu: String(eu.usuario), posts: itens, perfil: d.usuario ? perfilPublico(d.usuario, eu) : null };
}

// playlist de um perfil: as músicas que a pessoa salvou, da mais recente para a mais antiga
function playlist(d) {
  const eu = usuarioDoToken(d.token);
  if (!eu) return SESSAO_EXPIRADA;
  const dono = ler('Usuarios').linhas.find(u => String(u.usuario) === String(d.usuario));
  if (!dono) return { ok: true, eu: String(eu.usuario), posts: [], perfil: null };
  const salvas = ler('Playlist').linhas.filter(s => String(s.usuario_id) === String(dono.id))
    .sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em));
  const todos = ler('Posts').linhas;
  const posts = salvas.map(s => todos.find(p => String(p.id) === String(s.post_id))).filter(Boolean);
  return { ok: true, eu: String(eu.usuario), posts: postsComExtras(posts, eu), perfil: perfilPublico(d.usuario, eu) };
}

// salvar e tirar da playlist no mesmo botão
function salvar(d) {
  const eu = usuarioDoToken(d.token);
  if (!eu) return SESSAO_EXPIRADA;
  const post = ler('Posts').linhas.find(p => String(p.id) === String(d.post_id));
  if (!post || !post.audio_id) return { ok: false, erro: 'Só dá para salvar posts com música.' };
  const t = ler('Playlist');
  const i = t.linhas.findIndex(x => String(x.usuario_id) === String(eu.id) && String(x.post_id) === String(d.post_id));
  if (i >= 0) { t.aba.deleteRow(i + 2); return { ok: true, salvo: false }; }
  t.aba.appendRow([String(eu.id), String(d.post_id), new Date()]);
  return { ok: true, salvo: true };
}

// curtir e descurtir no mesmo botão
function curtir(d) {
  const eu = usuarioDoToken(d.token);
  if (!eu) return SESSAO_EXPIRADA;
  if (!alvoDe(d.post_id)) return { ok: false, erro: 'Post não encontrado.' };
  const c = ler('Curtidas');
  const i = c.linhas.findIndex(x => String(x.post_id) === String(d.post_id) && String(x.usuario_id) === String(eu.id));
  if (i >= 0) { c.aba.deleteRow(i + 2); return { ok: true, curti: false }; }
  c.aba.appendRow([String(d.post_id), String(eu.id), new Date()]);
  return { ok: true, curti: true };
}

// só o dono apaga: remove o post, as curtidas dele e manda os arquivos para a lixeira do Drive
function apagar(d) {
  const eu = usuarioDoToken(d.token);
  if (!eu) return SESSAO_EXPIRADA;
  const p = ler('Posts');
  const i = p.linhas.findIndex(x => String(x.id) === String(d.post_id));
  if (i < 0) return { ok: false, erro: 'Post não encontrado.' };
  const post = p.linhas[i];
  if (String(post.usuario_id) !== String(eu.id)) return { ok: false, erro: 'Você só pode apagar os seus posts.' };
  ['Curtidas', 'Comentarios', 'Playlist'].forEach(nome => removerLinhas(nome, 'post_id', d.post_id));
  removerLinhas('PlaylistItens', 'ref', d.post_id);
  [post.imagem_id, post.audio_id].forEach(id => {
    if (!id) return;
    try { DriveApp.getFileById(String(id)).setTrashed(true); } catch (err) {}
  });
  p.aba.deleteRow(i + 2);
  return { ok: true };
}

// entrega a música em base64: o site monta o áudio a partir disso (o link direto do Drive bloqueia o player)
function baixarAudio(d) {
  const eu = usuarioDoToken(d.token);
  if (!eu) return SESSAO_EXPIRADA;
  const p = ler('Posts').linhas.find(x => String(x.id) === String(d.post_id));
  if (!p || !p.audio_id) return { ok: false, erro: 'Música não encontrada.' };
  const blob = DriveApp.getFileById(String(p.audio_id)).getBlob();
  return { ok: true, mime: blob.getContentType(), dados: Utilities.base64Encode(blob.getBytes()) };
}

function removerLinhas(nome, campo, valor) {
  const t = ler(nome);
  for (let k = t.linhas.length - 1; k >= 0; k--) {
    if (String(t.linhas[k][campo]) === String(valor)) t.aba.deleteRow(k + 2);
  }
}

// ---------- comentários ----------
// carregados só quando alguém abre o post; o dono do post também pode apagar os comentários dele
function comentarios(d) {
  const eu = usuarioDoToken(d.token);
  if (!eu) return SESSAO_EXPIRADA;
  const post = alvoDe(d.post_id);
  const souDono = !!post && String(post.usuario_id) === String(eu.id);
  const lista = ler('Comentarios').linhas.filter(c => String(c.post_id) === String(d.post_id))
    .sort((a, b) => new Date(a.criado_em) - new Date(b.criado_em))
    .map(c => ({ id: String(c.id), usuario: String(c.usuario), texto: String(c.texto), pode: souDono || String(c.usuario_id) === String(eu.id) }));
  return { ok: true, comentarios: lista };
}

function comentar(d) {
  const eu = usuarioDoToken(d.token);
  if (!eu) return SESSAO_EXPIRADA;
  const texto = String(d.texto || '').trim().slice(0, 300);
  if (!texto) return { ok: false, erro: 'Escreva algo antes de enviar.' };
  if (!alvoDe(d.post_id)) return { ok: false, erro: 'Post não encontrado.' };
  const id = Utilities.getUuid();
  SpreadsheetApp.getActive().getSheetByName('Comentarios')
    .appendRow([id, String(d.post_id), String(eu.id), String(eu.usuario), texto, new Date()]);
  return { ok: true, comentario: { id, usuario: String(eu.usuario), texto, pode: true } };
}

function apagarComentario(d) {
  const eu = usuarioDoToken(d.token);
  if (!eu) return SESSAO_EXPIRADA;
  const c = ler('Comentarios');
  const i = c.linhas.findIndex(x => String(x.id) === String(d.comentario_id));
  if (i < 0) return { ok: false, erro: 'Comentário não encontrado.' };
  const post = alvoDe(c.linhas[i].post_id);
  const pode = String(c.linhas[i].usuario_id) === String(eu.id) || (post && String(post.usuario_id) === String(eu.id));
  if (!pode) return { ok: false, erro: 'Você não pode apagar este comentário.' };
  c.aba.deleteRow(i + 2);
  return { ok: true };
}
